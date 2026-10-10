import { NextResponse, type NextRequest } from "next/server";
import { assertDemoAccess } from "@/lib/projects/session";
import { publicGenerationError } from "@/lib/generation/errors";

export function proxy(request: NextRequest) {
  try {
    assertDemoAccess(request);
    return NextResponse.next();
  } catch (error) {
    const failure = publicGenerationError(error);
    return NextResponse.json(
      { error: { code: failure.code, message: failure.message } },
      {
        status: failure.status,
        headers: {
          "Cache-Control": "private, no-store",
          ...(failure.status === 401
            ? {
                "WWW-Authenticate": 'Basic realm="Forge demo", charset="UTF-8"',
              }
            : {}),
        },
      },
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
