import { assertSameOrigin, projectErrorResponse } from "@/lib/projects/server";
import { issueSession } from "@/lib/projects/session";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = issueSession(request);
    return Response.json(
      { id: session.id },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ...(session.cookie ? { "Set-Cookie": session.cookie } : {}),
        },
      },
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
}
