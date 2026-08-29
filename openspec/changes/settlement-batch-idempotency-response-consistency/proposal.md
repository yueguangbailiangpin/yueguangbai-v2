## Why

结算批次的成员添加、成员移除、确认和取消命令在首次业务事实成功提交后，曾把 `batch: null` 写入已提交幂等记录；同一键重试因此可能返回 HTTP 200 但缺少权威批次对象。该结果违反现有非空 DTO 合同，并会让客户端把成功写入误判为不可用，当前需要在下一次本地提交前收口。

## What Changes

- 让四条结算批次写命令在事务内保存与首次对外响应完全一致的完整 `batch` 对象。
- 让同键同请求重放返回相同的批次业务字段，仅将 `replayed` 标记为 `true`。
- 增加直接服务层、HTTP DTO、请求哈希冲突、版本冲突、并发和审计/业务事件不重复回归覆盖。
- 增加源码守卫，防止结算批次完成响应重新写入 `batch: null`。
- 不新增 Migration，不改变结算账本、状态机、权限、Seller 安全 DTO、导出收据或现有流式导出行为。

## Capabilities

### New Capabilities

- `seller-settlement-batch-idempotency-response-consistency`: 结算批次写命令首次响应与同键幂等重放的完整响应一致性。

### Modified Capabilities

- 无。既有 Stage 7.5 批次业务合同保持不变，本 Change 只补齐其已声明的响应持久化实现。

## Impact

- 代码：`apps/api/src/seller-settlements/batches.ts`。
- 测试：结算批次服务与 HTTP request-level 回归测试。
- OpenSpec：新增本 Change 的行为合同、设计与可执行任务清单。
- 数据库：仅读取现有 `command_idempotency_records`、批次和账本投影；无结构或远程数据变化。
- 发布边界：只验证 LOCAL；不访问 STAGING、REMOTE CI、Cloudflare、GitHub 或 PRODUCTION。
