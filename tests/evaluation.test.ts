import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AppGeneratorProvider,
  ModelCallRecord,
} from "../src/lib/ai/provider";
import { generationDeadline } from "../src/lib/generation/deadline";
import { GenerationError } from "../src/lib/generation/errors";
import {
  runAppGeneration,
  type GenerationPhase,
} from "../src/lib/generation/run";
import type { AppPlan, GeneratedApp } from "../src/lib/generation/schema";
import {
  EvaluationBudget,
  EvaluationBudgetError,
  percentile,
  priceCall,
  pricingSchema,
  summarize,
} from "../evals/metrics";
import type { CheckResult, Pricing, TaskResult } from "../evals/report-types";

const pricing: Pricing = {
  version: "manual-2026-10-13",
  currency: "USD",
  model: "test-model",
  inputPerMillion: 2,
  outputPerMillion: 8,
};

function call(overrides: Partial<ModelCallRecord> = {}): ModelCallRecord {
  return {
    phase: "generate",
    model: "test-model",
    durationMs: 30,
    status: "success",
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: null,
      totalTokens: 1500,
    },
    settings: {
      outputMode: "json_schema",
      tokenField: "max_completion_tokens",
      tokenBudget: 12000,
      thinkingMode: null,
    },
    ...overrides,
  };
}

test("call cost requires complete usage, matching model and versioned finite prices", () => {
  assert.equal(priceCall(call(), pricing).cost.amount, 0.006);
  for (const incomplete of [
    { ...call().usage, inputTokens: null },
    { ...call().usage, outputTokens: null },
  ])
    assert.equal(
      priceCall(call({ usage: incomplete }), pricing).cost.amount,
      null,
    );
  assert.equal(priceCall(call(), null).cost.amount, null);
  assert.equal(
    priceCall(call({ model: "different-model" }), pricing).cost.amount,
    null,
  );
  assert.equal(
    priceCall(call(), { ...pricing, inputPerMillion: null }).cost.amount,
    null,
  );
  assert.equal(
    priceCall(call(), { ...pricing, outputPerMillion: null }).cost.amount,
    null,
  );
  assert.equal(priceCall(call(), pricing).cost.pricingVersion, pricing.version);
  assert.equal(
    pricingSchema.safeParse({ ...pricing, version: " " }).success,
    false,
  );
  assert.equal(
    pricingSchema.safeParse({ ...pricing, inputPerMillion: -1 }).success,
    false,
  );
  assert.equal(
    pricingSchema.safeParse({ ...pricing, outputPerMillion: Infinity }).success,
    false,
  );
});

test("cached-token discounts are priced only when cache usage is known and valid", () => {
  const discount = { ...pricing, cachedInputPerMillion: 0.5 };
  const usage = { ...call().usage, cachedInputTokens: 600 };
  assert.equal(priceCall(call({ usage }), discount).cost.amount, 0.0051);
  assert.equal(priceCall(call(), discount).cost.amount, null);
  assert.equal(
    priceCall(call({ usage: { ...usage, cachedInputTokens: 1001 } }), discount)
      .cost.amount,
    null,
  );
  assert.equal(
    priceCall(call({ usage }), { ...discount, cachedInputPerMillion: null })
      .cost.amount,
    null,
  );
  assert.equal(
    priceCall(call(), { ...discount, cachedInputPerMillion: 2 }).cost.amount,
    0.006,
  );
  assert.equal(
    priceCall(call({ usage: { ...usage, cachedInputTokens: 0 } }), discount)
      .cost.amount,
    0.006,
  );
});

function check(
  id: string,
  kind: CheckResult["kind"],
  status: CheckResult["status"],
): CheckResult {
  return { id, name: id, kind, status };
}

function task(taskId: string, overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId,
    sequenceId: "fixed-sequence",
    repeat: 1,
    kind: "create",
    status: "passed",
    startedAt: "2026-10-13T00:00:00.000Z",
    durationMs: 100,
    generationMs: 60,
    behaviorMs: 40,
    repairCount: 0,
    calls: [],
    checks: [check("behavior", "behavior", "passed")],
    regressedCheckIds: [],
    runtimeErrors: [],
    ...overrides,
  };
}

