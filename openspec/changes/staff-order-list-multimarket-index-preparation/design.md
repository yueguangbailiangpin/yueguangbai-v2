# Design: staff-order-list-multimarket-index-preparation

## Query authority and index choice

权威查询是 `apps/api/src/staff-order-detail/routes.ts` 的 Staff formal-order
list mode，不复制或改写列表 read model。它保留既有 `orderVisibilityForActor`
范围条件、责任字段投影、`LIMIT limit + 1` 和：

```sql
ORDER BY o.confirmed_at DESC, o.id DESC
```

以及：

```sql
o.confirmed_at < ?
OR (o.confirmed_at = ? AND o.id < ?)
```

既有 `idx_formal_orders_confirmed_id` 只覆盖排序/游标；市场范围存在时，
`idx_formal_orders_marketplace_business_date` 可能先按市场取行，再为确认时间
排序建立顶层临时 B-tree。真实 `EXPLAIN QUERY PLAN` 在 1/20/80 合成分布上验证
后，选择追加：

```sql
CREATE INDEX idx_formal_orders_market_confirmed_id
ON formal_orders (marketplace_code, confirmed_at DESC, id DESC);
```

marketplace equality/单值 `IN` 是前导约束，后两列精确匹配实际降序排序与 seek
tie-break；没有市场条件时不改变既有确认时间索引的计划。多值 `IN` 或责任子查询
产生的其它临时 B-tree 不被扩大解释为本索引失败。

## Failure-first and synthetic corpus

测试首先在旧索引状态运行同一计划断言：目标市场筛选不能命中新索引，并记录
现有市场业务日期路径和顶层排序临时 B-tree 的失败事实。实现 Migration 后，相同
测试在完整本地迁移数据库上转绿。合成订单按目标市场占总数 `1%`、`20%`、`80%`
三档生成；所有订单共享同一确认毫秒，使用不同合法 ID 验证 `id DESC` tie-break
而不是只验证市场过滤。

数据通过当前表的合法产品、需求、买家、预约、证据提交/版本和正式订单源链
构造；测试专用 Staff 只建立必要的 `seller_ops` 组织分配、`buyer_refund`
固定分配和 marketplace scope。它不新增 registry 行、不切换可用性、不写真实
配置，也不导入生产数据。

## Authorization and response boundary

请求级测试继续调用真实 Hono route 与真实 Staff actor middleware。`seller_ops`
只看到其固定 Seller Organization 与允许的 synthetic market；Owner 的无市场
查询继续走全局确认时间索引；`buyer_refund` 只作为计划边界样本，不改变其固定
买家分配 OR 条件。Personal DENY、无分配空列表、组织隔离、concealed 404 和
Buyer/Seller DTO 隔离全部保持既有实现，由既有测试与 guards 证明未改动。

列表行为的验证范围是结果/计划，不是合同重写：limit+1、游标前后无重复遗漏、
`confirmed_at/id` 排序、cursor echo、filter echo、现有筛选语义均由原 Staff
order-list request-level tests 继续覆盖。

## Migration and verification boundary

`0037_stage75_multimarket_staff_order_list_index.sql` 只允许从 Schema 36 进入
Schema 37，并在事务内通过 assertion 检查索引存在且 SQL 包含三列。迁移清单、
inventory hash、fresh/sequential/repeated/wrong-order guards、`TARGET_SCHEMA`
和当前文档同时更新。测试数据库中的合成对象可以随测试生命周期销毁；任何 D1
远程对象、备份、发布、部署和生产状态都不由本 Change 操作。

## Rejected alternatives

- 不新增公开 `marketplace_code` 列表参数：当前业务尚未开放多市场可见性，索引准备
  不应偷偷改变 API 能力或授权合同。
- 不修改既有 `idx_formal_orders_confirmed_id`：它仍是无市场查询的正确计划，
  改写会扩大回归范围。
- 不为 `buyer_refund` 重写固定分配 OR、相关子查询或查询架构：其临时 B-tree
  需要单独的证据、业务决定和 Change。
- 不以当前单市场行数“无收益”否定未来索引：当前数据不能代表已确认的多市场
  分布，故采用选择性合成 EQP 而不是生产数据或 registry 变更。
