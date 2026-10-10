import { z } from "zod";
import { GenerationError } from "@/lib/generation/errors";
import { validateGeneratedApp } from "@/lib/generation/validate";
import { projectSnapshotSchema, toAppVersion } from "@/lib/projects/schema";
import { requireSession } from "@/lib/projects/session";
import {
  assertSameOrigin,
  databaseError,
  getSupabase,
  projectErrorResponse,
} from "@/lib/projects/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    assertSameOrigin(request);
    const ownerId = requireSession(request);
    const { projectId } = await params;
    if (!z.uuid().safeParse(projectId).success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The project ID is invalid.",
        400,
      );
    const result = await getSupabase(request.signal).rpc(
      "forge_delete_project",
      {
        p_owner_id: ownerId,
        p_project_id: projectId,
      },
    );
    if (result.error) {
      if (result.error.code === "55P03")
        throw new GenerationError(
          "GENERATION_IN_PROGRESS",
          "This project is still generating or restoring a version. Wait for it to finish, reload the project, then try deleting it again.",
          409,
        );
      throw databaseError(result.error);
    }
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const ownerId = requireSession(request);
    const { projectId } = await params;
    if (!z.uuid().safeParse(projectId).success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The project ID is invalid.",
        400,
      );
    const result = await getSupabase(request.signal).rpc("forge_load_project", {
      p_owner_id: ownerId,
      p_project_id: projectId,
      p_status_only: new URL(request.url).searchParams.get("view") === "status",
    });
    if (result.error) throw databaseError(result.error);
    const snapshot = projectSnapshotSchema.parse(result.data);
    const latest = snapshot.versions.at(-1);
    if (latest) validateGeneratedApp(JSON.stringify(toAppVersion(latest).app));
    return Response.json(snapshot, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
