import type { Frame } from "playwright";

export type CheckKind = "behavior" | "regression";

export type BehaviorCheck = {
  id: string;
  name: string;
  kind: CheckKind;
  run(frame: Frame): Promise<void>;
};

export type EvalTask = {
  id: string;
  name: string;
  sequenceId: string;
  kind: "create" | "modify";
  prompt: string;
  checks: BehaviorCheck[];
};

export type BrowserCheckResult = {
  id: string;
  name: string;
  kind: CheckKind;
  passed: boolean;
  status?: "passed" | "failed" | "not_run";
  error?: string;
};

export type BrowserEvaluation = {
  checks: BrowserCheckResult[];
  durationMs: number;
  runtimeErrors: string[];
  failureCode?: string;
  browserVersion?: string;
  fixedBrowserTime?: string;
};

export type BrowserOptions = {
  screenshotDir?: string;
  timeoutMs?: number;
  executablePath?: string;
};
