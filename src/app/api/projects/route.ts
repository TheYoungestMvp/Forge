import { z } from "zod";
import { GenerationError } from "@/lib/generation/errors";
import { createProjectSchema, projectSchema } from "@/lib/projects/schema";
import { requireSession } from "@/lib/projects/session";
import {
  assertSameOrigin,
  databaseError,
  getSupabase,
  projectErrorResponse,
} from "@/lib/projects/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ownerId = requireSession(request);
    const { data, error } = await getSupabase(request.signal)
      .from("projects")
      .select("id,name,created_at,updated_at")
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false })
      .order("id");
    if (error) throw databaseError(error);
    return Response.json(z.array(projectSchema).parse(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ownerId = requireSession(request);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new GenerationError(
        "INVALID_REQUEST",
        "Send a project name as application/json.",
        415,
      );
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The project name request is too large.",
        413,
      );
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new GenerationError(
        "INVALID_REQUEST",
        "The request must be valid JSON.",
        400,
      );
    }
    const result = createProjectSchema.safeParse(body);
    if (!result.success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "Enter a project name containing 1–120 characters.",
        400,
      );
    const { data, error } = await getSupabase(request.signal)
      .from("projects")
      .insert({ ...result.data, owner_id: ownerId })
      .select("id,name,created_at,updated_at")
      .single();
    if (error) throw databaseError(error);
    return Response.json(projectSchema.parse(data), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
