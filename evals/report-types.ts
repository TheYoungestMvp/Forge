import type { ModelCallRecord } from "../src/lib/ai/provider";
import type { TaskSpec } from "../src/lib/generation/task";
import type { ToolResultEvent } from "../src/lib/generation/tools";

export type Pricing = {
  version: string;
  currency: string;
  model: string;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachedInputPerMillion?: number | null;
};

export type PricedCall = ModelCallRecord & {
  cost: {
    amount: number | null;
    currency: string | null;
    pricingVersion: string | null;
  };
};

export type CheckResult = {
  id: string;
  name: string;
  kind: "behavior" | "regression";
  status: "passed" | "failed" | "not_run";
  error?: string;
};

export type TaskResult = {
  taskId: string;
  sequenceId: string;
  repeat: number;
  kind: "create" | "modify";
  status: "passed" | "failed" | "blocked" | "skipped_budget";
  failureCode?: string;
  startedAt: string;
  durationMs: number;
  generationMs: number;
  behaviorMs: number;
  repairCount: number;
  calls: PricedCall[];
  checks: CheckResult[];
  regressedCheckIds: string[];
  runtimeErrors: string[];
  browserVersion?: string;
  fixedBrowserTime?: string;
  appHash?: string;
  baselineAppHash?: string;
  taskContract?: TaskSpec;
  taskFingerprint?: string;
  toolTrace?: ToolResultEvent[];
  artifactDir?: string;
};

export type RunMetadata = {
  schemaVersion: number;
  runId: string;
  mode: "fixture" | "live";
  startedAt: string;
  completedAt?: string;
  suiteVersion: string;
  suiteHash: string;
  codeHash: string;
  promptVersion: string;
  git: {
    commit: string | null;
    dirty: boolean | null;
    diffHash: string | null;
  };
  model: string | null;
  repeats: number;
  taskIds: string[];
  generationTimeoutMs: number;
  browserTimeoutMs: number;
  maxCalls: number;
  maxCost: number | null;
  pricing: Pricing | null;
  protocol: Record<string, string | null>;
};
