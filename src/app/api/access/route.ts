import { GenerationError } from "@/lib/generation/errors";
import { issueDemoAccess } from "@/lib/projects/demo-access";
import { assertSameOrigin, projectErrorResponse } from "@/lib/projects/server";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    // Signing out of demo access never removes the anonymous project identity.
    const secure =
      new URL(request.url).protocol === "https:" ||
      process.env.FORGE_DEPLOYMENT === "public";
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Set-Cookie": `forge_access=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`,
        },
      },
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new GenerationError(
        "INVALID_REQUEST",
        "请通过登录页面提交用户名和密码。",
        415,
      );
    }
    const reader = request.body?.getReader();
    if (!reader)
      throw new GenerationError("INVALID_REQUEST", "请输入用户名和密码。", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          throw new GenerationError(
            "INVALID_REQUEST",
            "密码过长，请检查后重试。",
            413,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new GenerationError(
        "INVALID_REQUEST",
        "请求格式不正确，请重试。",
        400,
      );
    }
    if (
      !body ||
      typeof body.username !== "string" ||
      !body.username.trim() ||
      body.username.length > 128 ||
      typeof body.password !== "string" ||
      !body.password ||
      body.password.length > 1024
    ) {
      throw new GenerationError(
        "INVALID_REQUEST",
        "请输入有效的用户名和密码。",
        400,
      );
    }
    const cookie = issueDemoAccess(request, body.username, body.password);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "private, no-store",
          ...(cookie ? { "Set-Cookie": cookie } : {}),
        },
      },
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
}
