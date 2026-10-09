import { z } from "zod";
import { GenerationError } from "@/lib/generation/errors";
import { createProjectSchema, projectSchema } from "@/lib/projects/schema";
import {
  assertSameOrigin,
  databaseError,
  getSupabase,
  projectErrorResponse,
} from "@/lib/projects/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await getSupabase()
      .from("projects")
      .select("id,name,created_at,updated_at")
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
    const { data, error } = await getSupabase()
      .from("projects")
      .insert(result.data)
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
