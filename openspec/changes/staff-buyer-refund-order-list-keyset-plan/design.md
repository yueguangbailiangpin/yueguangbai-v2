# Design: staff-buyer-refund-order-list-keyset-plan

## Query authority and failure-first baseline

权威实现是 `apps/api/src/staff-order-detail/routes.ts` 的 `listOrders`。它继续使用
`orderVisibilityForActor` 生成固定分配与 Marketplace scope SQL，并在同一条查询中执行
列表过滤、seek、责任阶段/异常投影、`ORDER BY` 与 `LIMIT limit + 1`。cursor payload、
编码和 filter echo 均保持原样。

失败测试在当前 Schema 37 建立合法合成订单源链，不写 Marketplace registry 或 enablement。
目标市场占比为 1%、20%、80%，订单共享 `confirmed_at` 以验证 `id DESC` tie-breaker；
`buyer_refund` 员工同时拥有两个市场 scope，固定 assignment 命中和一个未分配买家均在
两市场内。测试先对真实原始 SQL 记录父级 `USE TEMP B-TREE FOR ORDER BY`，再通过真实路由
捕获带 cursor 的查询计划。

## Root cause from direct SQLite EQP

在多 Marketplace scope 下，`idx_formal_orders_market_confirmed_id`
`(marketplace_code, confirmed_at DESC, id DESC)` 可以分别扫描每个市场段，但不能直接产出
跨市场统一的 `confirmed_at DESC, id DESC` 流，因此父查询必须排序并保留顶层 TEMP-BTREE。

计划中的其他结构被单独区分：

- fixed assignment 是 `LIST SUBQUERY`，使用 assignment 索引/过滤，不是父级排序来源；
- `confirmed_at/id` 的 seek OR 命中当前边界，但改写为 row-value 比较后父级 TEMP-BTREE
  仍存在；
- `responsibilitySelects` 中按时间/id 取最新负责人或事件的临时排序属于嵌套子查询，
  本 Change 不宣称消除，也不改变这些投影；
- `(marketplace_code, confirmed_at, id)` 的列序只适合单一 Marketplace 段，无法满足多段
  合并后的全局 ORDER BY。

## Candidate evaluation and selected repair

测试在 1%/20%/80% corpus 上比较候选：

1. row-value seek `(confirmed_at,id)<(?,?)` 与原 OR 的完整结果序列一致，但真实 EQP
   仍保留父级 TEMP-BTREE，因此拒绝。
2. 以每个 Marketplace 为分支的完整 `UNION ALL` 投影可由 SQLite 形成 `MERGE (UNION ALL)`，
   并在合成数据上与原 SQL 保持 ID 序列一致；但它要求将完整 responsibility 投影、所有
   动态过滤、固定 scope、seek 和 limit+1 复制到每个动态市场分支，并让后续市场数量、
   cursor 与参数顺序持续同步，属于不必要的高复杂度查询架构重写，拒绝落地。
3. 选择现有全局索引 `idx_formal_orders_confirmed_id` 的 `INDEXED BY` 访问路径。它只
   改变物理访问路径，不改变 WHERE、assignment、scope、投影、排序或绑定值；直接 EQP
   在带 seek 的真实路由查询中消除父级 TEMP-BTREE。完整查询结果序列与原 SQL 一致。

生产查询仅在以下条件同时满足时带该 hint：actor 含 `buyer_refund` 且权威
`resolveStaffMarketplaceCodes` 已解析出多于一个 Marketplace。解析出的 scope 列表随
同一授权 SQL 结果返回给路由，避免再次读取 scope 表造成 TOCTOU；Owner、无 scope、单
Marketplace 和其他 Staff 角色保留原有计划。Schema 31 已提供全局索引，故本 Change 不
新增或删除 migration/index。

## Equivalence and boundary proof

回归覆盖真实路由第一页与完整 cursor traversal、相同 `confirmed_at` 的 id tie-breaker、
limit+1、filter echo 与 filter mismatch、跨市场/跨卖家组织、固定 assignment 命中/不命中、
Personal DENY 的 403 和越权详情 concealed 404。HTTP response shape、DTO、cursor wire
format、角色矩阵与 Marketplace/Organization scope 均不变。

## Rejected alternatives and rollback

- 不把 fixed assignment 移到 TypeScript 过滤，也不预取 buyer ID 列表：会破坏 SQL 权威
  范围、分页、TOCTOU 和 concealed 404；
- 不把 row-value 或 UNION ALL 查询重写落到生产路径：前者无计划收益，后者需要复制并
  维护整条动态列表查询；
- 不新增索引、删除 0037 或改变 cursor/DTO/API contract；
- 回滚边界是移除单个 `INDEXED BY` 分支和 scope metadata 传递，不删除索引、不修改业务数据。

所有证据均为 LOCAL；STAGING、REMOTE CI、Cloudflare、远程 D1/R2/Queues、真实数据、push、
PR、部署和生产 migration 均不触碰，Production 保持 `NO-GO`。
