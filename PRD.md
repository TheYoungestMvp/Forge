# Forge — AI App Builder MVP PRD

状态：最终实现规格。Phase 1–5 和 Demo Hardening 已实现；本文件已同步评审修复，替代最初的设计提案。真实数据库需依次应用两份 migration。提交截止：2026-10-10 22:00，Asia/Shanghai。

## 产品目标

用户输入自然语言需求，AI 生成可交互的自包含 HTML / CSS / JavaScript 应用，立即在 Preview 中运行。用户可以连续修改、查看历史版本、恢复旧代码，以及刷新恢复项目、Chat 和生成状态。

设计原则：Working > Elegant；Simple > Generic；Deterministic > Flexible；Core workflow > Feature count。

## MVP 与验收标准

| 能力 | 当前实现与验收 |
| --- | --- |
| Project 创建 | 独立项目 ID / 名称，保存项目列表；两个项目不串用。只有成功加载新项目后才切换地址；读取失败保留原项目地址和编辑目标 |
| Chat / Prompt | 1–4000 字符；Enter 提交，Shift+Enter 换行；支持输入法；空白不可发送 |
| Agent 状态 | 理解、规划、生成、校验、保存、完成 / 失败；占位消息、phase、期限和终态持久化 |
| 具体 Planning | 模型先返回 2–4 个针对本次需求的具体实现步骤；严格校验并保存后展示在 Chat，再调用代码生成；不展示内部推理 |
| AI 代码生成 | 严格四字段 `title/html/css/javascript`；真实 OpenAI-compatible provider，无产品 mock fallback |
| Preview | 保存成功后以 sandboxed iframe + srcDoc 运行完整应用；可以真实操作 |
| Follow-up | 服务端读取最新已保存 App Code 作为权威上下文；保持未要求更改的功能，返回完整新代码 |
| 项目与 Chat 持久化 | 项目、用户消息、助手占位 / 计划 / 结果 / 错误刷新后保留；数据库不可用时说明错误，不虚报保存 |
| Version History | 每次成功生成创建不可变快照；展示编号、时间、完整 prompt；点击只改变 Preview |
| Restore | 复制选中历史代码并追加新版本，不删除 / 覆盖旧版本，不调用 LLM |
| 刷新恢复 | 最新成功版本照常显示；最后请求失败时恢复错误与 Retry；进行中恢复 phase / plan 并轮询终态；过期任务回收为可重试失败 |
| 并发与幂等 | 数据库认领一次执行；同 requestId 进行中返回 202，不再次调用模型；完成请求重放同一版本和成功回复；旧失败不能覆盖终态 |
| 匿名访问隔离 | 服务端签名的 HttpOnly 浏览器会话，无注册界面；所有项目访问均校验所有者。会话保留时可刷新 / 重新打开；其他浏览器无法读取、修改或恢复其项目 |
| 调用保护 | 数据库持久化每会话和全局尝试限额；会话只允许一个活动生成 / 恢复；公开部署另要求访问密码和独立会话签名密钥 |
| 可运行交付 | Node.js 24、锁文件、两份 SQL migration、环境示例、lint / test / build、真实闭环和故障验收记录 |

## 核心流程

打开首页 → 建立匿名浏览器会话 → Create Project → Prompt → 原子保存用户和助手占位消息并认领请求 → AI 具体 Planning → 保存计划并展示 → AI 生成代码 → 校验 → 原子保存版本和成功消息 → iframe Preview。

继续修改时，服务端将当前最新版本的完整源码交给模型。生成过程中保留旧 Preview；成功保存后更新；失败不产生版本，并恢复重试入口。

打开 Version History → Preview v1 → Restore v1。如果已有 v1、v2、v3，Restore 创建 v4，代码与 v1 一致，parent 指向之前最新的 v3；刷新恢复 v4。继续 AI 修改生成 v5，以 v4 代码为上下文。历史查看时禁用修改，返回最新版本或 Restore 后再提交。

重试同一失败需求沿用 requestId；数据库以新的 run token 认领该次尝试，保留用户消息和助手记录，替换失败状态。成功版本和成功回复不可被失败路径覆盖。新 prompt 使用新 requestId。

## 页面与状态

