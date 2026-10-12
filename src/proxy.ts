import { NextResponse, type NextRequest } from "next/server";
import { assertDemoAccess } from "@/lib/projects/session";
import { publicGenerationError } from "@/lib/generation/errors";

export function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/access"
  ) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  try {
    assertDemoAccess(request);
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const failure = publicGenerationError(error);
    if (
      failure.status === 401 &&
      !request.nextUrl.pathname.startsWith("/api/")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      if (request.nextUrl.pathname !== "/" || request.nextUrl.search) {
        url.searchParams.set(
          "next",
          request.nextUrl.pathname + request.nextUrl.search,
        );
      }
      const response = NextResponse.redirect(url);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return NextResponse.json(
      { error: { code: failure.code, message: failure.message } },
      {
        status: failure.status,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
