export type ModelCallPhase = "plan" | "generate" | "repair";

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  totalTokens: number | null;
}

export interface ModelCallSettings {
  outputMode: string;
  tokenField: string;
  tokenBudget: number;
  thinkingMode: string | null;
}

export interface ModelCallRecord {
  phase: ModelCallPhase;
  model: string;
  durationMs: number;
  status: "success" | "error";
  errorCode?: string;
  usage: ModelUsage;
  settings: ModelCallSettings;
}

export interface ProviderTelemetryOptions {
  onCall?: (call: ModelCallRecord) => void;
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** Missing or malformed provider accounting remains unknown, including cache use. */
export function readModelUsage(data: unknown): ModelUsage {
  const usage =
    data !== null && typeof data === "object" && "usage" in data
      ? data.usage
      : undefined;
  const values =
    usage !== null && typeof usage === "object"
      ? (usage as Record<string, unknown>)
      : {};
  const details = values.prompt_tokens_details;
  const cached =
    details !== null &&
    typeof details === "object" &&
    "cached_tokens" in details
      ? tokenCount(details.cached_tokens)
      : null;
  return {
    inputTokens: tokenCount(values.prompt_tokens),
    outputTokens: tokenCount(values.completion_tokens),
    cachedInputTokens: cached ?? tokenCount(values.prompt_cache_hit_tokens),
    totalTokens: tokenCount(values.total_tokens),
  };
}
