# 结构化任务与受控工具契约 v1

任务描述期望行为；执行上下文授予权限和预算。HTTP 入口先验证会话、项目归属、当前版本及数据库认领，随后通过固定工具注册表执行规划、生成、校验和保存。离线评测通过同一注册表执行浏览器检查。当前控制流程由服务端确定，模型返回计划和代码；这是一条受控生成流程。

机器可读定义在 `contracts/task-v1.schema.json` 和 `contracts/tools-v1.json`，由运行时 Zod schema 导出：

```sh
npm run contracts:export
```

## 任务输入

`POST /api/generate` 保留 `projectId`、`requestId`、`baseVersionId`、`prompt`，新增可选 `task`。每个层级严格拒绝额外字段。结构如下，全部数组显式提供：

| 字段 | 内容与边界 |
| --- | --- |
| version | 固定字符串 `1` |
| goal | 本次任务目标，1–4000 字符 |
| requirements | 最多16条需求，每条1–4000字符 |
| data | 最多4个内存集合，每集合1–16个字段；集合及字段名为小写标识符，分别唯一 |
| data.fields | `name`、`type`、`required`；类型为 text / number / boolean / date / enum；enum必须提供1–12个唯一选项，其他类型禁止options |
| preserve | 最多16条必须保留的既有行为，每条1–600字符 |
| acceptance | 最多32条唯一ID的验收项，包含name、action、expected、kind；kind为behavior或regression |

标识符为小写字母开头、最多40字符，后续允许字母、数字和下划线。整个任务规范化后的 JSON 最多32768 UTF-8字节。字段声明用于约束模型生成的内存应用，不在数据库创建业务表；业务记录持久化仍是后续能力。

例如，在已有生成请求中增加：

```json
{
  "version": "1",
  "goal": "增加未完成任务筛选",
  "requirements": ["提供全部和未完成两个视图"],
  "data": [{
    "name": "tasks",
    "fields": [
      {"name": "title", "type": "text", "required": true},
      {"name": "done", "type": "boolean", "required": true}
    ]
  }],
  "preserve": ["保留新增、完成、删除及深色主题"],
  "acceptance": [{
    "id": "pending_filter",
    "name": "未完成筛选",
    "action": "新增两个任务，完成其中一个，切换未完成视图",
    "expected": "只显示尚未完成的任务；恢复全部后两条任务仍在",
    "kind": "behavior"
  }]
}
```

未提供task时，服务端根据prompt建立兼容契约，acceptance为空，表示未声明独立行为断言。显式契约传给规划和生成模型；输出继续使用现有严格的步骤计划与四字段App协议。声明验收项与真正执行验收分别记录：线上检查静态合法性，固定任务的离线浏览器检查执行已注册的独立断言。

## 权限与绑定

任务和工具输入不能包含ownerId、执行模式、capabilities、预算、服务密钥或自定义工具。API身份来自已签名会话，数据库按所有者检查项目；执行标识来自本次认领，基线来自已保存版本。工具读取和保存参数中的项目及版本必须匹配该上下文。工具调用中的task必须与本次绑定的规范化契约相同。

`messages.task_contract` 在用户与助手消息中保存同一任务。`forge_bind_task_contract` 只授予service_role，检查项目锁、run_token、processing状态与固定期限；写入期间到期整体回滚。已绑定任务不可替换，失败重试、进行中查询与完成重放保持原契约。重试省略task时，服务端读取原契约；显式改变同requestId的契约返回409 `REQUEST_ID_CONFLICT`。旧数据的NULL契约在重新生成时建立，不追溯编造过去的验收项。

工具调用ID在同一次执行内去重：同ID和同参数重放原结果，包括失败；同ID不同参数返回409 `TOOL_CALL_CONFLICT`。并发同ID共享一次执行。服务重启后的请求一致性继续由已有数据库认领、版本提交和执行标识保证。

## 工具白名单

| 工具 | 输入 | 权限 / 模式 | 结果与预算预留 |
| --- | --- | --- | --- |
| read_project | projectId、baseVersionId | project:read，仅项目执行 | 经验证的currentApp或NULL；读取本次已认领的服务器快照 |
| plan_app | task | model:invoke | 2–4条具体步骤；1次模型调用、1200输出token |
| generate_app | task、plan | model:invoke | rawOutput；1次模型调用、12000输出token |
| repair_app | task、plan、feedback（最多600字符） | model:invoke | rawOutput；1次模型调用、1次修正、12000输出token |
| validate_app | rawOutput（最多1MiB） | app:validate | app、level=static；结构、字节、HTML、JS语法及能力检查 |
| run_checks | taskId、app | browser:check，仅离线评测 | checks、runtimeErrors、durationMs及基础设施失败码；仅调用注册的固定任务检查 |
| save_version | projectId、baseVersionId、app | version:save，仅项目执行 | versionId；静态校验后执行既有带标识的原子提交 |

