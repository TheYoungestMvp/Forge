# Phase 5 Version History 验收

验收日期：2026-10-09。使用真实 Supabase、`deepseek-flash` 和 Chrome，在本地 production build 上完成验收。

测试项目：`46ff1a94-f940-4e40-ac72-63542e2c51d2`。项目保留在数据库，打开后可以继续体验全部历史。

## 真实完整流程

| 版本 | 操作                                | 验证                                                     |
| ---- | ----------------------------------- | -------------------------------------------------------- |
| v1   | 生成 Todo                           | 新增、完成、删除任务可交互                               |
| v2   | 改为 dark mode                      | 完整新版本保存，任务操作保留                             |
| v3   | 添加 All / Unfinished filter        | 未完成筛选和任务操作可交互                               |
| v4   | Restore v1                          | 四个源码字段与 v1 完全相同，parent 指向 v3；v1–v3 未改动 |
| v5   | Restore v2（失败注入后重试）        | 复用同一 requestId，完整复制 v2，原有历史保留            |
| v6   | 在恢复后的版本上继续要求添加 filter | parent 指向 v5；保留深色主题，筛选与任务操作通过         |

最终保存了 6 个版本和 12 条 Chat 消息。

## 历史查看与恢复

- Version History 按 v6 → v1 排序，展示完整 prompt、创建日期和时间；使用浏览器本地时区，验收时区为 Asia/Shanghai。
- 点击 v1、v2 后，iframe 中 title/html/css/javascript 与对应数据库记录逐项一致，历史应用可实际交互。
- 历史查看不写入数据库、不调用模型、不改变最新版本。查看旧版时禁止发送修改，Return to latest 可恢复最新 Preview 并继续输入。
- Restore v1 创建新的 v4，使用新 ID、编号和创建时间。原版本记录逐项比较保持不变，Restore 没有调用模型。
- 刷新后完整保留 v1–v4、恢复操作的 Chat 和最新 v4 Preview；最终刷新也保留 v1–v6。
- 同一已完成 Restore 请求再次提交，返回相同版本，版本和消息数量不增加。
- 过期 baseVersionId 返回 409；跨项目 source version 返回 404。两种情况下最新版本和历史不变。
- 在 375px、320px 宽度下无页面横向溢出；键盘可以选择版本、展开/收起历史。
- iframe 仍仅使用 sandbox="allow-scripts"。浏览器没有 pageerror。

## 错误与恢复

首次真实模型输出未通过 JavaScript 字段校验，系统显示 INVALID_GENERATED_APP，没有创建无效版本、没有崩溃。使用同一请求 ID 重试后成功保存 v1；错误回复被该请求的成功回复更新，没有重复消息。后续继续使用这个测试项目完成历史验收，未放宽校验规则。

浏览器中对 Restore 请求注入 HTTP 503：错误和 Retry restore 显示正常，v4 Preview 和四个历史版本保留。解除故障注入后重试，使用同一 requestId 保存 v5。此项未关闭或修改 Supabase 服务。

## 自动检查与构建

```sh
npm test
npm run lint
npm run build
```

38 项自动检查全部通过，lint 和 build 通过。新增检查覆盖请求校验、来源校验、服务端源码复制、重复 Restore、跨项目拒绝、危险历史代码拒绝、过期版本冲突和保存事务失败。

真实浏览器验收通过 19 个检查点。截图、脚本、完整结果与首次模型拒绝记录保存在：

`C:/Users/Young/.codex/visualizations/2026/10/08/01a11db7-c4bc-7b50-94ff-db31ed5549c1/phase5/`

## 实现范围

- 复用已有 forge_save_generation 保存事务，无需执行新的数据库迁移。
- 每次成功生成或 Restore 都追加完整版本，历史记录不删除、不覆盖。
- Restore 恢复源码；Preview 内用户输入的运行时数据仍会在切换版本或刷新时重置。
- 未实现 Git diff、branch、merge，也未加入新数据库 abstraction。