test("planned failure and unavailable tasks remain in behavior and modification denominators", () => {
  const results = [
    task("create"),
    task("modify-passed", {
      kind: "modify",
      durationMs: 300,
      repairCount: 1,
      checks: [
        check("old-a", "regression", "passed"),
        check("old-b", "regression", "passed"),
        check("new", "behavior", "passed"),
      ],
    }),
    task("modify-failed", {
      kind: "modify",
      status: "failed",
      durationMs: 800,
      repairCount: 1,
      failureCode: "BEHAVIOR_FAILED",
      checks: [
        check("old-a", "regression", "passed"),
        check("old-b", "regression", "failed"),
        check("new", "behavior", "failed"),
      ],
      regressedCheckIds: ["old-b"],
    }),
    task("modify-blocked", {
      kind: "modify",
      status: "blocked",
      failureCode: "BASELINE_UNAVAILABLE",
      durationMs: 0,
      checks: [
        check("old-a", "regression", "not_run"),
        check("old-b", "regression", "not_run"),
        check("new", "behavior", "not_run"),
      ],
    }),
    task("modify-skipped", {
      kind: "modify",
      status: "skipped_budget",
      failureCode: "CALL_BUDGET_EXHAUSTED",
      durationMs: 0,
      checks: [
        check("old-a", "regression", "not_run"),
        check("old-b", "regression", "not_run"),
        check("new", "behavior", "not_run"),
      ],
    }),
  ];
  const summary = summarize(results, "fixture");
  assert.equal(summary.plannedTasks, 5);
  assert.equal(summary.attemptedTasks, 3);
  assert.equal(summary.blockedTasks, 1);
  assert.equal(summary.budgetSkippedTasks, 1);
  assert.deepEqual(summary.behaviorPass, { passed: 2, total: 5, rate: 0.4 });
  assert.deepEqual(summary.attemptedBehaviorPass, {
    passed: 2,
    total: 3,
    rate: 2 / 3,
  });
  assert.deepEqual(summary.assertionPass, {
    passed: 5,
    total: 13,
    rate: 5 / 13,
  });
  assert.deepEqual(summary.modificationRegressionPass, {
    passed: 1,
    total: 4,
    rate: 0.25,
  });
  assert.deepEqual(summary.retainedAssertionPass, {
    passed: 3,
    total: 8,
    rate: 3 / 8,
  });
  assert.equal(summary.regressedAssertions, 1);
  assert.deepEqual(summary.latencyMs, {
    attemptedP50: 300,
    attemptedP95: 800,
    passingP50: 100,
    passingP95: 300,
  });
  assert.equal(summary.repairCount, 2);
  assert.equal(summary.repairedTasks, 2);
  assert.deepEqual(summary.failures, {
    BEHAVIOR_FAILED: 1,
    BASELINE_UNAVAILABLE: 1,
    CALL_BUDGET_EXHAUSTED: 1,
  });
  assert.equal(summary.cost.status, "fixture_no_model_calls");
  assert.equal(summary.cost.totalEstimatedCost, null);
});

test("unknown call cost keeps a known subtotal without claiming a complete total", () => {
  const priced = priceCall(call(), pricing);
  const unknown = priceCall(
    call({
      status: "error",
      errorCode: "PROVIDER_REQUEST_FAILED",
      usage: {
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        totalTokens: null,
      },
    }),
    pricing,
  );
  const summary = summarize(
    [
      task("known", { calls: [priced] }),
      task("failed", { status: "failed", calls: [unknown] }),
    ],
    "live",
  );
  assert.equal(summary.modelCalls, 2);
  assert.equal(summary.cost.status, "unknown");
  assert.equal(summary.cost.knownEstimatedCost, 0.006);
  assert.equal(summary.cost.unknownCostCalls, 1);
  assert.equal(summary.cost.totalEstimatedCost, null);
  assert.equal(summary.cost.estimatedCostPerPassingTask, null);
  const complete = summarize(
    [
      task("known", { calls: [priced] }),
      task("also-known", { calls: [priced] }),
    ],
    "live",
  );
  assert.equal(complete.cost.totalEstimatedCost, 0.012);
  assert.equal(complete.cost.estimatedCostPerPassingTask, 0.006);
  const empty = summarize([], "live");
  assert.deepEqual(empty.behaviorPass, { passed: 0, total: 0, rate: null });
  assert.equal(empty.latencyMs.attemptedP50, null);
  assert.equal(empty.cost.estimatedCostPerPassingTask, null);
});

test("latency uses nearest-rank percentiles and preserves input order", () => {
  const values = [80, 10, 40, 20];
  assert.equal(percentile(values, 0.5), 20);
  assert.equal(percentile(values, 0.95), 80);
  assert.equal(percentile([20], 0.95), 20);
  assert.equal(percentile([], 0.5), null);
  assert.deepEqual(values, [80, 10, 40, 20]);
});

