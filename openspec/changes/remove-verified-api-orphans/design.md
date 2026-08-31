## Context

核验起点为 `feature/staging-workflow-rate-ux` / `8e88744a2a1fe55f9823fec2e312d9673c87c148`，工作树干净且本地领先远程 87。既有 `safe-dead-code-cleanup` Change 保持不变；本文件属于独立的小型 Change。

## Decisions

### 1. 删除旧买家编号 command

`allocate-buyer-number.ts` 只定义 `allocateBuyerCustomerNumber`，当前没有任何静态或动态模块边引用。D-056 已把编号权威收敛到 `buyer-number-allocation.ts`：`create-buyer.ts` 在建档事务内调用 `planBuyerNumberAllocation`，并在同一批次推进渠道序号、写入编号事件和买家事实；邀请注册对已建档买家只做绑定激活，不创建第二个档案或新编号。

候选中的 `buyer_preorder_number_allocations` 查询属于已退役的旧 preorder 流程。Migration 0027 已删除该表，并明确“buyer numbers are allocated when the profile is created”。因此该候选不是历史兼容、迁移工具、休眠能力或动态本地预览入口；历史文档和不可变迁移文件只作为审计记录保留。

### 2. 删除无消费者 pricing barrel

`apps/api/src/pricing/index.ts` 只有五条 `export *`，没有副作用。AST 解析的静态 `import`、`export`、动态 `import()` 和 `require()` 边均没有解析到该文件。API 入口直接导入 `pricing/routes`、`pricing/seller-service-fee-routes`、`pricing/rate-center-routes`；订单确认、pricing routes 和测试继续直接导入 `buyer-daily-exchange-rates`、`pricing-shared`、`seller-service-fees`、`seller-principal-rate-policy` 等叶子模块。

删除 barrel 不改变任何 import specifier、运行时路由注册或叶子模块执行顺序。

## Evidence and protection boundaries

逐项消费者、动态加载、历史边界和叶子模块映射见 `references/consumer-evidence.md`。删除前后必须运行 focused source scans、typecheck、test、build、check、API contract、web/source boundary、当前及全量 OpenSpec strict 与 `git diff --check`。

保留边界：编号分配事件、幂等、Audit、事务最终断言、Buyer/Seller/Staff 权限与 DTO 隔离、分页/游标、D1 schema、`list-public-demand-batches.ts`、seller-members 三件套、CSS、真实数据和远程资源均不在范围内。

## Rollback

在本地提交前可用保留的工作树 diff 审查；提交后只允许通过该提交的正常 revert 回滚，不使用 reset、rebase、stash、clean、squash、amend、push 或部署。
