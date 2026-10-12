import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { GenerationError } from "@/lib/generation/errors";

const cookieName = "forge_access";
const lifetime = 7 * 24 * 60 * 60;

function configuration() {
  const deployment =
    process.env.FORGE_DEPLOYMENT ||
    (process.env.NODE_ENV === "production" ? "public" : "local");
  const password = process.env.DEMO_ACCESS_PASSWORD || "";
  const username = (process.env.FORGE_LOGIN_USERNAME ?? "demo").trim();
  if (
    !["local", "public"].includes(deployment) ||
    !username ||
    username.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(username) ||
    (deployment === "public" &&
      (password.length < 12 ||
        (process.env.FORGE_SESSION_SECRET?.length || 0) < 32))
  ) {
    throw new GenerationError(
      "ACCESS_CONFIGURATION_ERROR",
      "Public demo access is not configured. Set FORGE_SESSION_SECRET (32+ characters) and DEMO_ACCESS_PASSWORD (12+ characters).",
      503,
    );
  }
  return { deployment, username, password };
}

function equal(left: string, right: string) {
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

function signature(payload: string, username: string, password: string) {
  const secret =
    process.env.FORGE_SESSION_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret)
    throw new GenerationError(
      "SESSION_CONFIGURATION_ERROR",
      "Anonymous sessions are not configured. Set FORGE_SESSION_SECRET on the server.",
      503,
    );
  const key = createHmac("sha256", secret)
    .update("forge-demo-access-v1")
    .update(JSON.stringify([username, password]))
    .digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function hasAccessCookie(request: Request, username: string, password: string) {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!raw || raw.length > 120) return false;
  const [version, expiration, supplied, extra] = raw.split(".");
  const expiresAt = Number(expiration);
  const now = Date.now() / 1000;
  if (
    version !== "v1" ||
    extra ||
    !supplied ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + lifetime + 60
  )
    return false;
  return equal(
    supplied,
    signature(`${version}.${expiration}`, username, password),
  );
}

export function assertDemoAccess(request: Request) {
  const { username, password } = configuration();
  if (!password || hasAccessCookie(request, username, password)) return;
  throw new GenerationError(
    "DEMO_ACCESS_REQUIRED",
    "Sign in with your username and password to continue.",
    401,
  );
}

export function issueDemoAccess(
  request: Request,
  providedUsername: string,
  providedPassword: string,
) {
  const { deployment, username, password } = configuration();
  const usernameMatches = equal(providedUsername.trim(), username);
  const passwordMatches = equal(providedPassword, password);
  if (password && (!usernameMatches || !passwordMatches))
    throw new GenerationError(
      "DEMO_ACCESS_REQUIRED",
      "用户名或密码不正确，请检查后重试。",
      401,
    );
  if (!password) return null;
  const payload = `v1.${Math.floor(Date.now() / 1000) + lifetime}`;
  const secure =
    deployment === "public" || new URL(request.url).protocol === "https:";
  return `${cookieName}=${payload}.${signature(payload, username, password)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetime}${secure ? "; Secure" : ""}`;
}
