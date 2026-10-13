import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createAppGeneratorProvider,
  GENERATION_PROMPT_VERSION,
  PLANNING_PROMPT_VERSION,
  PROVIDER_PROTOCOL_VERSION,
  type AppGeneratorProvider,
  type ModelCallRecord,
} from "../src/lib/ai/provider";
import { generationDeadline } from "../src/lib/generation/deadline";
import { GenerationError } from "../src/lib/generation/errors";
import { runAppGeneration } from "../src/lib/generation/run";
import { validateGeneratedApp } from "../src/lib/generation/validate";
import {
  createControlledTools,
  requireToolData,
  TOOL_CONTRACT_VERSION,
} from "../src/lib/generation/tools";
import {
  canonicalTask,
  TASK_CONTRACT_VERSION,
} from "../src/lib/generation/task";
import { MODEL_OUTPUT_BUDGETS } from "../src/lib/generation/limits";
import type { GeneratedApp } from "../src/lib/generation/schema";
import { evaluateBrowser } from "./browser";
import { fixtureApps } from "./fixtures";
import { fixedTasks, SUITE_VERSION, FIXED_NOW } from "./tasks";
import { structuredEvaluationTask } from "./contracts";
import {
  EvaluationBudget,
  EvaluationBudgetError,
  priceCall,
  pricingSchema,
} from "./metrics";
import { appendResult, writeReports } from "./report";
import type { RunMetadata, TaskResult } from "./report-types";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function integer(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return parsed;
}
function errorCode(error: unknown) {
  if (
    error instanceof GenerationError ||
    error instanceof EvaluationBudgetError
  )
    return error.code;
  return "EVALUATION_ERROR";
}
function gitMetadata() {
  try {
    const options = {
      cwd: process.cwd(),
      encoding: "utf8" as const,
      windowsHide: true,
    };
    return {
      commit: execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
      dirty:
        execFileSync("git", ["status", "--porcelain"], options).trim().length >
        0,
      diffHash: hash(
        execFileSync(
          "git",
          [
            "diff",
            "HEAD",
            "--",
            "src",
            "evals",
            "scripts",
            "package.json",
            "package-lock.json",
          ],
          options,
        ),
      ),
    };
  } catch {
    return { commit: null, dirty: null, diffHash: null };
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: "string", default: "fixture" },
      repeats: { type: "string" },
      tasks: { type: "string" },
      "max-calls": { type: "string" },
      "max-cost": { type: "string" },
      pricing: { type: "string" },
      out: { type: "string" },
      "timeout-ms": { type: "string" },
      "browser-timeout-ms": { type: "string" },
      "browser-path": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "npm run eval -- [--mode fixture|live] [--repeats 3] [--tasks todo-create,todo-dark] [--max-calls 90] [--pricing evals/pricing.local.json] [--max-cost 10] [--out eval-results/new-run] [--browser-path PATH] [--dry-run] [--list]",
    );
    return;
  }
  if (values.list) {
    fixedTasks.forEach((task) =>
      console.log(`${task.id}\t${task.kind}\t${task.name}`),
    );
    return;
  }
  if (values.mode !== "fixture" && values.mode !== "live")
    throw new Error("mode must be fixture or live.");
  const mode = values.mode;
  const repeats = integer(values.repeats, 1, "repeats", 1, 20);
  const maxCalls = integer(values["max-calls"], 90, "max-calls", 1, 10000);
  const generationTimeoutMs = integer(
    values["timeout-ms"] ?? process.env.GENERATION_TIMEOUT_MS,
    120000,
    "timeout-ms",
    1000,
    120000,
  );
  const browserTimeoutMs = integer(
    values["browser-timeout-ms"],
    45000,
    "browser-timeout-ms",
    1000,
    120000,
  );
  const maxCost =
    values["max-cost"] === undefined ? null : Number(values["max-cost"]);
  if (maxCost !== null && (!Number.isFinite(maxCost) || maxCost <= 0))
    throw new Error("max-cost must be positive.");
  const pricing = values.pricing
    ? pricingSchema.parse(
        JSON.parse(await readFile(resolve(values.pricing), "utf8")),
      )
    : null;
  if (
    maxCost !== null &&
    (!pricing ||
      pricing.inputPerMillion === null ||
      pricing.outputPerMillion === null ||
      pricing.cachedInputPerMillion === null)
  )
    throw new Error(
      "max-cost requires complete, versioned pricing. Copy evals/pricing.example.json and fill in your rates.",
    );
  const requested = values.tasks?.split(",").map((id) => id.trim());
  if (requested?.some((id) => !fixedTasks.some((task) => task.id === id)))
    throw new Error("Unknown task ID; use --list.");
  // A selected modification always includes its exact generated predecessors.
  const tasks = fixedTasks.filter(
    (task, index) =>
      !requested ||
      fixedTasks
        .slice(index)
        .some(
          (later) =>
            requested.includes(later.id) &&
            later.sequenceId === task.sequenceId,
        ),
  );
  const definitions = tasks.map(
    ({ id, name, sequenceId, kind, prompt, checks }) => ({
      id,
      name,
      sequenceId,
      kind,
      prompt,
      task: structuredEvaluationTask({
        id,
        name,
        sequenceId,
        kind,
        prompt,
        checks,
      }),
      checks: checks.map(({ id, name, kind }) => ({ id, name, kind })),
    }),
  );
  if (values["dry-run"]) {
    console.log(
      JSON.stringify(
        {
          mode,
          repeats,
          tasks: definitions,
          plannedSteps: tasks.length * repeats,
          maximumPossibleCalls:
            mode === "live" ? tasks.length * repeats * 3 : 0,
          maxCalls,
          maxCost,
          pricing,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (
    mode === "live" &&
    pricing &&
    pricing.model !== process.env.LLM_MODEL?.trim()
  )
    throw new Error("Pricing model must match LLM_MODEL exactly.");
  const provider = mode === "live" ? createAppGeneratorProvider() : null;
  process.env.GENERATION_TIMEOUT_MS = String(generationTimeoutMs);
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => controller.abort());
  const runId =
    new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-") +
    "-" +
    randomUUID().slice(0, 8);
  const directory = resolve(values.out ?? join("eval-results", runId));
  await mkdir(resolve(directory, ".."), { recursive: true });
  await mkdir(directory); // Never replace a previous run.
  const evalFiles = (await readdir(resolve("evals")))
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => join("evals", file));
  const codeFiles = [
    ...evalFiles,
    "src/lib/ai/provider.ts",
    "src/lib/ai/telemetry.ts",
    "src/lib/generation/run.ts",
    "src/lib/generation/task.ts",
    "src/lib/generation/tools.ts",
    "src/lib/generation/tool-failure.ts",
    "src/lib/generation/limits.ts",
    "src/lib/generation/deadline.ts",
    "src/lib/generation/errors.ts",
    "src/lib/generation/validate.ts",
    "src/lib/generation/schema.ts",
    "src/lib/preview/compose.ts",
    "scripts/run-evaluation.mjs",
    "package.json",
    "package-lock.json",
  ];
  const codeContents = await Promise.all(
    codeFiles.map(
      async (file) => `${file}\n${await readFile(resolve(file), "utf8")}`,
    ),
  );
  const metadata: RunMetadata = {
    schemaVersion: 2,
    runId,
    mode,
    startedAt: new Date().toISOString(),
    suiteVersion: SUITE_VERSION,
    suiteHash: hash(JSON.stringify(definitions)),
    codeHash: hash(codeContents.join("\n")),
    promptVersion: `${GENERATION_PROMPT_VERSION}/${PLANNING_PROMPT_VERSION}`,
    git: gitMetadata(),
    model: mode === "live" ? (process.env.LLM_MODEL?.trim() ?? null) : null,
    repeats,
    taskIds: tasks.map((task) => task.id),
    generationTimeoutMs,
    browserTimeoutMs,
    maxCalls,
    maxCost,
    pricing,
    protocol: {
      version: PROVIDER_PROTOCOL_VERSION,
      taskContractVersion: TASK_CONTRACT_VERSION,
      toolContractVersion: TOOL_CONTRACT_VERSION,
      provider: process.env.LLM_PROVIDER?.trim() || "openai-compatible",
      baseUrl:
        mode === "live"
          ? process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1"
          : null,
      outputMode: process.env.LLM_OUTPUT_MODE ?? "json_schema",
      tokenField: process.env.LLM_MAX_TOKENS_FIELD ?? "max_completion_tokens",
      thinkingMode: process.env.LLM_THINKING_MODE ?? null,
      nodeVersion: process.version,
      fixedBrowserTime: FIXED_NOW,
      browserTimezone: "Asia/Shanghai",
      browserViewport: "1100x850",
    },
  };
  await writeFile(
    join(directory, "suite.json"),
    JSON.stringify(definitions, null, 2) + "\n",
  );
  const results: TaskResult[] = [];
  const budget = new EvaluationBudget(maxCalls, maxCost);
  // Include every scheduled task even if a prior generation or the budget blocks it.
  for (let repeat = 1; repeat <= repeats; repeat++)
    for (const task of tasks)
      results.push({
        taskId: task.id,
        sequenceId: task.sequenceId,
        repeat,
        kind: task.kind,
        status: "blocked",
        failureCode: "NOT_STARTED",
        startedAt: "",
        durationMs: 0,
        generationMs: 0,
        behaviorMs: 0,
        repairCount: 0,
        calls: [],
        checks: task.checks.map(({ id, name, kind }) => ({
          id,
          name,
          kind,
          status: "not_run",
        })),
        regressedCheckIds: [],
        runtimeErrors: [],
      });
  await writeReports(directory, metadata, results);
  let activeCalls: TaskResult["calls"] | null = null;
  let finalizeCalls: (() => void)[] = [];
  async function invokeCall<T>(
    phase: ModelCallRecord["phase"],
    work: (provider: AppGeneratorProvider) => Promise<T>,
  ) {
    budget.reserveCall();
    const sink = activeCalls!;
    const index = sink.length;
    const started = performance.now();
    let recorded = false;
    let finalized = false;
    const placeholder: ModelCallRecord = {
      phase,
      model: provider!.model,
      durationMs: 0,
      status: "error",
      errorCode: "CALL_OUTCOME_UNKNOWN",
      usage: {
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        totalTokens: null,
      },
      settings: {
        outputMode: process.env.LLM_OUTPUT_MODE ?? "json_schema",
        tokenField: process.env.LLM_MAX_TOKENS_FIELD ?? "max_completion_tokens",
        tokenBudget: MODEL_OUTPUT_BUDGETS[phase],
        thinkingMode: process.env.LLM_THINKING_MODE ?? null,
      },
    };
    sink.push(priceCall(placeholder, pricing));
    finalizeCalls.push(() => {
      finalized = true;
      if (!recorded) {
        sink[index] = priceCall(
          { ...placeholder, durationMs: performance.now() - started },
          pricing,
        );
        budget.record(sink[index]);
      }
    });
    const measuredProvider = createAppGeneratorProvider({
      onCall(call) {
        if (finalized) return;
        const priced = priceCall(call, pricing);
        sink[index] = priced;
        budget.record(priced);
        recorded = true;
      },
    });
    return work(measuredProvider);
  }
  const limitedProvider = provider
    ? {
        model: provider.model,
        plan: (...args: Parameters<typeof provider.plan>) =>
          invokeCall("plan", (measured) => measured.plan(...args)),
        generate: (...args: Parameters<typeof provider.generate>) =>
          invokeCall(args[2] ? "repair" : "generate", (measured) =>
            measured.generate(...args),
          ),
      }
    : null;
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const baselines = new Map<string, GeneratedApp>();
    const passedChecks = new Map<string, Set<string>>();
    for (const task of tasks) {
      const result = results.find(
        (result) => result.repeat === repeat && result.taskId === task.id,
      )!;
      const started = performance.now();
      result.startedAt = new Date().toISOString();
      const baseline = baselines.get(task.sequenceId);
      const taskContract = structuredEvaluationTask(task);
      result.taskContract = taskContract;
      result.taskFingerprint = hash(canonicalTask(taskContract));
      result.toolTrace = [];
      if (baseline) result.baselineAppHash = hash(JSON.stringify(baseline));
      if (controller.signal.aborted)
        result.failureCode = "EVALUATION_CANCELLED";
      else if (task.kind === "modify" && !baseline)
        result.failureCode = "BASELINE_UNAVAILABLE";
      else {
        const artifactDir = join(
          directory,
          "artifacts",
          `${repeat}-${task.id}`,
        );
        await mkdir(artifactDir, { recursive: true });
        result.artifactDir = `artifacts/${repeat}-${task.id}`;
        activeCalls = result.calls;
        await writeFile(
          join(artifactDir, "task.json"),
          JSON.stringify(taskContract, null, 2) + "\n",
        );
        finalizeCalls = [];
        const generationStarted = performance.now();
        try {
          if (controller.signal.aborted)
            throw new EvaluationBudgetError("EVALUATION_CANCELLED");
          if (limitedProvider) budget.check();
          let app: GeneratedApp;
          if (limitedProvider) {
            const deadline = generationDeadline(
              new Request("http://localhost/evaluation", {
                signal: controller.signal,
              }),
              Date.now(),
            );
            try {
              const generated = await runAppGeneration(
                {
                  prompt: task.prompt,
                  task: taskContract,
                  ...(baseline ? { currentApp: baseline } : {}),
                },
                limitedProvider,
                deadline,
                async (phase) => {
                  if (phase === "repairing") result.repairCount++;
                },
                { onToolResult: (event) => result.toolTrace!.push(event) },
              );
              app = generated.app;
              await writeFile(
                join(artifactDir, "plan.json"),
                JSON.stringify(generated.plan, null, 2) + "\n",
              );
            } finally {
              deadline.close();
            }
          } else {
            const staticDeadline = generationDeadline(
              new Request("http://localhost/evaluation", {
                signal: controller.signal,
              }),
              Date.now(),
            );
            try {
              const validator = createControlledTools({
                authority: {
                  mode: "evaluation",
                  capabilities: ["app:validate"],
                },
                budget: {
                  maxToolCalls: 1,
                  maxModelCalls: 0,
                  maxRepairs: 0,
                  maxOutputTokens: 0,
                },
                deadline: staticDeadline,
                handlers: {
                  validate_app: ({ rawOutput }) => ({
                    app: validateGeneratedApp(rawOutput),
                    level: "static",
                  }),
                },
                onResult: (event) => result.toolTrace!.push(event),
              });
              app = requireToolData(
                await validator.invoke("validate_app", {
                  rawOutput: JSON.stringify(fixtureApps[task.id]),
                }),
                "validate_app",
              ).app;
            } finally {
              staticDeadline.close();
            }
          }
          result.generationMs = performance.now() - generationStarted;
          result.appHash = hash(JSON.stringify(app));
          baselines.set(task.sequenceId, app);
          await writeFile(
            join(artifactDir, "app.json"),
            JSON.stringify(app, null, 2) + "\n",
          );
          const browserDeadline = generationDeadline(
            new Request("http://localhost/evaluation-checks", {
              signal: controller.signal,
            }),
            Date.now(),
            Math.min(120000, browserTimeoutMs + 5000),
          );
          let browser;
          try {
            const checker = createControlledTools({
              authority: {
                mode: "evaluation",
                capabilities: ["browser:check"],
              },
              budget: {
                maxToolCalls: 1,
                maxModelCalls: 0,
                maxRepairs: 0,
                maxOutputTokens: 0,
              },
              deadline: browserDeadline,
              handlers: {
                run_checks: async ({ taskId, app }) => {
                  if (taskId !== task.id)
                    throw new GenerationError(
                      "TOOL_SCOPE_MISMATCH",
                      "The browser task must match the registered fixed task.",
                      403,
                    );
                  return evaluateBrowser(app, task, {
                    timeoutMs: browserTimeoutMs,
                    screenshotDir: artifactDir,
                    executablePath: values["browser-path"],
                  });
                },
              },
              onResult: (event) => result.toolTrace!.push(event),
            });
            browser = requireToolData(
              await checker.invoke("run_checks", { taskId: task.id, app }),
              "run_checks",
            );
          } finally {
            browserDeadline.close();
          }
          result.behaviorMs = browser.durationMs;
          result.checks = browser.checks.map(
            ({ passed, status, ...check }) => ({
              ...check,
              status:
                status === "not_run" ? "not_run" : passed ? "passed" : "failed",
            }),
          );
          result.runtimeErrors = browser.runtimeErrors;
          result.browserVersion = browser.browserVersion;
          result.fixedBrowserTime = browser.fixedBrowserTime;
          const priorPassed =
            passedChecks.get(task.sequenceId) ?? new Set<string>();
          result.regressedCheckIds = result.checks
            .filter(
              (check) =>
                check.kind === "regression" &&
                priorPassed.has(check.id) &&
                check.status === "failed",
            )
            .map((check) => check.id);
          passedChecks.set(
            task.sequenceId,
            new Set(
              result.checks
                .filter((check) => check.status === "passed")
                .map((check) => check.id),
            ),
          );
          result.status =
            !browser.failureCode &&
            !browser.runtimeErrors.length &&
            result.checks.length === task.checks.length &&
            result.checks.every((check) => check.status === "passed")
              ? "passed"
              : "failed";
          result.failureCode =
            result.status === "passed"
              ? undefined
              : (browser.failureCode ??
                (browser.runtimeErrors.length
                  ? "RUNTIME_ERROR"
                  : "BEHAVIOR_ASSERTION_FAILED"));
        } catch (error) {
          result.generationMs ||= performance.now() - generationStarted;
          result.failureCode = controller.signal.aborted
            ? "EVALUATION_CANCELLED"
            : errorCode(error);
          result.status =
            result.failureCode === "EVALUATION_CANCELLED" &&
            !result.calls.length
              ? "blocked"
              : error instanceof EvaluationBudgetError && !result.calls.length
                ? "skipped_budget"
                : "failed";
          // No static-valid replacement was saved; later modifications cannot use an older version silently.
          if (!result.appHash) baselines.delete(task.sequenceId);
        } finally {
          // An aborted transport can finish after the total deadline. Keep its attempted call as unknown.
          await new Promise<void>((resolve) => setImmediate(resolve));
          finalizeCalls.forEach((finalize) => finalize());
          if (mode === "live")
            result.repairCount = result.calls.filter(
              (call) => call.phase === "repair",
            ).length;
          activeCalls = null;
        }
      }
      result.durationMs =
        result.status === "blocked" || result.status === "skipped_budget"
          ? 0
          : performance.now() - started;
      console.log(
        `[${repeat}/${repeats}] ${task.id}: ${result.status} (${Math.round(result.durationMs)} ms, ${result.calls.length} calls)`,
      );
      await appendResult(directory, result);
      await writeReports(directory, metadata, results);
    }
  }
  metadata.completedAt = new Date().toISOString();
  const summary = await writeReports(directory, metadata, results);
  console.log(
    `Report: ${join(directory, "report.md")}\nBehavior: ${summary.behaviorPass.passed}/${summary.behaviorPass.total}; modifications: ${summary.modificationRegressionPass.passed}/${summary.modificationRegressionPass.total}; model calls: ${summary.modelCalls}`,
  );
  if (summary.behaviorPass.passed !== summary.behaviorPass.total)
    process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Provider/transport errors may contain implementation details: only emit our public classification.
  console.error(
    error instanceof GenerationError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "Evaluation failed.",
  );
  process.exitCode = 1;
});