function budgetCode(code: string) {
  return (error: unknown) =>
    error instanceof EvaluationBudgetError && error.code === code;
}

test("call budget checks every reservation including repairs without incrementing rejected calls", () => {
  const budget = new EvaluationBudget(2, null);
  budget.reserveCall();
  budget.reserveCall();
  assert.throws(
    () => budget.reserveCall(),
    budgetCode("CALL_BUDGET_EXHAUSTED"),
  );
  assert.equal(budget.calls, 2);
});

test("cost threshold and unknown costs stop future calls when a cost cap is configured", () => {
  const zero = new EvaluationBudget(10, 0);
  assert.throws(() => zero.reserveCall(), budgetCode("COST_BUDGET_EXHAUSTED"));
  assert.equal(zero.calls, 0);
  const budget = new EvaluationBudget(10, 0.005);
  budget.reserveCall();
  budget.record(priceCall(call(), pricing));
  assert.equal(budget.knownCost, 0.006);
  assert.throws(
    () => budget.reserveCall(),
    budgetCode("COST_BUDGET_EXHAUSTED"),
  );
  assert.equal(budget.calls, 1);
  const unknown = new EvaluationBudget(10, 1);
  unknown.reserveCall();
  unknown.record(priceCall(call(), null));
  assert.throws(() => unknown.reserveCall(), budgetCode("COST_UNKNOWN"));
  assert.equal(unknown.calls, 1);
  const uncapped = new EvaluationBudget(10, null);
  uncapped.reserveCall();
  uncapped.record(priceCall(call(), null));
  uncapped.reserveCall();
  assert.equal(uncapped.calls, 2);
});

const validApp: GeneratedApp = {
  title: "Counter",
  html: '<button type="button">Increment</button><output>0</output>',
  css: "button{padding:1rem}",
  javascript:
    "let n=0;document.querySelector('button').addEventListener('click',()=>{document.querySelector('output').textContent=String(++n)})",
};
const plan: AppPlan = {
  steps: [
    "Add a labeled increment button and count output",
    "Increment the displayed count on each click",
  ],
};

function mockProvider(outputs: (string | Error)[]) {
  const generated: { feedback?: string; plan?: AppPlan }[] = [];
  const provider: AppGeneratorProvider = {
    model: "test-model",
    async plan() {
      return plan;
    },
    async generate(_request, _signal, feedback, receivedPlan) {
      generated.push({ feedback, plan: receivedPlan });
      const output = outputs.shift();
      if (output instanceof Error) throw output;
      if (output === undefined)
        throw new Error("Unexpected extra generation call");
      return output;
    },
  };
  return { provider, generated };
}

function unlimitedDeadline() {
  return {
    signal: new AbortController().signal,
    check() {},
    async waitFor<T>(work: PromiseLike<T>) {
      return await work;
    },
  };
}

test("shared generation makes one static-validation repair and returns its count", async () => {
  const phases: GenerationPhase[] = [];
  const { provider, generated } = mockProvider([
    "invalid",
    JSON.stringify(validApp),
  ]);
  const result = await runAppGeneration(
    { prompt: "Counter" },
    provider,
    unlimitedDeadline(),
    async (phase) => {
      phases.push(phase);
    },
  );
  assert.deepEqual(
    { app: result.app, plan: result.plan, repairCount: result.repairCount },
    { app: validApp, plan, repairCount: 1 },
  );
  assert.equal(result.task.version, "1");
  assert.equal(result.tools.snapshot().used.modelCalls, 3);
  assert.equal(result.tools.snapshot().used.repairs, 1);
  assert.deepEqual(
    result.toolTrace.map((event) => event.tool),
    ["plan_app", "generate_app", "validate_app", "repair_app", "validate_app"],
  );
  assert.deepEqual(phases, [
    "planning",
    "generating",
    "validating",
    "repairing",
  ]);
  assert.equal(generated.length, 2);
  assert.equal(generated[0].feedback, undefined);
  assert.match(generated[1].feedback!, /valid JSON/);
  assert.deepEqual(
    generated.map((entry) => entry.plan),
    [plan, plan],
  );
});

test("repeated invalid output stops after one repair and exposes the repair attempt before throwing", async () => {
  const phases: GenerationPhase[] = [];
  const { provider, generated } = mockProvider(["invalid", "still invalid"]);
  await assert.rejects(
    runAppGeneration(
      { prompt: "Counter" },
      provider,
      unlimitedDeadline(),
      async (phase) => {
        phases.push(phase);
      },
    ),
    (error) =>
      error instanceof GenerationError &&
      error.code === "INVALID_GENERATED_APP",
  );
  assert.equal(generated.length, 2);
  assert.equal(phases.filter((phase) => phase === "repairing").length, 1);
});

