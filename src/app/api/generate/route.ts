import { createAppGeneratorProvider } from "@/lib/ai/provider";
import {
  GenerationError,
  publicGenerationError,
} from "@/lib/generation/errors";
import {
  generateRequestSchema,
  type GenerationEvent,
} from "@/lib/generation/schema";
import { validateGeneratedApp } from "@/lib/generation/validate";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  let prompt: string;
  let provider: ReturnType<typeof createAppGeneratorProvider>;
  let timeoutMs: number;
  try {
    const origin = request.headers.get("origin");
    const expectedOrigin = new URL(request.url);
    const host = request.headers.get("host");
    if (host) expectedOrigin.host = host;
    if (origin && origin !== expectedOrigin.origin)
      throw new GenerationError(
        "INVALID_ORIGIN",
        "Generation requests must come from this application.",
        403,
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new GenerationError(
        "INVALID_REQUEST",
        "Send the prompt as application/json.",
        415,
      );
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 24576)
      throw new GenerationError(
        "INVALID_REQUEST",
        "The prompt request is too large.",
        413,
      );
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new GenerationError(
        "INVALID_REQUEST",
        "The request body must be valid JSON.",
        400,
      );
    }
    const result = generateRequestSchema.safeParse(data);
    if (!result.success)
      throw new GenerationError(
        "INVALID_REQUEST",
        "Provide only a prompt containing 1–4000 characters.",
        400,
      );
    prompt = result.data.prompt;
    provider = createAppGeneratorProvider();
    timeoutMs = Number(process.env.GENERATION_TIMEOUT_MS || 120000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000)
      throw new GenerationError(
        "CONFIGURATION_ERROR",
        "GENERATION_TIMEOUT_MS must be between 1000 and 120000.",
        503,
      );
  } catch (error) {
    const failure = publicGenerationError(error);
    return Response.json(
      { error: { code: failure.code, message: failure.message } },
      { status: failure.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const abortController = new AbortController();
  const signal = AbortSignal.any([abortController.signal, request.signal]);
  const encoder = new TextEncoder();
  let streamClosed = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerationEvent) => {
        if (!streamClosed)
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        send({ type: "status", step: 0 });
        send({ type: "status", step: 1 });
        send({ type: "status", step: 2 });
        const raw = await provider.generate(prompt, signal);
        if (signal.aborted) throw new Error("Aborted");
        send({ type: "status", step: 3 });
        const app = validateGeneratedApp(raw);
        if (signal.aborted) throw new Error("Aborted");
        send({ type: "complete", app, model: provider.model });
      } catch (error) {
        const failure = timedOut
          ? new GenerationError(
              "GENERATION_TIMEOUT",
              "Generation timed out. Please try a simpler app or retry.",
              504,
            )
          : signal.aborted
            ? new GenerationError(
                "GENERATION_CANCELLED",
                "Generation was cancelled. Please try again.",
              )
            : publicGenerationError(error);
        send({ type: "error", code: failure.code, message: failure.message });
      } finally {
        clearTimeout(timer);
        if (!streamClosed) {
          streamClosed = true;
          controller.close();
        }
      }
    },
    cancel() {
      streamClosed = true;
      clearTimeout(timer);
      abortController.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
