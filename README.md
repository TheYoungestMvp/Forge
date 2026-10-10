# Forge — AI App Builder Demo

Next.js / TypeScript / Tailwind App Builder。真实 AI 先给出具体计划，再生成或修改可交互 HTML / CSS / JavaScript；Supabase 保存项目、Chat、生成状态和版本；历史 Restore 追加新版本。

## 本地运行

**使用 Node.js 24。** 已验证 Node 24.14.0。`.nvmrc`、package engines、`.npmrc` 和启动检查统一这一版本；Node 20 / 22 不属于本项目的运行范围。缺少原生 WebSocket 时显示运行环境错误，而不是误报数据库密钥错误。

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Windows 使用 `Copy-Item .env.example .env.local`。已有配置时保留现有 `.env.local`，不要覆盖密钥。打开 Next.js 打印的 URL，默认 http://localhost:3000。

需要配置 `LLM_MODEL`、`LLM_API_KEY`、`LLM_BASE_URL`、`SUPABASE_URL`、服务端 `SUPABASE_SECRET_KEY`（或旧 `SUPABASE_SERVICE_ROLE_KEY`）。重启服务使环境生效，密钥绝不使用 NEXT_PUBLIC_ 前缀。

Supabase SQL Editor **依次执行**：

1. `supabase/migrations/001_persistence.sql`
2. `supabase/migrations/002_demo_hardening.sql`
3. `supabase/migrations/003_project_deletion.sql`

已有 Phase 4/5 数据库需要第二、三份迁移；已完成 002 的数据库只需执行 003。002 保留数据、增加所有者与工作流状态、替换不安全的执行路径；003 仅安装删除函数，不会删除已有项目。未迁移时 API 明确提示 schema 过旧；不会降级为无权限检查的共享模式。

旧共享项目保留为 `owner_id=NULL` 的私有遗留数据，不自动分配给首个访客。迁移后请在新匿名会话创建新项目演示。若确需保留自己旧项目的访问，仅由数据库管理员根据明确项目 ID 和当前 `POST /api/session` 的 ID 分配所有者；不能批量开放旧共享数据。

本地配置 `FORGE_DEPLOYMENT=local`。本地签名可使用显式 `FORGE_SESSION_SECRET`，未设置时从已有 server key 派生；配置独立密钥能避免数据库 key 轮换导致匿名会话失效。

本机 Node 需要系统代理访问 Supabase 时，可在 `.env.local` 中保存实际代理地址（以下端口只是示例）：

```dotenv
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1,::1
```