test("provider errors and successful output do not trigger a repair", async () => {
  const error = new GenerationError(
    "PROVIDER_REQUEST_FAILED",
    "provider error",
  );
  const failing = mockProvider([error]);
  const failurePhases: GenerationPhase[] = [];
  await assert.rejects(
    runAppGeneration(
      { prompt: "Counter" },
      failing.provider,
      unlimitedDeadline(),
      async (phase) => {
        failurePhases.push(phase);
      },
    ),
    (caught) =>
      caught instanceof GenerationError &&
      caught.code === error.code &&
      caught.failure?.tool === "generate_app",
  );
  assert.equal(failing.generated.length, 1);
  assert.deepEqual(failurePhases, ["planning", "generating"]);
  const succeeding = mockProvider([JSON.stringify(validApp)]);
  const result = await runAppGeneration(
    { prompt: "Counter" },
    succeeding.provider,
    unlimitedDeadline(),
  );
  assert.equal(result.repairCount, 0);
  assert.equal(succeeding.generated.length, 1);
  let planned = 0;
  await assert.rejects(
    runAppGeneration(
      { prompt: "Counter" },
      {
        ...succeeding.provider,
        async plan() {
          planned++;
          throw error;
        },
      },
      unlimitedDeadline(),
    ),
    (caught) =>
      caught instanceof GenerationError &&
      caught.code === error.code &&
      caught.failure?.tool === "plan_app",
  );
  assert.equal(planned, 1);
  assert.equal(succeeding.generated.length, 1);
});

test("expired or interrupted generation deadline never starts repair or waits for an uncooperative provider", async () => {
  const expired = generationDeadline(
    new Request("http://localhost/eval"),
    Date.now() - 120001,
  );
  const first = mockProvider([JSON.stringify(validApp)]);
  try {
    await assert.rejects(
      runAppGeneration({ prompt: "Counter" }, first.provider, expired),
      (error) =>
        error instanceof GenerationError && error.code === "GENERATION_TIMEOUT",
    );
    assert.equal(first.generated.length, 0);
  } finally {
    expired.close();
  }

  const controller = new AbortController();
  const deadline = generationDeadline(
    new Request("http://localhost/eval", { signal: controller.signal }),
    Date.now(),
  );
  const phases: GenerationPhase[] = [];
  let generated = 0;
  const provider: AppGeneratorProvider = {
    model: "test-model",
    async plan() {
      return plan;
    },
    generate() {
      generated++;
      controller.abort();
      return new Promise<string>(() => {});
    },
  };
  try {
    await assert.rejects(
      runAppGeneration(
        { prompt: "Counter" },
        provider,
        deadline,
        async (phase) => {
          phases.push(phase);
        },
      ),
      (error) =>
        error instanceof GenerationError && error.code === "GENERATION_TIMEOUT",
    );
    assert.equal(generated, 1);
    assert.deepEqual(phases, ["planning", "generating"]);
  } finally {
    deadline.close();
  }
});

test("the same total deadline covers the repair call without granting a second timeout", async () => {
  const controller = new AbortController();
  const deadline = generationDeadline(
    new Request("http://localhost/eval", { signal: controller.signal }),
    Date.now(),
  );
  const phases: GenerationPhase[] = [];
  const signals: AbortSignal[] = [];
  let generated = 0;
  const provider: AppGeneratorProvider = {
    model: "test-model",
    async plan(_request, signal) {
      signals.push(signal);
      return plan;
    },
    generate(_request, signal) {
      signals.push(signal);
      generated++;
      if (generated === 1) return Promise.resolve("invalid");
      controller.abort();
      return new Promise<string>(() => {});
    },
  };
  try {
    await assert.rejects(
      runAppGeneration(
        { prompt: "Counter" },
        provider,
        deadline,
        async (phase) => {
          phases.push(phase);
        },
      ),
      (error) =>
        error instanceof GenerationError && error.code === "GENERATION_TIMEOUT",
    );
    assert.equal(generated, 2);
    assert.equal(phases.filter((phase) => phase === "repairing").length, 1);
    assert(signals.every((signal) => signal === deadline.signal));
    assert.equal(deadline.signal.aborted, true);
  } finally {
    deadline.close();
  }
});
