import "server-only";
import { GenerationError } from "./errors";

export function generationDeadline(request: Request, startedAt: number) {
  const timeout = Number(process.env.GENERATION_TIMEOUT_MS || 120000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000)
    throw new GenerationError(
      "CONFIGURATION_ERROR",
      "GENERATION_TIMEOUT_MS must be between 1000 and 120000.",
      503,
    );
  const deadlineAt = startedAt + timeout;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, request.signal]);
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(0, deadlineAt - Date.now()),
  );
  function check() {
    if (signal.aborted || Date.now() >= deadlineAt)
      throw new GenerationError(
        "GENERATION_TIMEOUT",
        "The request timed out or was interrupted. Reload the project to check its saved result, then retry.",
        504,
      );
  }
  return {
    signal,
    deadlineAt: new Date(deadlineAt).toISOString(),
    check,
    waitFor<T>(work: PromiseLike<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        const aborted = () => {
          signal.removeEventListener("abort", aborted);
          reject(
            new GenerationError(
              "GENERATION_TIMEOUT",
              "The request timed out or was interrupted. Reload to check its saved result, then retry.",
              504,
            ),
          );
        };
        if (signal.aborted) {
          aborted();
          return;
        }
        signal.addEventListener("abort", aborted, { once: true });
        Promise.resolve(work)
          .then((value) => {
            try {
              check();
              resolve(value);
            } catch (error) {
              reject(error);
            }
          }, reject)
          .finally(() => signal.removeEventListener("abort", aborted));
      });
    },
    abort() {
      controller.abort();
    },
    close() {
      clearTimeout(timer);
    },
  };
}
