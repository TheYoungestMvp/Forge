import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { EnvHttpProxyAgent, type Dispatcher } from "undici";

// Reuse tunnels across clients and Next.js hot reloads. The native fetch defaults
// close idle connections after 4 seconds and time out TLS handshakes after 10.
const transportGlobal = globalThis as typeof globalThis & {
  forgeStorageTransport?: { key: string; dispatcher: EnvHttpProxyAgent };
};

export function storageDispatcher() {
  const httpProxy = process.env.http_proxy ?? process.env.HTTP_PROXY ?? "";
  const httpsProxy = process.env.https_proxy ?? process.env.HTTPS_PROXY ?? "";
  const noProxy = process.env.no_proxy ?? process.env.NO_PROXY ?? "";
  const key = JSON.stringify([httpProxy, httpsProxy, noProxy]);
  if (transportGlobal.forgeStorageTransport?.key !== key) {
    const dispatcher = new EnvHttpProxyAgent({
      httpProxy,
      httpsProxy,
      noProxy,
      connections: 2,
      connectTimeout: 15000,
      requestTls: { timeout: 15000 },
      proxyTls: { timeout: 15000 },
      keepAliveTimeout: 60000,
      keepAliveMaxTimeout: 120000,
    });
    void transportGlobal.forgeStorageTransport?.dispatcher
      .close()
      .catch(() => {});
    transportGlobal.forgeStorageTransport = { key, dispatcher };
  }
  return transportGlobal.forgeStorageTransport!.dispatcher;
}

export const storageFailureMessages: Record<string, string> = {
  DATABASE_NETWORK_TIMEOUT:
    "The project storage connection timed out after reconnecting. Check your proxy or network, then retry. Saved data is kept.",
  DATABASE_PROXY_UNAVAILABLE:
    "The configured local proxy is unavailable. Start your proxy application or correct HTTP_PROXY / HTTPS_PROXY, then retry. Saved data is kept.",
  DATABASE_NETWORK_BLOCKED:
    "The server's network access is blocked. Start the server in a terminal with network access, then retry. Saved data is kept.",
  DATABASE_NETWORK_ERROR:
    "The project storage connection was interrupted after reconnecting. Check your proxy or network, then retry. Saved data is kept.",
  DATABASE_AUTH_ERROR:
    "Supabase rejected the storage credentials or permissions. Check the server-only Supabase secret and database grants, then retry. Saved data is kept.",
  DATABASE_WRITE_UNCONFIRMED:
    "The connection was interrupted before the save could be confirmed. Reload the project to check its saved result before retrying.",
  DATABASE_REQUEST_CANCELLED:
    "The storage request was cancelled. Reload the project to check its saved result before retrying.",
};

class StorageTransportError extends Error {
  constructor(code: string) {
    super(storageFailureMessages[code]);
    // PostgREST wraps fetch errors as strings, so keep a safe, machine-readable
    // tag in the name instead of losing the original failure category.
    this.name = code;
  }
}

function networkCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const value = current as {
      code?: unknown;
      cause?: unknown;
      name?: string;
      message?: string;
    };
    if (
      value.code === "ECONNRESET" &&
      value.message ===
        "Client network socket disconnected before secure TLS connection was established"
    )
      return "TLS_HANDSHAKE_RESET";
    if (typeof value.code === "string") return value.code;
    if (!value.cause) return value.name || "UNKNOWN";
    current = value.cause;
  }
  return "UNKNOWN";
}

