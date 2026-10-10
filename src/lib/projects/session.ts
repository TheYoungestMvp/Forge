import "server-only";
import {
  createHmac,
  randomUUID,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { GenerationError } from "@/lib/generation/errors";

const cookieName = "forge_session";
const lifetime = 30 * 24 * 60 * 60;

export function assertDemoAccess(request: Request) {
  const deployment =
    process.env.FORGE_DEPLOYMENT ||
    (process.env.NODE_ENV === "production" ? "public" : "local");
  const password = process.env.DEMO_ACCESS_PASSWORD || "";
  if (
    !["local", "public"].includes(deployment) ||
    (deployment === "public" &&
      (password.length < 12 ||
        (process.env.FORGE_SESSION_SECRET?.length || 0) < 32))
  )
    throw new GenerationError(
      "ACCESS_CONFIGURATION_ERROR",
      "Public demo access is not configured. Set FORGE_SESSION_SECRET (32+ characters) and DEMO_ACCESS_PASSWORD (12+ characters).",
      503,
    );
  if (!password) return;
  const authorization = request.headers.get("authorization") || "";
  const decoded = authorization.startsWith("Basic ")
    ? Buffer.from(authorization.slice(6), "base64").toString("utf8")
    : "";
  const provided = decoded.includes(":")
    ? decoded.slice(decoded.indexOf(":") + 1)
    : "";
  if (
    !timingSafeEqual(
      createHash("sha256").update(provided).digest(),
      createHash("sha256").update(password).digest(),
    )
  )
    throw new GenerationError(
      "DEMO_ACCESS_REQUIRED",
      "Enter the demo access password to continue.",
      401,
    );
}

function signingKey() {
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
  return createHmac("sha256", secret)
    .update("forge-anonymous-session-v1")
    .digest();
}

function signature(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function readSession(request: Request): string | null {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!raw || raw.length > 200) return null;
  const [version, id, expiration, supplied, extra] = raw.split(".");
  const expiresAt = Number(expiration);
  if (
    version !== "v1" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      id || "",
    ) ||
    extra ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= Date.now() / 1000 ||
    expiresAt > Date.now() / 1000 + lifetime + 60
  )
    return null;
  const expected = signature(`${version}.${id}.${expiration}`);
  const actual = Buffer.from(supplied || "");
  return actual.length === expected.length &&
    timingSafeEqual(actual, Buffer.from(expected))
    ? id
    : null;
}

export function requireSession(request: Request) {
  assertDemoAccess(request);
  const id = readSession(request);
  if (!id)
    throw new GenerationError(
      "SESSION_REQUIRED",
      "Your anonymous session is missing or expired. Reload the page to start a new session.",
      401,
    );
  return id;
}

export function issueSession(request: Request) {
  assertDemoAccess(request);
  const existing = readSession(request);
  if (existing) return { id: existing, cookie: null };
  const id = randomUUID();
  const payload = `v1.${id}.${Math.floor(Date.now() / 1000) + lifetime}`;
  const secure =
    new URL(request.url).protocol === "https:" ||
    process.env.FORGE_DEPLOYMENT === "public" ||
    (!process.env.FORGE_DEPLOYMENT && process.env.NODE_ENV === "production");
  return {
    id,
    cookie: `${cookieName}=${payload}.${signature(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetime}${secure ? "; Secure" : ""}`,
  };
}
