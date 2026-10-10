import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  GenerationError,
  publicGenerationError,
} from "@/lib/generation/errors";
import { generationDeadline } from "@/lib/generation/deadline";
import { validateGeneratedApp } from "@/lib/generation/validate";
import { pendingGenerationSchema } from "@/lib/generation/schema";
import {
  messageSchema,
  restoreRequestSchema,
  restoredVersionSchema,
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
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const startedAt = Date.now();
  let deadline: ReturnType<typeof generationDeadline> | undefined;
  let ownerId = "",
    projectId = "",
    requestId = "";
  const runToken = randomUUID();
  let claimed = false;
  let userMessage: z.infer<typeof messageSchema> | undefined;
  try {
    deadline = generationDeadline(request, startedAt);
    assertSameOrigin(request);
    ownerId = requireSession(request);
    projectId = (await params).projectId;
    if (!z.uuid().safeParse(projectId).success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The project ID is invalid.",
        400,
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new GenerationError(
        "INVALID_REQUEST",
        "Send the restore request as application/json.",
        415,
      );
    const raw = await deadline.waitFor(request.text());
    deadline.check();
    if (Buffer.byteLength(raw) > 4096)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The restore request is too large.",
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
    const parsed = restoreRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "Provide valid versionId, requestId and baseVersionId values.",
        400,
      );
    const input = parsed.data;
    requestId = input.requestId;
    const db = getSupabase(deadline.signal);
    // Check ownership before reading any source code with the privileged client.
    const project = await deadline.waitFor(
      db
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("owner_id", ownerId)
        .maybeSingle(),
    );
    if (project.error) throw databaseError(project.error);
    if (!project.data) throw databaseError({ code: "P0002" });
    const sourceResult = await deadline.waitFor(
      db
        .from("versions")
        .select("*")
        .eq("project_id", projectId)
        .eq("id", input.versionId)
        .maybeSingle(),
    );
    if (sourceResult.error) throw databaseError(sourceResult.error);
    if (!sourceResult.data)
      throw new GenerationError(
        "VERSION_NOT_FOUND",
        "This version does not exist in your project.",
        404,
      );
    const source = versionSchema.parse(sourceResult.data);
    let app;
    try {
      app = validateGeneratedApp(JSON.stringify(toAppVersion(source).app));
    } catch {
      throw new GenerationError(
        "INVALID_STORED_VERSION",
        "This stored version does not pass validation. Choose another version.",
        422,
      );
    }
    deadline.check();
    const begin = await deadline.waitFor(
      db.rpc("forge_begin_generation", {
        p_owner_id: ownerId,
        p_project_id: projectId,
        p_request_id: input.requestId,
        p_prompt: `Restore v${source.version_number}`,
        p_base_version_id: input.baseVersionId,
        p_run_token: runToken,
        p_deadline_at: deadline.deadlineAt,
        p_operation: "restore",
        p_source_version_id: source.id,
      }),
    );
    if (begin.error) throw databaseError(begin.error);
    if (begin.data.state === "processing")
      return Response.json(pendingGenerationSchema.parse(begin.data), {
        status: 202,
        headers: { "Cache-Control": "private, no-store" },
      });
    userMessage = messageSchema.parse(begin.data.userMessage);
    if (begin.data.state === "completed")
      return Response.json(
        restoredVersionSchema.parse({ ...begin.data.saved, userMessage }),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    claimed = true;
    deadline.check();
    const saved = await deadline.waitFor(
      db.rpc("forge_finish_generation", {
        p_owner_id: ownerId,
        p_project_id: projectId,
        p_request_id: input.requestId,
        p_run_token: runToken,
        p_app: app,
        p_model: source.model,
      }),
    );
    if (saved.error) throw databaseError(saved.error);
    deadline.check();
    return Response.json(
      restoredVersionSchema.parse({ ...saved.data, userMessage }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (deadline?.signal.aborted)
      error = new GenerationError(
        "GENERATION_TIMEOUT",
        "Restore timed out or was interrupted. Reload to check its saved result, then retry if needed.",
        504,
      );
    if (claimed) {
      const failure = publicGenerationError(error);
      const settled = await getSupabase(AbortSignal.timeout(5000)).rpc(
        "forge_fail_generation",
        {
          p_owner_id: ownerId,
          p_project_id: projectId,
          p_request_id: requestId,
          p_run_token: runToken,
          p_code: failure.code,
          p_message: failure.message,
        },
      );
      if (!settled.error && settled.data?.state === "completed" && userMessage)
        return Response.json(
          restoredVersionSchema.parse({ ...settled.data.saved, userMessage }),
          { headers: { "Cache-Control": "private, no-store" } },
        );
    }
    return projectErrorResponse(error);
  } finally {
    deadline?.close();
  }
}
