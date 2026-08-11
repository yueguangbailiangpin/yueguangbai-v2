# 月光白 V2 — Wave 15 Architecture Finalization 冻结规则

日期：2026-08-11

分支：`feature/frozen-portals-staff-acquisition-core`

Wave 15 验收时目标 Schema 为 **64**，且当时不新增 Migration；当前目标已由前向飞书清理提升为 Schema 65，业务规则仍沿用本快照。

本文件记录 Wave 15 的 Schema 64 验收事实；当前权威与冲突处理遵循根目录 `AGENTS.md` 的顺序。

## 1. Formal Order Domain Policy 是应用层业务允许性权威

正式实现：

- `apps/api/src/formal-order-policy.ts`
- `apps/api/src/formal-order-policy-routes.ts`

受订单后续状态约束的动作统一包括：

- `APPROVE_REVIEW`
- `CREATE_BUYER_REFUND`
- `ACCRUE_SELLER_SERVICE_FEE`
- `RECORD_ADVANCE_PRINCIPAL`

订单状态 `NORMAL` 才允许上述动作。以下状态统一阻断：

- `PLATFORM_CANCELLED`
- `RETURN_REFUND`
- `BUSINESS_VOID`
- `MANUAL_INVESTIGATION`

追加 `RESOLVED` 后恢复 `NORMAL`。

应用服务必须调用 Domain Policy；Schema62 数据库 Trigger 继续作为最后防线。禁止以后在新 Service 里重新发明一套 `if (status...)` 规则而绕开 Policy。

## 2. 后端 Capability/Actions 决定前端业务按钮

通用合同：`BusinessActionCapabilityDto`。

员工订单完整性查询返回 `actions`，当前至少包含：

- `record_order_event`
- `record_review_visibility`
- `approve_review`
- `record_advance_principal`
- `record_profit_adjustment`

`allowed` 同时考虑岗位/权限、订单 Domain Policy、评论状态和返款状态；`reason` 给前端解释为什么不可执行。

前端可以决定布局和文案，但不得重新实现业务授权。Capability DTO 是 UI convenience，真实安全仍由后端 Policy + permission + DB guard 保证。

以后新增/修改关键业务页面时逐步采用同一模式，不要求一次重写所有已稳定页面。

## 3. Financial Reporting Projection 只读，不是第二套总账

正式实现：

- `packages/contracts/src/financial-reporting.ts`
- `apps/api/src/admin-business-dashboard/financial-projection.ts`
- `GET /api/staff/admin-business-dashboard/financial-projection`

权威写账仍然分别属于：

- Buyer Refund Ledger
- Buyer Advance Principal Ledger
- Seller Payable / Payment Ledger
- Formal Order Financial Snapshot
- append-only Company Profit Adjustment

Financial Projection 只聚合这些权威事实，绝不反向写账。

Owner 可以同时看到：

- 卖家实际入账
- 买家实际支出
- 实际净现金流
- 本期卖家应结 / 已匹配 / 未结
- 本期买家应返 / 已返 / 未返
- 预计利润
- 已完成利润

现金流按真实支付/冲正发生时间统计。未来冲正不能把过去付款日从历史报表中抹掉；应在冲正日产生反向现金事件。

提前本金后来自动转为正式 Refund PAYMENT 时，Projection 必须排除这条自动 Payment，再读取原提前本金现金事实，避免同一笔真钱计算两次。

禁止新增一个万能 `financial_events` 写账表来复制现有账本。

## 4. File Retention 复用现有 file_objects 状态机

正式实现：`apps/api/src/files/retention.ts`。

不新造文件生命周期表。复用已有：

- `VERIFIED`
- `DELETION_PENDING`
- `DELETED`
- `delete_attempt_count`
- `next_delete_at`
- `failure_code`

基本规则：

1. 有 active `file_entity_links` 的业务文件绝不自动删除；
2. 有未过期 `ISSUED` read intent 的文件暂不删除；
3. Order Instruction 已进入专用 `ORPHANED` 流程的资产继续由原专用 Reconciliation 负责；
4. 已验证但 30 天未形成任何业务 Link 的 Durable R2 文件进入 Retention；
5. 已上传/拒绝且具备真实 R2 metadata、7 天仍未关联的文件可以进入 Retention；
6. 从未真正上传的 `RESERVED` 行不伪装成 R2 删除对象；它们不占 R2 文件空间；
7. 两阶段执行：D1 `DELETION_PENDING` → R2 delete → D1 `DELETED`；
8. R2 delete 失败保持 `DELETION_PENDING` 并指数退避重试，绝不能提前标记 `DELETED`；
9. 删除计划和实际删除前都重新检查业务 Link / active read intent。

Scheduler 的 `file_orphan_cleanup` Readiness backlog 同时包含这一通用 Retention；Retention 失败会使 Scheduler readiness 失败，不可静默忽略。

## 5. Real Behavior Tests 高于 Source Marker Tests

Wave15 新增真实执行测试：

- `wave15-architecture-finalization.behavior.test.ts`
- `formal-order-policy-routes.test.ts`
- `files/retention-current-schema.test.ts`
- `customer-security/migration-0030.test.ts` 新增 0030 + 0062 实际 Migration Persona Session 行为

必须验证：

- 异常订单所有 gated actions 被阻断，`RESOLVED` 后恢复；
- HTTP guard 真正返回 409，而不是只检查源码字符串；
- 真实 0030 Persona 自动关系 + 0062 Trigger 在第二 Persona 时只 bump 一次 Session；
- 提前本金 600 元、正式返款 500 元 → Refund Payment 500 + Overpayment 100；
- File Retention 对已关联文件不删、旧孤儿 durable file 才删、R2 失败保持 pending；
- 完整 migrated Schema64 接受 Retention 状态转换；
- 提前本金自动进入 Refund 后现金流不重复；
- Seller Payment 的后续冲正在冲正日形成负现金流，不回写抹掉原支付日。

Source marker test 只能作为静态防回退辅助。若 marker test 与真实 DB/API 行为冲突，应修 marker test，不能制造假文件让它通过。

## 6. 明确暂不实施的过度工程

当前规模不增加：

- effective permission cache；
- AI Lead Score；
- 完整 Seller multi-organization selector UI；
- migration squash；
- 新万能财务总账；
- 新 Staff 排班/SLA/复杂派工平台。

第二个 Seller Marketplace 上线前，只要求底层多组织冲突 fail closed；真实需要出现后再做 Organization Selector。

Migration 历史 `0001 -> 0064` 保留。未来若 migration 数量很大，可以增加 fresh-install baseline，但不得重写生产历史升级链。

## 7. Wave 15 结束条件

本 Wave 完成以后停止继续凭空扩架构。下一阶段只有：

1. clean checkout Node 24；
2. migration/typecheck/Vitest/build/Playwright；
3. 真实历史 D1 副本升级至 64；
4. Buyer/Seller/Staff 真实浏览器业务流程；
5. 小范围内部试运行；
6. 只根据真实失败/操作痛点修复。

仍然禁止自动 merge main、生产 Migration、部署、DNS/Cloudflare Access 修改。
