## Why

当前 checkout 仍保留一个已被 D-056 新建档编号流程取代的旧买家编号 command，以及一个没有任何消费者的 pricing barrel。它们增加维护入口和误读风险，但不承载现行运行时能力。

## What Changes

- 删除 `apps/api/src/customers/allocate-buyer-number.ts`。
- 删除 `apps/api/src/pricing/index.ts`。
- 在本 Change 的 references 中保留可回读的多路径消费者核验、历史迁移边界和叶子模块深路径使用证据。

## Capabilities

无。该 Change 使用 `skip_specs: true`，因为它只删除无消费者源码残留，不改变可观察行为、API 合约、数据库事实、权限或产品流程。

## Impact and boundaries

现行买家建档仍由 `buyer-number-allocation.ts` 分配编号；现行邀请注册只认领已建档编号。pricing API 入口、订单确认和 pricing routes/tests 继续直接导入叶子模块。不得触碰 `buyer-number-allocation.ts`、pricing 叶子模块、`list-public-demand-batches.ts`、seller-members 三件套、D1 对象、权限、游标、CSS 或业务规则。

无 Migration、D1 replay、真实数据、远程资源、部署、push、PR 或 OpenSpec archive。回滚仅为本地正常提交的 revert。
