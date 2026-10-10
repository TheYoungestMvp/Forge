import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAppGeneratorProvider } from "@/lib/ai/provider";
import {
  GenerationError,
  publicGenerationError,
} from "@/lib/generation/errors";
import { generationDeadline } from "@/lib/generation/deadline";
import {
  generateRequestSchema,
  pendingGenerationSchema,
  type GenerateRequest,
  type GenerationEvent,
} from "@/lib/generation/schema";
import { validateGeneratedApp } from "@/lib/generation/validate";
import {
  messageSchema,
  projectSchema,
  savedGenerationSchema,
  toAppVersion,
  versionSchema,
} from "@/lib/projects/schema";
import { requireSession } from "@/lib/projects/session";
import {
  assertSameOrigin,
  databaseError,
  getSupabase,
  projectErrorResponse,
} from "@/lib/projects/server";

export const runtime = "nodejs";
export const maxDuration = 150;
const claimedSchema = z.object({
  state: z.literal("claimed"),
  project: projectSchema,
  currentVersion: versionSchema.nullable(),
  userMessage: messageSchema,
  message: messageSchema,
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  let deadline: ReturnType<typeof generationDeadline> | undefined;
  let ownerId = "";
  let input: GenerateRequest | undefined;
  const runToken = randomUUID();
  let claimed = false;
  try {
    deadline = generationDeadline(request, startedAt);
    assertSameOrigin(request);
    ownerId = requireSession(request);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new GenerationError(
        "INVALID_REQUEST",
        "Send the prompt as application/json.",
        415,
      );
    const raw = await deadline.waitFor(request.text());
    deadline.check();
    if (Buffer.byteLength(raw) > 1024 * 1024)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The generation request is too large.",
        413,
      );
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new GenerationError(
        "INVALID_REQUEST",
        "The request body must be valid JSON.",
        400,
      );
    }
    const parsed = generateRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "Provide a 1–4000 character prompt, projectId, requestId and baseVersionId.",
        400,
      );
    input = parsed.data;
    if (input.currentApp) {
      try {
        validateGeneratedApp(JSON.stringify(input.currentApp));
      } catch {
        throw new GenerationError(
          "INVALID_CURRENT_APP",
          "The existing app is invalid or exceeds supported code limits.",
          400,
        );
      }
    }
    if (
      !input.projectId ||
      !input.requestId ||
      input.baseVersionId === undefined
    )
      throw new GenerationError(
        "INVALID_REQUEST",
        "Create or open a project and include projectId, requestId and baseVersionId.",
        400,
      );
    const db = getSupabase(deadline.signal);
    const begun = await deadline.waitFor(
      db.rpc("forge_begin_generation", {
        p_owner_id: ownerId,
        p_project_id: input.projectId,
        p_request_id: input.requestId,
        p_prompt: input.prompt,
        p_base_version_id: input.baseVersionId,
        p_run_token: runToken,
        p_deadline_at: deadline.deadlineAt,
      }),
    );
    if (begun.error) throw databaseError(begun.error);
    const state = begun.data?.state;
    if (state === "processing") {
      deadline.close();
      return Response.json(pendingGenerationSchema.parse(begun.data), {
        status: 202,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (state === "completed") {
      const saved = savedGenerationSchema.parse(begun.data.saved);
      const user = messageSchema.parse(begun.data.userMessage);
      deadline.close();
      return new Response(
        [
          { type: "message", message: user },
          { type: "complete", saved },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
        {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    claimed = true;
    const begin = claimedSchema.parse(begun.data);
    const context: GenerateRequest = { prompt: input.prompt };
    if (begin.currentVersion)
      context.currentApp = validateGeneratedApp(
        JSON.stringify(toAppVersion(begin.currentVersion).app),
      );
    deadline.check();
    const activeDeadline = deadline;
    const activeInput = input;
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: GenerationEvent) => {
          if (!closed)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        async function advance(step: number, content: string, plan?: string[]) {
          activeDeadline.check();
          const result = await activeDeadline.waitFor(
            db.rpc("forge_advance_generation", {
              p_owner_id: ownerId,
              p_project_id: activeInput.projectId,
              p_request_id: activeInput.requestId,
              p_run_token: runToken,
              p_phase: step,
              p_content: content,
              ...(plan ? { p_plan: plan } : {}),
            }),
          );
          if (result.error) throw databaseError(result.error);
          activeDeadline.check();
          send({ type: "message", message: messageSchema.parse(result.data) });
          send({ type: "status", step });
        }
        try {
          send({ type: "message", message: begin.userMessage });
          send({ type: "message", message: begin.message });
          send({ type: "status", step: 0 });
          const provider = createAppGeneratorProvider();
          await advance(1, "Planning application");
          const plan = await activeDeadline.waitFor(
            provider.plan(context, activeDeadline.signal),
          );
          activeDeadline.check();
          await advance(2, "Generating application code", plan.steps);
          send({ type: "plan", plan });
          const raw = await activeDeadline.waitFor(
            provider.generate(context, activeDeadline.signal, undefined, plan),
          );
          activeDeadline.check();
          await advance(3, "Validating application");
          let app;
          try {
            app = validateGeneratedApp(raw);
          } catch (error) {
            if (
              !(error instanceof GenerationError) ||
              error.code !== "INVALID_GENERATED_APP"
            )
              throw error;
            activeDeadline.check();
            await advance(3, "Correcting invalid generated output");
            app = validateGeneratedApp(
              await activeDeadline.waitFor(
                provider.generate(
                  context,
                  activeDeadline.signal,
                  error.message,
                  plan,
                ),
              ),
            );
          }
          activeDeadline.check();
          await advance(4, "Saving version");
          const saved = await activeDeadline.waitFor(
            db.rpc("forge_finish_generation", {
              p_owner_id: ownerId,
              p_project_id: activeInput.projectId,
              p_request_id: activeInput.requestId,
              p_run_token: runToken,
              p_app: app,
              p_model: provider.model,
            }),
          );
          if (saved.error) throw databaseError(saved.error);
          activeDeadline.check();
          send({
            type: "complete",
            saved: savedGenerationSchema.parse(saved.data),
          });
        } catch (error) {
          // A separate bounded reconciliation may read an already committed success.
          // Its database fence prevents late failures from altering any successful result.
          const failure = activeDeadline.signal.aborted
            ? new GenerationError(
                "GENERATION_TIMEOUT",
                "The request timed out or was interrupted. Reload to check the saved result, then retry if needed.",
                504,
              )
            : publicGenerationError(error);
          const settled = await getSupabase(AbortSignal.timeout(5000)).rpc(
            "forge_fail_generation",
            {
              p_owner_id: ownerId,
              p_project_id: activeInput.projectId,
              p_request_id: activeInput.requestId,
              p_run_token: runToken,
              p_code: failure.code,
              p_message: failure.message,
            },
          );
          if (!settled.error && settled.data?.state === "completed")
            send({
              type: "complete",
              saved: savedGenerationSchema.parse(settled.data.saved),
            });
          else {
            if (!settled.error && settled.data?.message)
              send({
                type: "message",
                message: messageSchema.parse(settled.data.message),
              });
            const visible = settled.error
              ? databaseError(settled.error)
              : failure;
            send({
              type: "error",
              code: visible.code,
              message: visible.message,
            });
          }
        } finally {
          activeDeadline.close();
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        closed = true;
        activeDeadline.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (deadline?.signal.aborted)
      error = new GenerationError(
        "GENERATION_TIMEOUT",
        "The request timed out or was interrupted. Reload to check its saved result, then retry.",
        504,
      );
    if (claimed && input) {
      const failure = publicGenerationError(error);
      await getSupabase(AbortSignal.timeout(5000)).rpc(
        "forge_fail_generation",
        {
          p_owner_id: ownerId,
          p_project_id: input.projectId,
          p_request_id: input.requestId,
          p_run_token: runToken,
          p_code: failure.code,
          p_message: failure.message,
        },
      );
    }
    deadline?.close();
    return projectErrorResponse(error);
  }
}
