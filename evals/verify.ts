import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGeneratedApp } from "../src/lib/generation/validate";
import { evaluateBrowser } from "./browser";
import { fixtureApps } from "./fixtures";
import type { summarize } from "./metrics";
import type { RunMetadata, TaskResult } from "./report-types";
import { fixedTasks } from "./tasks";

type EvaluationReport = {
  metadata: RunMetadata;
  summary: ReturnType<typeof summarize>;
  results: TaskResult[];
};
type Scenario =
  | "repair-once"
  | "call-budget"
  | "unknown-cost"
  | "invalid-repair"
  | "observed-regression"
  | "repair-denied";
type ModelRequest = {
  model: string;
  messages: { role: string; content: string }[];
};

function testEnvironment(baseUrl: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  const allowed = new Set([
    "path",
    "systemroot",
    "windir",
    "temp",
    "tmp",
    "tmpdir",
    "localappdata",
    "userprofile",
    "home",
    "lang",
    "lc_all",
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key.toLowerCase()) && value !== undefined)
      environment[key] = value;
  }
  return {
    ...environment,
    NODE_ENV: "test",
    LLM_PROVIDER: "openai-compatible",
    LLM_MODEL: "test-model",
    LLM_API_KEY: "test-only",
    LLM_BASE_URL: baseUrl,
    LLM_OUTPUT_MODE: "json_object",
    LLM_MAX_TOKENS_FIELD: "max_tokens",
    LLM_THINKING_MODE: "disabled",
  };
}

async function runCli(args: string[], environment: NodeJS.ProcessEnv) {
  const runner = fileURLToPath(new URL("./run.ts", import.meta.url));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveRun, reject) => {
      const child = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", runner, ...args],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          env: environment,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Error("Evaluation CLI integration scenario exceeded 60 seconds"),
        );
      }, 60_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolveRun({ code, stdout, stderr });
      });
    },
  );
}

function closeEnough(actual: number | null, expected: number) {
  assert(actual !== null);
  assert(
    Math.abs(actual - expected) < 1e-12,
    `Expected cost ${expected}, got ${actual}`,
  );
}

async function readReport(directory: string): Promise<EvaluationReport> {
  const report = JSON.parse(
    await readFile(join(directory, "report.json"), "utf8"),
  ) as EvaluationReport;
  assert.equal(report.metadata.mode, "live");
  assert.equal(report.metadata.model, "test-model");
  assert(report.metadata.completedAt);
  for (const name of [
    "tasks.csv",
    "calls.csv",
    "results.jsonl",
    "report.md",
    "suite.json",
  ]) {
    assert(
      (await readFile(join(directory, name), "utf8")).trim().length > 0,
      `${name} must be written`,
    );
  }
  const lines = (await readFile(join(directory, "results.jsonl"), "utf8"))
    .trim()
    .split("\n");
  assert.equal(lines.length, report.results.length);
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).taskId),
    report.results.map((result) => result.taskId),
  );
  return report;
}