// These failures happen while establishing a connection, before an HTTP write
// is sent. Unknown errors / resets may occur AFTER a commit and are not safe.
const beforeSendErrors = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "TLS_HANDSHAKE_RESET",
]);
const transientErrors = new Set([
  ...beforeSendErrors,
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
  "TimeoutError",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const replayableRpcs = new Set([
  "forge_load_project",
  "forge_advance_generation",
  "forge_finish_generation",
  "forge_fail_generation",
]);

function replayable(method: string, url: URL) {
  if (method === "GET" || method === "HEAD") return true;
  // Each of these RPCs is fenced or returns its previously committed result.
  // Begin-generation, project insertion and deletion are deliberately excluded.
  return (
    method === "POST" &&
    url.pathname.startsWith("/rest/v1/rpc/") &&
    replayableRpcs.has(url.pathname.slice("/rest/v1/rpc/".length))
  );
}

export function createStorageFetch(parentSignal?: AbortSignal) {
  const dispatcher = storageDispatcher();
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const safe = replayable(method, url);
    const callerSignal = AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      ...(parentSignal ? [parentSignal] : []),
    ]);
    const budget = AbortSignal.timeout(30000);
    const startedAt = Date.now();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const attemptTimeout = AbortSignal.timeout(15000);
      const signal = AbortSignal.any([callerSignal, budget, attemptTimeout]);
      let code = "UNKNOWN";
      let status: number | undefined;
      try {
        signal.throwIfAborted();
        const options: RequestInit & { dispatcher: Dispatcher } = {
          ...init,
          cache: "no-store",
          signal,
          dispatcher,
        };
        const response = await fetch(input, options);
        status = response.status;
        // Include response-body resets in the same retry and deadline policy.
        const body = await response.arrayBuffer();
        signal.throwIfAborted();
        if (status === 401 || status === 403) {
          code = "DATABASE_AUTH_ERROR";
          throw new StorageTransportError(code);
        }
        if ([502, 503, 504].includes(status) && safe) {
          code = "HTTP_" + status;
          throw new Error(code);
        }
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(
          method === "HEAD" || [204, 205, 304].includes(status) ? null : body,
          {
            status,
            statusText: response.statusText,
            headers,
          },
        );
      } catch (error) {
        if (callerSignal.aborted)
          throw new StorageTransportError("DATABASE_REQUEST_CANCELLED");
        if (code === "UNKNOWN") code = networkCode(error);
        if (attemptTimeout.aborted || budget.aborted) code = "TimeoutError";
        const retry =
          !budget.aborted &&
          attempt < 3 &&
          (beforeSendErrors.has(code) ||
            (safe && (transientErrors.has(code) || code.startsWith("HTTP_"))));
        // Never log headers, query strings, keys, cookies, request bodies or raw
        // exception messages. Only stable transport metadata belongs in logs.
        console.warn(
          "[storage]",
          JSON.stringify({
            host: url.hostname,
            operation: url.pathname,
            method,
            attempt,
            code,
            status,
            elapsedMs: Date.now() - startedAt,
            retry,
          }),
        );
        if (!retry) {
          if (error instanceof StorageTransportError) throw error;
          const failure =
            code === "EACCES" || code === "EPERM"
              ? "DATABASE_NETWORK_BLOCKED"
              : !safe && !beforeSendErrors.has(code)
                ? "DATABASE_WRITE_UNCONFIRMED"
                : code === "TimeoutError" ||
                    code.endsWith("TIMEOUT") ||
                    code === "HTTP_504"
                  ? "DATABASE_NETWORK_TIMEOUT"
                  : code === "ECONNREFUSED" &&
                      (process.env.https_proxy ||
                        process.env.HTTPS_PROXY ||
                        process.env.http_proxy ||
                        process.env.HTTP_PROXY)
                    ? "DATABASE_PROXY_UNAVAILABLE"
                    : "DATABASE_NETWORK_ERROR";
          throw new StorageTransportError(failure);
        }
        try {
          await delay(attempt * 250, undefined, {
            signal: AbortSignal.any([callerSignal, budget]),
          });
        } catch {
          throw new StorageTransportError(
            callerSignal.aborted
              ? "DATABASE_REQUEST_CANCELLED"
              : "DATABASE_NETWORK_TIMEOUT",
          );
        }
      }
    }
    throw new StorageTransportError("DATABASE_NETWORK_ERROR");
  };
}
