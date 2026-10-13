import { taskSpecSchema, type TaskSpec } from "../src/lib/generation/task";
import type { EvalTask } from "./types";

const criteria: Record<string, [string, string]> = {
  "todo-add": [
    "输入整理采访记录并点击添加任务",
    "任务列表只出现该任务，新增输入清空",
  ],
  "todo-complete": [
    "新增任务后勾选完成，再取消勾选",
    "完成状态依次为真、假，任务始终存在",
  ],
  "todo-delete": ["新增保留任务和删除任务，再删除后者", "只剩保留任务"],
  "todo-input": [
    "提交空白标题，再提交200字以上中文标题",
    "空白不新增，长标题完整保留",
  ],
  "todo-theme": [
    "新增并完成任务，开启再关闭深色主题",
    "背景实际改变并恢复，任务和完成状态保留",
  ],
  "todo-filter": [
    "切换未完成与全部视图，在筛选中完成和删除任务",
    "筛选随状态即时变化，切换视图不丢任务",
  ],
  "todo-edit": [
    "编辑已完成任务，先提交空标题，再保存有效中文标题",
    "拒绝空标题，保留完成状态和其他任务，筛选继续工作",
  ],
  "calculator-arithmetic": ["执行8+3、8-3、8*3、8/4", "结果分别是11、5、24、2"],
  "calculator-decimal": ["执行0.1+0.2", "结果文本严格显示0.3"],
  "calculator-reset": [
    "输入9+8后清空，再算4*3",
    "清空显示0并重置运算符，后续结果为12",
  ],
  "calculator-new-expression": ["算2+3后直接输入7-2", "新表达式独立计算为5"],
  "calculator-history": [
    "算2+3和8/4，再清空历史",
    "历史最新在前、格式正确；清空历史保留当前结果",
  ],
  "board-add": [
    "新增包含中文标题、状态、渠道、发布日期的内容",
    "所有字段可见且值正确，标题输入清空",
  ],
  "board-state-delete": [
    "新增两条内容、改变第一条状态并删除第一条",
    "状态即时更新，删除只影响目标内容",
  ],
  "board-input": [
    "提交空白标题或空日期，再提交200字以上中文标题",
    "拒绝空字段，长标题完整保留",
  ],
  "board-channel": [
    "为三个渠道新增内容，筛选小红书再恢复全部",
    "仅显示匹配渠道，恢复后所有内容和状态保留",
  ],
  "board-overdue": [
    "组合渠道和逾期筛选，将逾期内容改为已完成",
    "仅显示今天之前且未完成的匹配内容，完成后即时消失",
  ],
  "board-edit": [
    "先用空标题编辑，再保存有效中文标题",
    "拒绝空标题，保留日期、渠道、状态及组合筛选能力",
  ],
};

export function structuredEvaluationTask(task: EvalTask): TaskSpec {
  const data: TaskSpec["data"] =
    task.sequenceId === "todo"
      ? [
          {
            name: "tasks",
            fields: [
              { name: "title", type: "text", required: true },
              { name: "done", type: "boolean", required: true },
            ],
          },
        ]
      : task.sequenceId === "board"
        ? [
            {
              name: "content",
              fields: [
                { name: "title", type: "text", required: true },
                {
                  name: "status",
                  type: "enum",
                  required: true,
                  options: ["待办", "进行中", "已完成"],
                },
                {
                  name: "channel",
                  type: "enum",
                  required: true,
                  options: ["公众号", "小红书", "视频号"],
                },
                { name: "publish_date", type: "date", required: true },
              ],
            },
          ]
        : [];
  return taskSpecSchema.parse({
    version: "1",
    goal: task.name,
    requirements: [task.prompt],
    data,
    preserve: task.checks
      .filter((check) => check.kind === "regression")
      .map((check) => check.name),
    acceptance: task.checks.map((check) => ({
      id: check.id.replaceAll("-", "_"),
      name: check.name,
      kind: check.kind,
      action: criteria[check.id]?.[0] ?? check.name,
      expected: criteria[check.id]?.[1] ?? check.name,
    })),
  });
}
