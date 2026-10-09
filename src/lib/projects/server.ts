import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  GenerationError,
  publicGenerationError,
} from "@/lib/generation/errors";

export function getSupabase() {
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
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: "no-store",
            signal: AbortSignal.any([
              AbortSignal.timeout(10000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
    });
  } catch {
    throw new GenerationError(
      "DATABASE_CONFIGURATION_ERROR",
      "Project storage configuration is invalid. Check SUPABASE_URL and the server API key.",
      503,
    );
  }
}

export function databaseError(error: { code?: string } | null) {
  if (["42P01", "PGRST202", "PGRST205", "42703"].includes(error?.code || "")) {
    return new GenerationError(
      "DATABASE_SCHEMA_MISSING",
      "Project storage tables or functions are missing. Run supabase/migrations/001_persistence.sql in your Supabase SQL Editor, then retry.",
      503,
    );
  }
  if (error?.code === "40001")
    return new GenerationError(
      "PROJECT_CHANGED",
      "This project has a newer version. Reload the project before making another change.",
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