工具必须同时具有注册定义、授权能力、允许模式和已安装处理器。只有存在实际无效代码时，生成编排才尝试repair_app；鉴权、网络、限流或规划失败不触发修正。浏览器行为失败只记录结果，保持当前评测基线。

## 预算与期限

生产单次执行最多7次工具尝试、3次模型调用、1次修正，预留输出token总额最多25200；规划1200 + 生成12000 + 修正12000。工具参数规范化JSON最多1MiB，结果最多1MiB，任务自身另受32KiB限制；App继续使用原有128KiB总源码及64KiB字段限制。注册表与provider共用输出token常量。

格式有效的新调用ID首次尝试计入工具次数，包括参数或权限拒绝；同ID重放及冲突不再次计数。无效ID或无法序列化的输入在登记调用前拒绝。模型、修正与token预算在处理器启动前预留，预算拒绝不启动处理器、不增加这些预留。处理器已经启动后失败仍保留预留，避免连续失败绕过上限；预留值与供应商实际usage分别记录，预留并不等于账单费用。

全部生成工具、修正和保存共享从HTTP入口开始的固定期限，默认120秒；调用、重放和修正不能延长。取消后未启动的工具不执行；正在进行的请求使用同一取消信号。数据库提交也重新检查期限。保存结果不确定时，沿用既有最多5秒的终态确认，已成功版本不会改写为失败。

离线浏览器检查另有45秒工作进程预算和最多5秒清理预算，仅一次run_checks调用、不授予模型或保存权限；网络被阻止，子进程不继承模型和数据库凭据。评测整轮的调用硬上限及基于usage的费用停止阈值继续生效，见 `evals/README.md`。

## 失败结果

工具统一返回 `{ok, callId, tool, data或error, budget}`。成功结果也按对应schema和字节边界检查。失败error包含：

| 字段 | 语义 |
| --- | --- |
| code / message / status | 稳定分类、可读安全消息和HTTP语义 |
| outcome | not_started：处理器未开始；failed：已执行并确定失败；unknown：请求被中断或无法确认结果 |
| recovery | none：不能自动继续；repair_output：仍可进行一次修正；retry_request：更正配置或恢复条件后重新请求；reload_state：先读取持久状态 |

典型分类：`UNKNOWN_TOOL`、`TOOL_INVALID_INPUT`、`TOOL_FORBIDDEN`、`TOOL_SCOPE_MISMATCH`、`TOOL_TASK_MISMATCH`、`TOOL_BUDGET_EXHAUSTED`、`TOOL_CALL_CONFLICT`、`TOOL_INVALID_RESULT`。已有模型与存储错误码保留。再次无效且修正预算已用尽时，recovery为none。unknown结果要求先确认状态，不自动重复写入。

在线NDJSON error与JSON error带可选failure（tool、callId及上述error字段），保持旧code/message兼容。项目刷新继续读取已保存error_code和消息；完整工具明细由本轮离线评测记录。工具观测只记录名称、ID、结果分类、耗时和预算，不记录参数、源码、提示词、所有者、执行令牌或密钥；观测回调失败不能影响业务执行。

评测的report.json/results.jsonl保存taskContract、taskFingerprint、toolTrace；每任务artifact保存task.json。静态合法、工具成功执行和全部行为通过各自保留独立结果。

## 启用与验证

已有数据库按顺序执行 `supabase/migrations/004_task_contract.sql`。它增加可空契约列和绑定函数，保留原项目、聊天和版本；迁移未安装时生成在调用模型前报schema过旧。仓库内PGlite测试执行实际迁移和事务，不修改外部Supabase。

```sh
npm test
npm run eval:verify
npm run eval -- --mode fixture
npm run lint
npm run build
```

固定任务包含显式数据与验收动作；浏览器验证覆盖新增、完成、删除、筛选、计算、历史和编辑。权限、范围、预算、输入注入、去重、取消、迟到结果、契约冲突、重试及过期事务由独立契约和数据库测试覆盖。
