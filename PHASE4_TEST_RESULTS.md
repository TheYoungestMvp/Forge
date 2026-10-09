# Phase 4 Persistence 验收

验收日期：2026-10-09。使用实际 Supabase 数据库、`deepseek-flash` 模型和本机 Chrome；首次生成与后续修改均未使用 mock 模型。验收运行在本地生产构建上。

## 完整 reload flow

测试项目 ID：`8976cd6c-953e-4056-95ad-aa44baf5dc51`。项目保留在 Supabase 中，可以从 Open project 再次打开。

| 检查 | 结果 |
| --- | --- |
| UI 创建命名项目 | 数据库保存项目名称、ID、创建/更新时间 |
| 生成 Todo v1 | 保存 user、assistant 消息和完整 HTML/CSS/JavaScript |
| 修改为 dark mode v2 | 保存第二个完整版本，parent_id 指向 v1；保留任务功能 |
| 页面刷新 | 恢复同一项目、4 条消息、2 个版本和最新 v2 Preview |
| 恢复内容一致性 | Chat 内容、版本 ID、最新版本四个源码字段与数据库逐项一致 |
| 刷新过程 | 没有再次调用 generate API 或模型 |
| 新浏览器会话打开项目 | 从项目列表恢复 Chat 和 v2，证明不依赖原浏览器 state |
| New project 后重新打开旧项目 | 原项目、Chat、版本仍在 |
| 同一 requestId 重试 | 返回已保存结果；没有新增消息、版本或再次生成 |
| 过期 baseVersionId | 返回 409 PROJECT_CHANGED，不覆盖最新版本 |
| Preview 隔离 | sandbox 仅 allow-scripts；读取 parent.document 抛出 SecurityError |
| 320px 手机宽度 | 项目控件、Chat/Preview 切换可用，没有页面横向溢出 |

新增、完成、删除任务分别在 v1、v2、刷新后的 v2、新浏览器重新打开的 v2 中实际操作通过。浏览器没有 pageerror。

## 存储错误

- 实际缺少服务端密钥时，API 返回清晰的 503 DATABASE_CONFIGURATION_ERROR；页面显示 Retry loading，失败重试保留尚未发送的输入。
- 本机 Node 直连 Supabase 曾返回 ECONNRESET，页面正确显示 DATABASE_UNAVAILABLE，没有崩溃。
- 在已打开项目的浏览器中拦截项目读取并返回 503：显示错误和重试操作，保留当前 Chat、版本和 Preview。解除拦截后重试成功恢复真实数据库数据。此项是故障注入，没有关闭或修改 Supabase 服务。
- 自动检查覆盖缺少迁移、请求校验、跨来源写入拒绝、保存失败不发送 complete、数据库源码作为模型 context、完成请求重试不重复生成。

本机已有 Windows 系统代理 `127.0.0.1:7890`。让 Node 使用该代理后，真实 Supabase 读写及模型调用均通过。README 中提供了相应的 PowerShell 启动方式；无需修改全局系统设置。

## 检查命令

```sh
npm test
npm run lint
npm run build
```

32 项自动检查全部通过；lint 和 production build 通过。

## 本阶段边界

数据库保存项目、Chat 和生成源码版本。Preview 内用户添加的任务属于生成应用的内存状态，刷新页面、Reload preview 或切换生成版本后会重置。历史版本已保存并展示，但恢复历史版本不在 Phase 4 实现范围内。此阶段未加入登录或多用户数据隔离。

## 本机验收记录

浏览器验收记录保存在：

`C:/Users/Young/.codex/visualizations/2026/10/08/01a11db7-c4bc-7b50-94ff-db31ed5549c1/phase4/`

包含 `reload-results.json`、桌面刷新截图、手机重新打开截图、存储错误截图和验收脚本。真实持久化流程共通过 14 个检查点。
