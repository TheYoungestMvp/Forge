import { z } from "zod";
import type { ModelCallRecord } from "../src/lib/ai/provider";
import type { Pricing, PricedCall, TaskResult } from "./report-types";

const rate = z.number().finite().nonnegative().nullable();
export const pricingSchema = z.strictObject({
  version: z.string().trim().min(1),
  currency: z.string().trim().min(1),
  model: z.string().trim().min(1),
  inputPerMillion: rate,
  outputPerMillion: rate,
  cachedInputPerMillion: rate.optional(),
});

export function priceCall(
  call: ModelCallRecord,
  pricing: Pricing | null,
): PricedCall {
  const { inputTokens, outputTokens, cachedInputTokens } = call.usage;
  let amount: number | null = null;
  if (
    pricing &&
    pricing.model === call.model &&
    pricing.inputPerMillion !== null &&
    pricing.outputPerMillion !== null &&
    inputTokens !== null &&
    outputTokens !== null
  ) {
    const cachedRate = pricing.cachedInputPerMillion;
    if (cachedRate === undefined || cachedRate === pricing.inputPerMillion) {
      amount =
        (inputTokens * pricing.inputPerMillion +
          outputTokens * pricing.outputPerMillion) /
        1_000_000;
    } else if (
      cachedRate !== null &&
      cachedInputTokens !== null &&
      cachedInputTokens <= inputTokens
    ) {
      amount =
        ((inputTokens - cachedInputTokens) * pricing.inputPerMillion +
          cachedInputTokens * cachedRate +
          outputTokens * pricing.outputPerMillion) /
        1_000_000;
    }
  }
  return {
    ...call,
    cost: {
      amount,
      currency: pricing?.currency ?? null,
      pricingVersion: pricing?.version ?? null,
    },
  };
}

export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function ratio(passed: number, total: number) {
  return { passed, total, rate: total ? passed / total : null };
}

export function summarize(results: TaskResult[], mode: "fixture" | "live") {
  const attempted = results.filter(
    (result) => result.status === "passed" || result.status === "failed",
  );
  const passed = results.filter((result) => result.status === "passed");
  const modifications = results.filter((result) => result.kind === "modify");
  const checks = results.flatMap((result) => result.checks);
  const regressionChecks = checks.filter(
    (check) => check.kind === "regression",
  );
  const calls = results.flatMap((result) => result.calls);
  const unknownCostCalls = calls.filter(
    (call) => call.cost.amount === null,
  ).length;
  const knownEstimatedCost = calls.reduce(
    (total, call) => total + (call.cost.amount ?? 0),
    0,
  );
  const totalEstimatedCost =
    mode === "fixture" || unknownCostCalls ? null : knownEstimatedCost;
  const byFailure: Record<string, number> = {};
  for (const result of results) {
    if (result.failureCode)
      byFailure[result.failureCode] = (byFailure[result.failureCode] ?? 0) + 1;
  }
  return {
    plannedTasks: results.length,
    attemptedTasks: attempted.length,
    blockedTasks: results.filter((result) => result.status === "blocked")
      .length,
    budgetSkippedTasks: results.filter(
      (result) => result.status === "skipped_budget",
    ).length,
    behaviorPass: ratio(passed.length, results.length),
    attemptedBehaviorPass: ratio(passed.length, attempted.length),
    assertionPass: ratio(
      checks.filter((check) => check.status === "passed").length,
      checks.length,
    ),
    modificationRegressionPass: ratio(
      modifications.filter((result) => result.status === "passed").length,
      modifications.length,
    ),
    retainedAssertionPass: ratio(
      regressionChecks.filter((check) => check.status === "passed").length,
      regressionChecks.length,
    ),
    regressedAssertions: results.reduce(
      (total, result) => total + result.regressedCheckIds.length,
      0,
    ),
    latencyMs: {
      attemptedP50: percentile(
        attempted.map((result) => result.durationMs),
        0.5,
      ),
      attemptedP95: percentile(
        attempted.map((result) => result.durationMs),
        0.95,
      ),
      passingP50: percentile(
        passed.map((result) => result.durationMs),
        0.5,
      ),
      passingP95: percentile(
        passed.map((result) => result.durationMs),
        0.95,
      ),
    },
    repairCount: results.reduce(
      (total, result) => total + result.repairCount,
      0,
    ),
    repairedTasks: results.filter((result) => result.repairCount > 0).length,
    modelCalls: calls.length,
    cost: {
      status:
        mode === "fixture"
          ? "fixture_no_model_calls"
          : unknownCostCalls
            ? "unknown"
            : "estimated",
      currency: calls.find((call) => call.cost.currency)?.cost.currency ?? null,
      knownEstimatedCost,
      unknownCostCalls,
      totalEstimatedCost,
      estimatedCostPerPassingTask:
        totalEstimatedCost !== null && passed.length
          ? totalEstimatedCost / passed.length
          : null,
    },
    failures: byFailure,
  };
}

export class EvaluationBudget {
  calls = 0;
  knownCost = 0;
  unknownCostCalls = 0;
  constructor(
    readonly maxCalls: number,
    readonly maxCost: number | null,
  ) {}
  check() {
    if (this.calls >= this.maxCalls)
      throw new EvaluationBudgetError("CALL_BUDGET_EXHAUSTED");
    if (
      this.maxCost !== null &&
      (this.unknownCostCalls > 0 || this.knownCost >= this.maxCost)
    ) {
      throw new EvaluationBudgetError(
        this.unknownCostCalls ? "COST_UNKNOWN" : "COST_BUDGET_EXHAUSTED",
      );
    }
  }
  reserveCall() {
    this.check();
    this.calls++;
  }
  record(call: PricedCall) {
    if (call.cost.amount === null) this.unknownCostCalls++;
    else this.knownCost += call.cost.amount;
  }
}

export class EvaluationBudgetError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