`npm run dev` 和 `npm start` 会在 Node 启动时读取 `.env.local` 并启用环境代理；修改后重启服务。代理配置仅保存在本机，不上传 Vercel。也可在同一 PowerShell 窗口临时设置：

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:NO_PROXY="localhost,127.0.0.1,::1"
npm run dev
```

直接联网环境不需要这些变量。

数据库客户端也会直接读取这些代理变量，使用独立连接池；因此通过其他方式启动 Next.js 时，存储连接仍使用 `.env.local` 中的代理。每次存储请求有 30 秒总预算、15 秒单次连接/请求期限，最多尝试 3 次；已有的生成总期限和取消信号始终优先。空闲连接默认保留 60 秒，服务端提示可延长至最多 120 秒，减少代理 TLS 握手。

重试仅用于读取、已经有数据库防重复保护的保存/状态 RPC，或确定发生在发送写入之前的连接错误。创建项目、开始生成和删除如果在可能提交后断线，不自动重复；页面提示先重新读取已保存结果。鉴权、权限及 schema 错误不重试。

反复连接失败时运行只读稳定性检查，而不是用一次成功判断已恢复：

```sh
npm run check:storage -- --samples 12 --interval-ms 6000
```

服务端 `[storage]` 日志记录错误分类、次数和耗时，不记录密钥、cookie、项目内容或查询参数。代理不可用、握手/请求超时、系统拒绝网络、数据库鉴权失败及保存结果未确认分别显示对应提示；外部代理持续离线仍需要恢复代理连接。

## 公开演示配置

```dotenv
FORGE_DEPLOYMENT=public
FORGE_SESSION_SECRET=<独立随机密钥，至少32字符>
DEMO_ACCESS_PASSWORD=<演示访问密码，至少12字符>
```

公开部署必须使用 HTTPS。生产环境未明确选择 local 时默认 public；public 缺上述配置会拒绝页面 / API。浏览器使用 HTTP Basic 密码提示，用户名可填 `demo`。本地生产构建请保持 `FORGE_DEPLOYMENT=local` 并绑定 loopback。

访问密码保护演示入口，签名 HttpOnly / SameSite=Strict 匿名 cookie 区分每个浏览器。公开 cookie 为 Secure；所有 API / RPC 校验项目所有者。清除 cookie、换浏览器 / 设备或签名密钥变更后没有自助找回。这里使用服务端匿名 cookie，不依赖 Supabase Auth 匿名登录功能。

数据库提供每会话小时 10 / 天 30 次操作尝试、全局生成小时 30 / 天 100 次尝试的保守限额，包含失败重试；进行中 / 完成重放不再消耗预算。每会话同时只允许一个生成 / 恢复。额度保存在数据库，进程重启不会清空，轮换匿名 cookie 无法绕过全局限额。该保护不是计费系统，也不代表有无限公开容量。

## 部署到 Vercel

仓库中的 `vercel.json` 使用 Next.js、`npm ci`、Node 24（由 engines 指定）、Fluid compute 和 Singapore 区域。生成接口保留 150 秒宿主期限，内部生成期限仍为 120 秒。配置依据 [Vercel 项目配置](https://vercel.com/docs/project-configuration) 与 [Function duration](https://vercel.com/docs/functions/configuring-functions/duration)。

生产环境需要添加模型 / Supabase 配置和上述 public 模式配置；服务密钥仅放到 Vercel Environment Variables，设为敏感值，不放到 NEXT_PUBLIC_* 或部署命令参数中。本地代理设置不上传。Vercel 与本地连接同一已迁移 Supabase，但不同匿名会话仍互相隔离。

`.vercelignore` 排除本地环境文件、依赖 / 构建缓存、测试和本地工具目录；`.vercel/` 链接与凭据文件不进入 Git 或部署。CLI 发布的是当前工作区内容。

登录、关联项目并设置 production 环境变量后，从仓库目录发布：

```sh
npx vercel --prod
```

环境变量变更需要重新部署。发布后使用正式域名验收密码挑战、创建、真实生成 / 修改、Restore、刷新和匿名隔离；构建成功不等于业务验收通过。

当前正式地址：[forge-agent-builder.vercel.app](https://forge-agent-builder.vercel.app)。访问用户名为 `demo`，演示密码由部署者单独提供，不保存在仓库。已完成真实线上验收，详见 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)。

## 模型配置与工作流

适配器为 `LLM_PROVIDER=openai-compatible`，使用 Chat Completions。DeepSeek 示例：`LLM_BASE_URL=https://api.deepseek.com`、`LLM_MODEL=deepseek-flash`、`LLM_OUTPUT_MODE=json_object`、`LLM_MAX_TOKENS_FIELD=max_tokens`、`LLM_THINKING_MODE=disabled`。

支持 strict JSON Schema 的服务可用 `json_schema`、`max_completion_tokens`；不支持 thinking 参数则省略该变量。不同 API 协议需另写适配器，不能只改端点就宣称兼容。无 mock fallback。

正常请求有一次具体 Planning 调用和一次代码调用。计划为 2–4 个针对需求的实现步骤，先保存并展示，再生成。无效 App 输出最多自动修正一次；计划、原 prompt、当前代码和总期限保持不变。网络、鉴权、限流或超时不触发自动修正。

`GENERATION_TIMEOUT_MS` 为 1000–120000，默认 120000。从请求入口覆盖准备、规划、生成和保存；数据库提交也检查固定期限。提交结果不确定时最多额外 5 秒确认已提交终态。宿主需支持相应请求时长，maxDuration=150 不保证平台支持。

数据库请求采用 30 秒总预算与 15 秒单次期限，安全操作最多尝试 3 次；浏览器项目请求 35 秒、生成 140 秒兜底。无法确认结果时 Reload / Retry 查询持久状态，不盲目把成功改成失败。

## 演示步骤