async function main() {
  await mkdir(resolve("eval-results"), { recursive: true });
  const directory = await mkdtemp(
    join(resolve("eval-results"), "integration-"),
  );
  const pricingPath = join(directory, "pricing.json");
  await writeFile(
    pricingPath,
    JSON.stringify({
      version: "integration-test-v1",
      currency: "USD",
      model: "test-model",
      inputPerMillion: 2,
      outputPerMillion: 4,
      cachedInputPerMillion: 1,
    }),
  );

  let scenario: Scenario = "repair-once";
  let attemptedRequests = 0;
  let stubFailure: unknown;
  const generationCounts = new Map<string, number>();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.headers.authorization, "Bearer test-only");
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      const data = JSON.parse(raw) as ModelRequest;
      assert.equal(data.model, "test-model");
      attemptedRequests += 1;
      const user = data.messages.findLast((message) => message.role === "user");
      assert(user);
      const planning = data.messages[0].content.startsWith(
        "Write a concise implementation plan",
      );
      let prompt = user.content;
      try {
        const planInput = JSON.parse(prompt) as { requirements?: unknown };
        if (typeof planInput.requirements === "string") {
          prompt = planInput.requirements;
        }
      } catch {
        /* Legacy generation prompts are plain text. */
      }
      const task = fixedTasks.find((item) => item.prompt === prompt);
      assert(task, "Stub must match an exact fixed task prompt");
      let content: string;
      if (planning) {
        content = JSON.stringify({
          steps: [
            `Implement ${task.name} controls and accessible names`,
            "Preserve task state and verify adding, completing and deleting tasks",
          ],
        });
      } else {
        const count = (generationCounts.get(task.id) ?? 0) + 1;
        generationCounts.set(task.id, count);
        const invalid =
          task.id === "todo-theme" &&
          (scenario === "invalid-repair" ||
            ((scenario === "repair-once" || scenario === "repair-denied") &&
              count === 1));
        const fixture = fixtureApps[task.id];
        const brokenDeletion =
          scenario === "observed-regression" && task.id === "todo-theme"
            ? fixture.javascript.replace(
                "tasks=tasks.filter(item=>item.id!==t.id);render()",
                "render()",
              )
            : undefined;
        if (brokenDeletion !== undefined)
          assert.notEqual(
            brokenDeletion,
            fixture.javascript,
            "Regression fixture must actually change deletion behavior",
          );
        content = JSON.stringify({
          ...fixture,
          ...(brokenDeletion === undefined
            ? {}
            : { javascript: brokenDeletion }),
          ...(invalid ? { javascript: "const broken = ;" } : {}),
        });
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content } }],
          ...(scenario === "unknown-cost"
            ? {}
            : {
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 50,
                  prompt_cache_hit_tokens: 20,
                  total_tokens: 150,
                },
              }),
        }),
      );
    } catch (error) {
      stubFailure = error;
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end('{"error":"integration stub rejected request"}');
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const environment = testEnvironment(`http://127.0.0.1:${address.port}/v1`);
  const runScenario = async (
    name: Scenario,
    tasks: string,
    args: string[] = [],
  ) => {
    scenario = name;
    attemptedRequests = 0;
    stubFailure = undefined;
    generationCounts.clear();
    const output = join(directory, name);
    const result = await runCli(
      [
        "--mode",
        "live",
        "--tasks",
        tasks,
        "--pricing",
        pricingPath,
        "--out",
        output,
        "--browser-timeout-ms",
        "45000",
        ...args,
      ],
      environment,
    );
    if (stubFailure) throw stubFailure;
    assert.equal(
      result.code,
      name === "repair-once" ? 0 : 1,
      `${result.stderr}\n${result.stdout}`,
    );
    const report = await readReport(output);
    assert.equal(report.summary.modelCalls, attemptedRequests);
    console.log(
      `Verified ${name}: ${report.summary.modelCalls} calls, ${report.summary.behaviorPass.passed}/${report.summary.behaviorPass.total} tasks`,
    );
    return report;
  };
  try {
    const repaired = await runScenario("repair-once", "todo-theme");
    assert.deepEqual(repaired.metadata.taskIds, ["todo-create", "todo-theme"]);
    assert.deepEqual(repaired.summary.behaviorPass, {
      passed: 2,
      total: 2,
      rate: 1,
    });
    assert.deepEqual(repaired.summary.modificationRegressionPass, {
      passed: 1,
      total: 1,
      rate: 1,
    });
    assert.equal(repaired.summary.repairCount, 1);
    assert.equal(repaired.summary.modelCalls, 5);
    assert.equal(repaired.results[1].repairCount, 1);
    assert.deepEqual(
      repaired.results[1].calls.map((call) => call.phase),
      ["plan", "generate", "repair"],
    );
    assert.equal(
      repaired.results[1].baselineAppHash,
      repaired.results[0].appHash,
    );
    for (const call of repaired.results.flatMap((result) => result.calls)) {
      closeEnough(call.cost.amount, 0.00038);
      assert.equal(call.cost.currency, "USD");
      assert.equal(call.cost.pricingVersion, "integration-test-v1");
    }
    closeEnough(repaired.summary.cost.totalEstimatedCost, 0.0019);

    const limited = await runScenario("call-budget", "todo-theme", [
      "--max-calls",
      "1",
    ]);
    assert.deepEqual(limited.summary.behaviorPass, {
      passed: 0,
      total: 2,
      rate: 0,
    });
    assert.deepEqual(limited.summary.modificationRegressionPass, {
      passed: 0,
      total: 1,
      rate: 0,
    });
    assert.equal(limited.summary.modelCalls, 1);
    assert.equal(limited.summary.repairCount, 0);
    assert.equal(limited.results[0].failureCode, "CALL_BUDGET_EXHAUSTED");
    assert.equal(limited.results[1].status, "blocked");
    assert(
      limited.results.every((result) =>
        result.checks.every((check) => check.status === "not_run"),
      ),
    );
    assert.equal(limited.summary.assertionPass.total, 9);

    const unknown = await runScenario("unknown-cost", "todo-theme", [
      "--max-cost",
      "10",
    ]);
    assert.equal(unknown.summary.modelCalls, 1);
    assert.equal(unknown.summary.cost.status, "unknown");
    assert.equal(unknown.summary.cost.totalEstimatedCost, null);
    assert.equal(unknown.summary.cost.unknownCostCalls, 1);
    assert.equal(unknown.results[0].failureCode, "COST_UNKNOWN");
    assert.equal(unknown.results[1].status, "blocked");
    assert.equal(unknown.results[0].calls[0].cost.amount, null);

    const failed = await runScenario("invalid-repair", "todo-filter");
    assert.deepEqual(failed.metadata.taskIds, [
      "todo-create",
      "todo-theme",
      "todo-filter",
    ]);
    assert.deepEqual(failed.summary.behaviorPass, {
      passed: 1,
      total: 3,
      rate: 1 / 3,
    });
    assert.equal(failed.summary.repairCount, 1);
    assert.equal(failed.summary.modelCalls, 5);
    assert.equal(failed.results[1].status, "failed");
    assert.equal(failed.results[1].failureCode, "INVALID_GENERATED_APP");
    assert.equal(failed.results[2].status, "blocked");
    assert.equal(failed.results[2].failureCode, "BASELINE_UNAVAILABLE");
    assert.equal(failed.results[2].calls.length, 0);

    const regression = await runScenario("observed-regression", "todo-theme");
    assert.equal(regression.summary.modelCalls, 4);
    assert.equal(regression.summary.repairCount, 0);
    assert.equal(regression.results[0].status, "passed");
    assert.equal(
      regression.results[0].checks.find((check) => check.id === "todo-delete")
        ?.status,
      "passed",
    );
    assert.equal(regression.results[1].status, "failed");
    assert.equal(
      regression.results[1].failureCode,
      "BEHAVIOR_ASSERTION_FAILED",
    );
    assert.equal(
      regression.results[1].checks.find((check) => check.id === "todo-delete")
        ?.status,
      "failed",
    );
    assert.equal(
      regression.results[1].checks.find((check) => check.id === "todo-theme")
        ?.status,
      "passed",
    );
    assert.deepEqual(regression.results[1].regressedCheckIds, ["todo-delete"]);
    assert.equal(regression.summary.regressedAssertions, 1);
    assert.deepEqual(regression.summary.modificationRegressionPass, {
      passed: 0,
      total: 1,
      rate: 0,
    });
    assert.deepEqual(regression.summary.retainedAssertionPass, {
      passed: 3,
      total: 4,
      rate: 0.75,
    });

    const denied = await runScenario("repair-denied", "todo-theme", [
      "--max-calls",
      "4",
    ]);
    assert.equal(denied.summary.modelCalls, 4);
    assert.equal(denied.summary.repairCount, 0);
    assert.equal(denied.results[1].status, "failed");
    assert.equal(denied.results[1].failureCode, "CALL_BUDGET_EXHAUSTED");
    assert.equal(denied.results[1].repairCount, 0);
    assert(denied.results[1].calls.every((call) => call.phase !== "repair"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  }

  const todoTask = fixedTasks.find((task) => task.id === "todo-create")!;
  const inert = validateGeneratedApp(
    JSON.stringify({
      ...fixtureApps[todoTask.id],
      javascript:
        "document.getElementById('todo-add').addEventListener('click',()=>{});",
    }),
  );
  const inertResult = await evaluateBrowser(inert, todoTask, {
    timeoutMs: 45_000,
  });
  assert.equal(
    inertResult.failureCode,
    undefined,
    "Inert controls must fail behavior checks, not browser infrastructure",
  );
  assert(
    inertResult.checks.some((check) => !check.passed),
    "Static validity cannot imply functional behavior",
  );
  assert.equal(inertResult.runtimeErrors.length, 0);
  console.log(
    "Verified statically valid inert controls fail browser behavior assertions",
  );

  const throwing = validateGeneratedApp(
    JSON.stringify({
      ...fixtureApps[todoTask.id],
      javascript: "throw new Error('integration-runtime-failure');",
    }),
  );
  const runtime = await evaluateBrowser(throwing, todoTask, {
    timeoutMs: 15_000,
  });
  assert(
    runtime.runtimeErrors.some((error) =>
      error.includes("integration-runtime-failure"),
    ),
  );
  assert(runtime.checks.every((check) => !check.passed));
  console.log("Verified preview runtime errors are captured");

  const looping = validateGeneratedApp(
    JSON.stringify({
      ...fixtureApps[todoTask.id],
      javascript: "while(true){}",
    }),
  );
  const timeoutStarted = performance.now();
  const timeout = await evaluateBrowser(looping, todoTask, {
    timeoutMs: 10_000,
  });
  assert.equal(timeout.failureCode, "BROWSER_TIMEOUT");
  assert(timeout.checks.every((check) => !check.passed));
  assert(
    performance.now() - timeoutStarted < 17_000,
    "A wedged renderer must not wedge the integration runner",
  );
  console.log(
    "Verified infinite-loop browser worker is terminated within its timeout",
  );
  console.log(`Integration verification passed; reports: ${directory}`);
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.stack : "Integration verification failed",
  );
  process.exitCode = 1;
});
