import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createStorageFetch, storageFailureMessages } from "./transport";
import {
  GenerationError,
  publicGenerationError,
} from "@/lib/generation/errors";

export function getSupabase(signal?: AbortSignal) {
  if (
    Number(process.versions.node.split(".")[0]) !== 24 ||
    typeof globalThis.WebSocket !== "function"
  )
    throw new GenerationError(
      "UNSUPPORTED_RUNTIME",
      "This app requires Node.js 24 with its native WebSocket implementation. Switch to Node.js 24 and restart the server.",
      503,
    );
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new GenerationError(
      "DATABASE_CONFIGURATION_ERROR",
      "Project storage is not configured. Set SUPABASE_URL and a server-only SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in .env.local, then restart the server.",
      503,
    );
  }
  try {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Invalid URL");
    return createClient(url, key, {
      db: { retry: false },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: createStorageFetch(signal),
      },
    });
  } catch {
    throw new GenerationError(
      "DATABASE_CONFIGURATION_ERROR",
      "Project storage configuration is invalid. Check SUPABASE_URL, the server API key and HTTP_PROXY / HTTPS_PROXY.",
      503,
    );
  }
}

export function databaseError(
  error: { code?: string; message?: string } | null,
) {
  const transportCode = error?.message?.match(/^(DATABASE_[A-Z_]+):/)?.[1];
  if (transportCode && Object.hasOwn(storageFailureMessages, transportCode))
    return new GenerationError(
      transportCode,
      storageFailureMessages[transportCode],
      503,
    );
  if (["42501", "PGRST301", "PGRST302", "PGRST303"].includes(error?.code || ""))
    return new GenerationError(
      "DATABASE_AUTH_ERROR",
      storageFailureMessages.DATABASE_AUTH_ERROR,
      503,
    );
  if (["42P01", "PGRST202", "PGRST205", "42703"].includes(error?.code || "")) {
    return new GenerationError(
      "DATABASE_SCHEMA_MISSING",
      "Project storage schema is missing or outdated. Run the pending SQL files in supabase/migrations in order, then retry.",
      503,
    );
  }
  if (error?.code === "40001")
    return new GenerationError(
      "PROJECT_CHANGED",
      "This project has a newer version. Reload the project before making another change.",
      409,
    );
  if (error?.code === "P0002")
    return new GenerationError(
      "PROJECT_NOT_FOUND",
      "This project or version does not exist in your session.",
      404,
    );
  if (error?.code === "55P03")
    return new GenerationError(
      "GENERATION_IN_PROGRESS",
      "Another request is already running in your session. Wait for it to finish or reload its project.",
      409,
    );
  if (error?.code === "P0429")
    return new GenerationError(
      "DEMO_RATE_LIMIT",
      "The demo generation limit has been reached. Please try again later.",
      429,
    );
  if (error?.code === "57014")
    return new GenerationError(
      "GENERATION_TIMEOUT",
      "The request expired or was interrupted. Reload the project to check its saved result, then retry if needed.",
      504,
    );
  if (error?.code === "22023")
    return new GenerationError(
      "INVALID_REQUEST",
      "This request ID was reused for a different operation or prompt.",
      409,
    );
  return new GenerationError(
    "DATABASE_UNAVAILABLE",
    "Project storage is unavailable. Check the Supabase connection and permissions, then retry. Existing saved data is kept.",
    503,
  );
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url);
  const host = request.headers.get("host");
  if (host) expected.host = host;
  if (origin && origin !== expected.origin)
    throw new GenerationError(
      "INVALID_ORIGIN",
      "Requests must come from this application.",
      403,
    );
}

export function projectErrorResponse(error: unknown) {
  const failure = publicGenerationError(error);
  return Response.json(
    { error: { code: failure.code, message: failure.message } },
    { status: failure.status, headers: { "Cache-Control": "no-store" } },
  );
}
