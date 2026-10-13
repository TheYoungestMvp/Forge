# Runtime Data SDK v1 设计附件

这些文件是 [下一阶段设计](../../REAL_DATA_DESIGN.md) 的契约草案，当前预览没有安装此 SDK，不应把样例当作运行配置。

- `sdk.d.ts`：拟注入的 `forge.data` 类型接口。运行时每条操作仍须重新验证权限、字段、配额和版本。
- `manifest.example.json`：Todo 的版本 manifest 样例，collection UUID 是合成值。真实 id、schema revision、hash、项目/版本绑定由服务器保存；客户端提交这个 JSON 不会获得权限。

manifest operations 为版本能力上限，实际运行还需与当前账号、批准 grant、运行模式取交集。历史 fixture 不访问真实数据；历史真实预览只读。`operationStatus` 只查询本主体在当前项目/集合范围的最小操作元数据，也不绕过身份验证。

项目级恢复与取消屏障接口只供可信宿主使用，不是 SDK 方法。未知写入在刷新后若没有可重试参数，宿主可在事务锁内查询或写永久取消墓碑，使迟到的原 ID 不再执行；鉴权失败不能被误认为原写确定未提交。

实施时从可信 manifest 校验器导出 JSON Schema 和集合类型，不另维护两套运行定义。下例展示批准 Todo 后的类型扩展；它只供编辑器与编译检查使用，不提供运行库。

```typescript
import type { CollectionContract } from './sdk';

declare global {
  interface ForgeDataCollections {
    tasks: CollectionContract<
      { title: string; done: boolean },
      { title: string; done?: boolean },
      { title: string; done: boolean }
    >;
  }
}
```

revision 使用十进制字符串，避免 PostgreSQL BIGINT 转 JavaScript number 丢失精度。create/update/remove 返回最小不可变 ack；`get` 返回现态。确定未提交的拒绝与提交结果未知的故障分别呈现；重试保持原 operationId 和参数，不因刷新创建新 ID。
