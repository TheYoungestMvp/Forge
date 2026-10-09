export class GenerationError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export function publicGenerationError(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error;
  return new GenerationError(
    "GENERATION_FAILED",
    "Generation failed unexpectedly. Please try again.",
  );
}
