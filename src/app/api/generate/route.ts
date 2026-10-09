import { createAppGeneratorProvider } from "@/lib/ai/provider";
import {
  GenerationError,
  publicGenerationError,
} from "@/lib/generation/errors";
import {
  generateRequestSchema,
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
import {
  assertSameOrigin,
  databaseError,
  getSupabase,
  projectErrorResponse,
} from "@/lib/projects/server";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  let input: GenerateRequest;
  let db: ReturnType<typeof getSupabase>;
  let userMessage: ReturnType<typeof messageSchema.parse>;
  let generationRequest: GenerateRequest;
  let existing: ReturnType<typeof savedGenerationSchema.parse> | null = null;
  let timeoutMs: number;
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new GenerationError(
        "INVALID_REQUEST",
        "Send the prompt as application/json.",
        415,
      );
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1024 * 1024)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The generation request is too large.",
        413,
      );
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new GenerationError(
        "INVALID_REQUEST",
        "The request body must be valid JSON.",
        400,
      );
    }
    const result = generateRequestSchema.safeParse(data);
    if (!result.success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "Provide a prompt containing 1–4000 characters and valid project, request and base-version IDs.",
        400,
      );
    input = result.data;
    if (input.currentApp) {
      try {
        validateGeneratedApp(JSON.stringify(input.currentApp));
      } catch {
        throw new GenerationError(
          "INVALID_CURRENT_APP",
          "The existing application is invalid or exceeds the supported code limits.",
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
        "Create or open a project before generating. Include projectId, requestId and baseVersionId.",
        400,
      );
    timeoutMs = Number(process.env.GENERATION_TIMEOUT_MS || 120000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000)
      throw new GenerationError(
        "CONFIGURATION_ERROR",
        "GENERATION_TIMEOUT_MS must be between 1000 and 120000.",
        503,
      );
    db = getSupabase();
    const projectResult = await db
      .from("projects")
      .select("*")
      .eq("id", input.projectId)
      .maybeSingle();
    if (projectResult.error) throw databaseError(projectResult.error);
    if (!projectResult.data)
      throw new GenerationError(
        "PROJECT_NOT_FOUND",
        "This project no longer exists. Create a new project.",
        404,
      );
    const project = projectSchema.parse(projectResult.data);
    const previousUser = await db
      .from("messages")
      .select("*")
      .eq("project_id", input.projectId)
      .eq("request_id", input.requestId)
      .eq("role", "user")
      .maybeSingle();
    if (previousUser.error) throw databaseError(previousUser.error);
    if (previousUser.data && previousUser.data.content !== input.prompt)
      throw new GenerationError(
        "INVALID_REQUEST",
        "A generation request ID cannot be reused for a different prompt.",
        409,
      );
    const savedResult = await db
      .from("versions")
      .select("*")
      .eq("id", input.requestId)
      .eq("project_id", input.projectId)
      .maybeSingle();
    if (savedResult.error) throw databaseError(savedResult.error);
    if (savedResult.data) {
      const reply = await db
        .from("messages")
        .select("*")
        .eq("project_id", input.projectId)
        .eq("request_id", input.requestId)
        .eq("role", "assistant")
        .single();
      if (reply.error) throw databaseError(reply.error);
      existing = savedGenerationSchema.parse({
        project,
        version: savedResult.data,
        message: reply.data,
      });
      validateGeneratedApp(JSON.stringify(toAppVersion(existing.version).app));
      userMessage = messageSchema.parse(previousUser.data);
      generationRequest = { prompt: input.prompt };
    } else {
      const latestResult = await db
        .from("versions")
        .select("*")
        .eq("project_id", input.projectId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestResult.error) throw databaseError(latestResult.error);
      const latest = latestResult.data
        ? versionSchema.parse(latestResult.data)
        : null;
      if ((latest?.id ?? null) !== input.baseVersionId)
        throw new GenerationError(
          "PROJECT_CHANGED",
          "This project has a newer version. Reload the project before making another change.",
          409,
        );
      generationRequest = { prompt: input.prompt };
      if (latest)
        generationRequest.currentApp = validateGeneratedApp(
          JSON.stringify(toAppVersion(latest).app),
        );
      if (previousUser.data)
        userMessage = messageSchema.parse(previousUser.data);
      else {
        const inserted = await db
          .from("messages")
          .insert({
            id: input.requestId,
            project_id: input.projectId,
            request_id: input.requestId,
            role: "user",
            content: input.prompt,
          })
          .select("*")
          .single();
        if (inserted.error) throw databaseError(inserted.error);
        userMessage = messageSchema.parse(inserted.data);
      }
    }
  } catch (error) {
    return projectErrorResponse(error);
  }

  const abortController = new AbortController();
  const signal = AbortSignal.any([abortController.signal, request.signal]);
  const encoder = new TextEncoder();
  let streamClosed = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerationEvent) => {
        if (!streamClosed)
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        send({ type: "message", message: userMessage });
        if (existing) {
          send({ type: "complete", saved: existing });
          return;
        }
        const provider = createAppGeneratorProvider();
        send({ type: "status", step: 0 });
        send({ type: "status", step: 1 });
        send({ type: "status", step: 2 });
        const raw = await provider.generate(generationRequest, signal);
        if (signal.aborted) throw new Error("Aborted");
        send({ type: "status", step: 3 });
        const app = validateGeneratedApp(raw);
        if (signal.aborted) throw new Error("Aborted");
        send({ type: "status", step: 4 });
        const saved = await db.rpc("forge_save_generation", {
          p_project_id: input.projectId,
          p_request_id: input.requestId,
          p_prompt: input.prompt,
          p_base_version_id: input.baseVersionId,
          p_app: app,
          p_model: provider.model,
        });
        if (saved.error) throw databaseError(saved.error);
        send({
          type: "complete",
          saved: savedGenerationSchema.parse(saved.data),
        });
      } catch (error) {
        let failure = timedOut
          ? new GenerationError(
              "GENERATION_TIMEOUT",
              "Generation timed out. Retry this request or describe a simpler application.",
              504,
            )
          : signal.aborted
            ? new GenerationError(
                "GENERATION_CANCELLED",
                "Generation was interrupted. Retry the request to recover any saved result.",
              )
            : publicGenerationError(error);
        const reply = await db
          .from("messages")
          .upsert(
            {
              project_id: input.projectId,
              request_id: input.requestId,
              role: "assistant",
              content: failure.message,
            },
            { onConflict: "project_id,request_id,role" },
          )
          .select("*")
          .single();
        if (reply.error) failure = databaseError(reply.error);
        else
          send({ type: "message", message: messageSchema.parse(reply.data) });
        send({ type: "error", code: failure.code, message: failure.message });
      } finally {
        clearTimeout(timer);
        if (!streamClosed) {
          streamClosed = true;
          controller.close();
        }
      }
    },
    cancel() {
      streamClosed = true;
      clearTimeout(timer);
      abortController.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