工作区地址为 `/?project=<id>`。同一页面提供项目列表、创建入口、顶部项目名、Agent Chat、Prompt、Version History、Desktop / Mobile Preview。窄屏切换 Chat / Preview。

必须处理空项目、生成中、保存中、成功、失败、历史查看、恢复中、会话缺失、项目不可访问、数据库不可用、配置错误和 Preview 运行错误。长文本换行；错误出现时 Chat 显示重试操作。

刷新后的状态以数据库为准。存在旧版本不能将一个新的失败 / 未完成请求标为 Completed。尚未过期的生成继续读取状态；已过期的请求转为 failed，可手动重试。没有助手回复的遗留用户请求视为 interrupted。

## 身份与公开演示

本 MVP 使用服务端签名匿名 cookie，而非 Supabase Auth 匿名登录。该实现选择替代原始提案，仍满足同浏览器持久身份和跨访客项目隔离；不增加注册 / 登录产品界面。

cookie 为 HttpOnly、SameSite=Strict；公开模式使用 Secure、HTTPS 和独立签名密钥。清除 cookie、会话到期、换浏览器 / 设备或更换签名密钥后，不提供旧匿名身份找回。旧共享项目保留为无所有者的数据，迁移不会将它们开放或自动分配给首个访客。

公开模式需配置 `FORGE_DEPLOYMENT=public`、`FORGE_SESSION_SECRET`、`DEMO_ACCESS_PASSWORD`。未配置时拒绝服务，密码未验证时不允许进入页面 / API。Origin 检查只是附加请求校验，不能替代会话身份或所有者校验。

## 限制与质量目标

- 生成单页离线 browser app；不生成 React / Next.js 仓库，不运行 shell，不安装运行依赖，不执行生成的后端。
- 原生 HTML body fragment、CSS、classic JavaScript；不依赖 CDN、外部网络、浏览器持久存储或父 DOM。
- Prompt 1–4000 字符；title 1–120 字符；各代码字段最多 64 KiB UTF-8；完整 App 最多 128 KiB。
- `GENERATION_TIMEOUT_MS` 默认 120 秒，包含准备、规划、生成、一次输出修正、校验及保存。所有工作共享信号和固定数据库期限；超时停止。提交结果不确定时最多额外 5 秒查询 / 持久化终态，不能盲目覆盖成功。
- 具体 Planning 1 次模型调用，正常代码生成 1 次；只有无效 App 输出最多增加 1 次修正，共用原期限。鉴权、网络、限流和超时不自动重试。
- 模型逻辑正确性不能由语法校验保证；必须实际操作代表应用。iframe 不提供 CPU / 内存隔离。
- 项目、Chat、源码版本与生成状态持久化。Preview 内 Todo 任务等运行数据仍为 iframe 内存，刷新 / Reload / 切版本会重置。
- 不保证关闭页面后任务一定继续完成；服务器中断后，持久期限允许下次打开安全回收，避免永久 Busy。
- 不实现 Git diff、branch、merge、Multi-Agent、GitHub integration、IDE、后台任务队列、生成 App 数据库、身份跨设备找回或计费系统。

## 提交验收

1. 创建项目 A，生成 Todo，检查 Planning 和真实新增 / 完成 / 删除。
2. 连续修改深色模式、未完成筛选，确认原交互仍可用。
3. 查看历史、Preview v1、Restore 生成新版本；刷新恢复相同项目、消息、历史及最新代码。
4. 创建 B，测试切换失败时 A 的地址、标题和实际修改目标一致。
5. 失败后刷新仍有错误 / Retry；生成中刷新恢复真实阶段和计划；服务器中断 / 期限过后可重试。
6. 同 requestId 并发请求只有一次认领和工作流；完成后的失败处理不得改写成功消息。
7. 第二匿名浏览器无法访问 A；未认证 API 返回 401；公开入口和持久调用限额有效。
8. 验证总期限覆盖慢准备 / 慢保存、保存响应丢失、无效输出、合法定位代码、大代码和移动端。
9. Node.js 24 下执行 `npm ci`、lint、test、build，按 README 启动。

历史分阶段结果用于说明当时的验收，不替代修复后的最终规格。当前回归测试在 `tests/`，最终线上验收摘要见 `RELEASE_CHECKLIST.md`。
