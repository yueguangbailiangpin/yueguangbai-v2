# Design: staff-buyer-refund-order-list-keyset-plan

## Query authority and NO-CHANGE boundary

权威实现仍是 `apps/api/src/staff-order-detail/routes.ts` 的 `listOrders`。它继续调用
`orderVisibilityForActor`，在同一条 SQL 中执行 Marketplace scope、固定买家 assignment、
列表过滤、seek、责任阶段/异常投影、`ORDER BY confirmed_at DESC, id DESC` 与
`LIMIT limit + 1`。cursor payload、编码、filter echo、DTO 和 HTTP response shape 均不变。

本 Change 不选择新的生产查询计划。`bda2ca12` 的 `INDEXED BY idx_formal_orders_confirmed_id`
分支通过新的前向编辑移除，`orderVisibilityForActor` 恢复为只返回授权 SQL 和绑定参数，
使生产 planner 自主选择既有索引。这与 `ed15f5a2` 的生产查询语义一致，且不改写历史。

## Failure-first corpus and deterministic cost probe

测试使用当前 Schema 37 与现有受保护 source chain，不写 Marketplace registry 或 enablement。
每个 corpus 有 1,000 条正式订单：`AMAZON_US` 与 `AMAZON_JP` 是 actor 的两个 active
scope，`COUPANG_KR` 承载大量无关订单。授权 scope 占全表恰为 1%、20%、80%；所有订单共享
`confirmed_at`，ID 使用交错的固定 key，保证 `id DESC` tie-breaker 会真正参与排序。一个
`AMAZON_JP` 买家不建立 active fixed assignment，作为命中/不命中的同一语料边界。

成本 probe 不计时。对每个选择性读取真实可见的第一页、深页和尾页，取该页最后一个
`(confirmed_at,id)`，然后分别用既有全局索引和 Marketplace 前缀索引计算这个 keyset 区间
在授权谓词生效前的候选行数。这个数是可解释的 pre-authorization candidate metric：
全局索引候选包含无关 Marketplace 行，前缀索引候选只包含两个 scoped Marketplace 行；
它不是机器相关的 latency 承诺。

## Direct EQP findings

- 默认 planner 使用 `idx_formal_orders_market_confirmed_id`，跨两个 Marketplace 段后在
  父查询保留 `USE TEMP B-TREE FOR ORDER BY`；这是当前已知边界，不在本 Change 伪称已解决。
- test-only 的全局 hint 使用 `idx_formal_orders_confirmed_id`，可以消除父级 sort，但
  没有 Marketplace 前缀约束，候选 probe 在低选择性语料中会携带大量无关行。因此该
  physical plan 不能被推广为无条件安全修复。
- fixed assignment 仍是 `LIST SUBQUERY`，不是父级 sort 来源；`responsibilitySelects`
  中按时间/id 选最新责任或事件的嵌套 TEMP-BTREE 仍然存在，也不宣称消除。
- row-value seek 与原 seek OR 的结果序列相同，但父级 TEMP-BTREE 仍存在；动态按市场复制
  完整投影的 `UNION ALL` 虽可形成 merge 计划，却会复制动态过滤、权限 SQL、cursor 与
  `limit+1` 绑定，属于未授权的查询架构重写。二者均拒绝落地。

## Contract and authorization proof

真实 HTTP 回归继续覆盖第一页和后续 cursor traversal、相同 `confirmed_at` 的 ID tie-breaker、
`limit+1`、filter echo/mismatch、固定 assignment 命中/不命中、跨 Marketplace 与 Seller
Organization、Personal DENY 的 403 和越权详情 concealed 404。固定分配与 Marketplace scope
始终留在权威 SQL 内，不移到应用层过滤。

## Explicit remaining risk and evidence boundary

`NO-CHANGE` 只表示拒绝该 hint，不表示订单列表已达到最终性能目标。多市场父级
`TEMP-BTREE`、责任/异常相关嵌套排序和更大数据量下的 planner 成本仍需未来独立 Change
以直接 EQP、可解释候选评估和完整权限/分页回归证明。

所有证据均为 LOCAL；未触碰 STAGING、REMOTE CI、Cloudflare、远程 D1/R2/Queues、真实数据、
push、PR、部署或生产 migration；`PRODUCTION_STATUS=NO-GO`。0031/0037 与 D1 schema 保持不变。
