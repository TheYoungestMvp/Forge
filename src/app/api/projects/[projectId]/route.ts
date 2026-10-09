import { z } from "zod";
import { GenerationError } from "@/lib/generation/errors";
import { validateGeneratedApp } from "@/lib/generation/validate";
import { projectSnapshotSchema, toAppVersion } from "@/lib/projects/schema";
import {
  databaseError,
  getSupabase,
  projectErrorResponse,
} from "@/lib/projects/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    if (!z.uuid().safeParse(projectId).success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The project ID is invalid.",
        400,
      );
    const db = getSupabase();
    const projectResult = await db
      .from("projects")
      .select("id,name,created_at,updated_at")
      .eq("id", projectId)
      .maybeSingle();
    if (projectResult.error) throw databaseError(projectResult.error);
    if (!projectResult.data)
      throw new GenerationError(
        "PROJECT_NOT_FOUND",
        "This project does not exist. Choose a saved project or create a new one.",
        404,
      );
    const [messagesResult, versionsResult] = await Promise.all([
      db.from("messages").select("*").eq("project_id", projectId).order("seq"),
      db
        .from("versions")
        .select("*")
        .eq("project_id", projectId)
        .order("version_number"),
    ]);
    if (messagesResult.error || versionsResult.error)
      throw databaseError(messagesResult.error || versionsResult.error);
    const snapshot = projectSnapshotSchema.parse({
      project: projectResult.data,
      messages: messagesResult.data,
      versions: versionsResult.data,
    });
    const latest = snapshot.versions.at(-1);
    if (latest) validateGeneratedApp(JSON.stringify(toAppVersion(latest).app));
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
