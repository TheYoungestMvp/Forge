import { z } from "zod";
import { GenerationError } from "@/lib/generation/errors";
import { validateGeneratedApp } from "@/lib/generation/validate";
import type { GeneratedApp } from "@/lib/generation/schema";
import {
  messageSchema,
  restoreRequestSchema,
  restoredVersionSchema,
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    assertSameOrigin(request);
    const { projectId } = await params;
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
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096)
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
    const db = getSupabase();
    const sourceResult = await db
      .from("versions")
      .select("*")
      .eq("project_id", projectId)
      .eq("id", input.versionId)
      .maybeSingle();
    if (sourceResult.error) throw databaseError(sourceResult.error);
    if (!sourceResult.data)
      throw new GenerationError(
        "VERSION_NOT_FOUND",
        "This version does not exist in the selected project. Reload the project and try again.",
        404,
      );
    const source = versionSchema.parse(sourceResult.data);
    let app: GeneratedApp;
    try {
      app = validateGeneratedApp(JSON.stringify(toAppVersion(source).app));
    } catch {
      throw new GenerationError(
        "INVALID_STORED_VERSION",
        "This stored version does not pass application validation and cannot be restored. Choose another version.",
        422,
      );
    }
    const prompt = `Restore v${source.version_number}`;
    const previousUser = await db
      .from("messages")
      .select("*")
      .eq("project_id", projectId)
      .eq("request_id", input.requestId)
      .eq("role", "user")
      .maybeSingle();
    if (previousUser.error) throw databaseError(previousUser.error);
    const existingResult = await db
      .from("versions")
      .select("*")
      .eq("id", input.requestId)
      .maybeSingle();
    if (existingResult.error) throw databaseError(existingResult.error);
    if (
      (previousUser.data && previousUser.data.content !== prompt) ||
      (existingResult.data &&
        (existingResult.data.project_id !== projectId ||
          existingResult.data.prompt !== prompt ||
          ["title", "html", "css", "javascript"].some(
            (field) =>
              existingResult.data[field] !== app[field as keyof typeof app],
          )))
    )
      throw new GenerationError(
        "INVALID_REQUEST",
        "A restore request ID cannot be reused for another operation.",
        409,
      );
    let userMessage;
    if (existingResult.data) {
      if (!previousUser.data) throw databaseError(null);
      userMessage = messageSchema.parse(previousUser.data);
    } else {
      const latest = await db
        .from("versions")
        .select("id")
        .eq("project_id", projectId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) throw databaseError(latest.error);
      if (latest.data?.id !== input.baseVersionId)
        throw databaseError({ code: "40001" });
      if (previousUser.data)
        userMessage = messageSchema.parse(previousUser.data);
      else {
        const inserted = await db
          .from("messages")
          .insert({
            id: input.requestId,
            project_id: projectId,
            request_id: input.requestId,
            role: "user",
            content: prompt,
          })
          .select("*")
          .single();
        if (inserted.error) throw databaseError(inserted.error);
        userMessage = messageSchema.parse(inserted.data);
      }
    }
    // The existing transaction appends a copy and keeps the complete history.
    // Its project lock also rejects a concurrent change after our head check.
    const saved = await db.rpc("forge_save_generation", {
      p_project_id: projectId,
      p_request_id: input.requestId,
      p_prompt: prompt,
      p_base_version_id: input.baseVersionId,
      p_app: app,
      p_model: source.model,
    });
    if (saved.error) throw databaseError(saved.error);
    return Response.json(
      restoredVersionSchema.parse({ ...saved.data, userMessage }),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
}
