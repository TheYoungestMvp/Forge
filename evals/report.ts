import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { summarize } from "./metrics";
import type { RunMetadata, TaskResult } from "./report-types";

const cell = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
const percent = (value: {
  passed: number;
  total: number;
  rate: number | null;
}) =>
  `${value.passed}/${value.total} (${value.rate === null ? "不适用" : `${(value.rate * 100).toFixed(1)}%`})`;
const ms = (value: number | null) =>
  value === null ? "不适用" : `${Math.round(value)} ms`;

export async function appendResult(directory: string, result: TaskResult) {
  await appendFile(
    join(directory, "results.jsonl"),
    JSON.stringify(result) + "\n",
    "utf8",
  );
}

export async function writeReports(
  directory: string,
  metadata: RunMetadata,
  results: TaskResult[],
) {
  const summary = summarize(results, metadata.mode);
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify({ metadata, summary, results }, null, 2) + "\n",
  );
  const headers = [
    "task_id",
    "sequence_id",
    "repeat",
    "kind",
    "status",
    "failure_code",
    "duration_ms",
    "generation_ms",
    "behavior_ms",
    "repair_count",
    "call_count",
    "assertions_passed",
    "assertions_total",
    "regressed_assertions",
    "known_estimated_cost",
    "unknown_cost_calls",
    "currency",
    "app_hash",
    "baseline_app_hash",
  ];
  const rows = results.map((result) => [
    result.taskId,
    result.sequenceId,
    result.repeat,
    result.kind,
    result.status,
    result.failureCode,
    result.durationMs,
    result.generationMs,
    result.behaviorMs,
    result.repairCount,
    result.calls.length,
    result.checks.filter((check) => check.status === "passed").length,
    result.checks.length,
    result.regressedCheckIds.length,
    result.calls.reduce((sum, call) => sum + (call.cost.amount ?? 0), 0),
    result.calls.filter((call) => call.cost.amount === null).length,
    metadata.pricing?.currency,
    result.appHash,
    result.baselineAppHash,
  ]);
  await writeFile(
    join(directory, "tasks.csv"),
    "\uFEFF" +
      [headers, ...rows].map((row) => row.map(cell).join(",")).join("\n") +
      "\n",
  );
  const callHeaders = [
    "task_id",
    "repeat",
    "phase",
    "model",
    "status",
    "error_code",
    "duration_ms",
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "total_tokens",
    "estimated_cost",
    "currency",
    "pricing_version",
  ];
  const callRows = results.flatMap((result) =>
    result.calls.map((call) => [
      result.taskId,
      result.repeat,
      call.phase,
      call.model,
      call.status,
      call.errorCode,
      call.durationMs,
      call.usage.inputTokens,
      call.usage.outputTokens,
      call.usage.cachedInputTokens,
      call.usage.totalTokens,
      call.cost.amount,
      call.cost.currency,
      call.cost.pricingVersion,
    ]),
  );
  await writeFile(
    join(directory, "calls.csv"),
    "\uFEFF" +
      [callHeaders, ...callRows]
        .map((row) => row.map(cell).join(","))
        .join("\n") +
      "\n",
  );
  const cost =
    metadata.mode === "fixture"
      ? "本地样例，无模型调用；不代表模型质量或调用费用"
      : summary.cost.totalEstimatedCost === null
        ? `未知（已知部分估算 ${summary.cost.knownEstimatedCost.toFixed(6)} ${metadata.pricing?.currency ?? ""}；${summary.cost.unknownCostCalls} 次调用缺少完整费用信息）`
        : `估算 ${summary.cost.totalEstimatedCost.toFixed(6)} ${metadata.pricing?.currency ?? ""}`;
  const lines = [
    `# Forge 固定任务评测：${metadata.runId}`,
    "",
    metadata.mode === "fixture"
      ? "**这是可信本地样例的评测框架自检，不是模型成功率基线。**"
      : "这是离线模型与浏览器行为评测，不包含数据库保存、HTTP 工作流、账户权限或业务数据持久化验收。",
    "",
    `- 任务集：${metadata.suiteVersion}；重复次数：${metadata.repeats}；模型：${metadata.model ?? "无（样例）"}`,
    `- Git：${metadata.git.commit ?? "未知"}；工作区修改：${String(metadata.git.dirty)}；代码指纹：${metadata.codeHash}`,
    `- 浏览器版本：${[...new Set(results.map((result) => result.browserVersion).filter(Boolean))].join(", ") || "未执行 / 未知"}；固定浏览器时间：${metadata.protocol.fixedBrowserTime ?? "未知"}`,
    `- 计划任务：${summary.plannedTasks}；已执行：${summary.attemptedTasks}；基线阻断：${summary.blockedTasks}；预算跳过：${summary.budgetSkippedTasks}`,
    `- 行为通过率（全部预定任务）：${percent(summary.behaviorPass)}`,
    `- 修改回归通过率（新需求及全部旧断言）：${percent(summary.modificationRegressionPass)}`,
    `- 旧功能断言通过率：${percent(summary.retainedAssertionPass)}；此前通过而本轮失败的断言：${summary.regressedAssertions}`,
    `- 全部断言通过率：${percent(summary.assertionPass)}`,
    `- 已执行任务耗时 P50 / P95：${ms(summary.latencyMs.attemptedP50)} / ${ms(summary.latencyMs.attemptedP95)}`,
    `- 通过任务耗时 P50 / P95：${ms(summary.latencyMs.passingP50)} / ${ms(summary.latencyMs.passingP95)}`,
    `- 自动修正：${summary.repairCount} 次；涉及 ${summary.repairedTasks} 个任务；模型调用：${summary.modelCalls} 次`,
    `- 总调用成本：${cost}`,
    `- 每个通过任务成本（含失败调用）：${summary.cost.estimatedCostPerPassingTask === null ? "未知 / 不适用" : `${summary.cost.estimatedCostPerPassingTask.toFixed(6)} ${metadata.pricing?.currency ?? ""}`}`,
    "",
    "| 任务 | 轮次 | 结果 | 断言 | 耗时 ms | 修正 | 调用 | 失败分类 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.taskId} | ${result.repeat} | ${result.status} | ${result.checks.filter((check) => check.status === "passed").length}/${result.checks.length} | ${Math.round(result.durationMs)} | ${result.repairCount} | ${result.calls.length} | ${result.failureCode ?? ""} |`,
    ),
    "",
    "未执行断言保留在分母内。耗时从规划前开始到行为检查完成，包含修正与浏览器启动；不包含数据库保存。分位数使用最近秩法，小样本应同时查看 tasks.csv 的原始分布。费用来自 usage × 指定版本单价的估算，缺失信息为 null，不是零。",
    "",
    "原始记录：results.jsonl；逐调用信息：calls.csv；完整元数据与汇总：report.json；源码与失败截图：artifacts/。",
    "",
  ];
  await writeFile(join(directory, "report.md"), lines.join("\n"));
  return summary;
}