1. 创建命名项目，输入 Todo 需求；查看具体计划和真实生成阶段。
2. 在 Preview 添加、完成、删除任务。
3. 修改为深色模式，再增加未完成筛选。
4. 打开 Version History，查看 prompt / 时间，Preview v1。
5. Restore v1：若最新为 v3，创建新 v4；所有旧版本保留。下一次修改以 v4 为基线。
6. 刷新：恢复项目、Chat、全部版本、最新 Preview。失败请求保留错误与 Retry；进行中请求恢复阶段 / 计划并读取终态，过期后可重试。
7. 第二浏览器会话看不到第一会话项目，不能读 / 改 / Restore；同浏览器保留 cookie 时可以再次打开。

历史 Preview 暂停修改；Return to latest 或 Restore 后继续。生成中保留旧 Preview。Preview runtime error 可 Reload，不改变已保存版本。窄屏切换 Chat / Preview，支持 Desktop / Mobile。

Open project 旁的 Delete project 删除当前打开的项目。确认框显示项目名称；确认后永久删除项目、聊天和所有源码版本，成功后返回新项目页面。取消或删除失败保留当前内容；生成 / 恢复进行中不能删除，服务端也会在项目锁内检查。删除仅对当前匿名会话所有者开放。

删除不会退回已消耗的生成额度。数据库仅另存最近 24 小时内的匿名所有者 ID、操作类型、尝试次数和时间用于限额检查，不保留项目名称、提示词、聊天或源码；旧计数在后续删除时清理。

项目、消息、工作流状态、源码版本持久化；Preview 内新增的 Todo 等运行数据只在 iframe 内存，刷新 / Reload / 切版本会重置。不承诺页面关闭后任务一定在后台完成；期限允许安全回收服务器中断的任务。

## 检查与生产构建

```sh
npm run check:design
npm test
npm run lint
npm run build
npm start -- --hostname 127.0.0.1 --port 3001
```

测试不需要真实密钥。PGlite 仅为 dev dependency，执行实际 PostgreSQL 迁移和事务；模型和 HTTP 传输使用受控测试响应。不会调用付费服务或修改用户数据库。

## API 与一致性

- POST `/api/session`：建立 / 复用签名匿名 cookie。
- GET / POST `/api/projects`：当前所有者列表 / 创建。
- GET `/api/projects/{id}`：项目、消息、版本；`?view=status` 省略版本源码，供刷新恢复。
- DELETE `/api/projects/{id}`：删除当前所有者的闲置项目及其消息、版本，成功返回 204；不存在 / 越权 404，进行中 409。
- POST `/api/generate`：`{ projectId, requestId, baseVersionId, prompt }`，首次 baseVersionId 为 null。服务端读取当前完整代码，客户端不能指定所有者。
- POST `/api/projects/{id}/restore`：`{ versionId, requestId, baseVersionId }`，代码只从已验证的同项目版本读取。

新生成返回 NDJSON `status/message/plan/complete/error`。同 requestId 正在执行返回 202 状态，客户端恢复轮询；完成重放返回同版本和成功回复，不再调用模型。失败重试沿用 requestId，以新执行 token 重新认领；旧请求不能更新新尝试或成功终态。Restore 同样幂等。

缺会话 401，不存在 / 越权 404，基线 / 活动冲突 409，限额 429，上游错误 502，数据库 / 配置 503，总期限 504。流已经开始后错误为 HTTP 200 中的 error 事件。所有私有结果禁止共享缓存。

## 运行边界与交付文档

只生成自包含 browser app，不生成仓库 / 后端，不执行 shell / npm install，不实现 IDE、Multi-Agent、Git diff、branch 或 merge。

严格四字段、字段 / 总字节、HTML fragment、资源和 Acorn 语法检查继续生效。AST 区分普通 `.style.top` / 局部变量 / 文本与 `window.parent` 等全局能力。静态校验不证明任意代码逻辑正确；iframe allow-scripts + CSP 保护父 DOM / 外部资源，但不提供 CPU / 内存隔离。

`PRD.md` 和 `ARCHITECTURE.md` 描述最终实现。历史 `PHASE*_TEST_RESULTS.md` 记录分阶段验收；当前回归测试在 `tests/`，发布检查与线上验收摘要见 `RELEASE_CHECKLIST.md`。本地截图、逐轮审查报告和临时部署记录不随仓库提交。

## 设计系统与发布准备

`DESIGN.md` 记录已确认规范，`src/app/design-tokens.css` 提供宿主共享 token。`npm run check:design` 可在干净检出后运行，不依赖本地 Impeccable 引擎。发布验收边界与操作记录见 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)。
