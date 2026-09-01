# Proposal: staff-order-list-multimarket-index-preparation

## Why

当前正式订单数据仍是单一 `AMAZON_JP` 市场，现有员工订单列表的确认时间游标
索引可以覆盖当前数据，因此当前行数下看不到增加 marketplace-leading 索引的
收益。多市场是已确认的后续业务方向；在启用第二个市场之前，需要先把真实列表
查询的排序/游标访问路径准备好，并用可重复的选择性分布证明计划不会在一般市场
筛选下退化为排序临时 B-tree。

此前选择性审计已经证明：在多市场分布下，候选索引可以消除一般市场筛选查询的
顶层 `USE TEMP B-TREE FOR ORDER BY`。本 Change 把该结论收口为独立的本地
OpenSpec、失败优先回归、前向 Migration 和版本守卫。固定分配的
`buyer_refund` 路径含责任子查询与 seek OR；它是否仍使用临时 B-tree 不在本
Change 的成功声明内。

## What Changes

- 新增独立的多市场上线前性能准备 Change，不开启当前市场、不可见市场或任何
  marketplace business rule。
- 先以合法的本地合成源链和 `1/20/80` 目标市场分布记录旧 Schema 的失败计划，
  再新增最小前向 Migration `0037`：
  `idx_formal_orders_market_confirmed_id`，列顺序为
  `(marketplace_code, confirmed_at DESC, id DESC)`。
- 验证真实 Staff formal-order list SQL 在 `seller_ops` 市场范围、limit+1、
  `confirmed_at/id` keyset seek 下命中该索引，并按选择性检查计划；无
  marketplace filter 继续使用既有 `idx_formal_orders_confirmed_id`。
- 同步本地 Schema 版本、Migration inventory/guards、当前系统状态和当前发布
  准备文档；不改变 DTO、API 路由、cursor token、权限、数据范围或角色语义。

## Migration and non-goals

这是一次仅追加的本地 Schema 变更：`36 -> 37`。Migration 只创建一个索引并以
`transaction_assertions` 锚定前驱、结果版本和索引定义；不删除表/索引，不插入
或更新 marketplace registry、market enable config、订单业务数据或生产 ledger。

明确不包含：新增 marketplace 请求参数、改变订单可见性、改变 Owner/四类 Staff
角色或 Personal DENY、改变 Seller Organization 隔离、改变 concealed 404、改变
固定负责人分配、改变 dual lookup、改变分页/响应合同、Buyer/Seller DTO、市场
启用规则、查询架构重写或 `buyer_refund` OR 条件重写。

合成测试只复用当前 Schema 认可的 canonical market code 作为外键/约束值；它们
不写入 registry、不代表生产配置、不证明任何市场已上线。Buyer 与 Seller 端点
和 DTO 不在本 Change 的读写范围内。

## Risk and rollback

索引是追加式结构，不能改变结果集、排序、游标 token 或授权边界；主要风险是
SQLite 在特定谓词组合下选择不同计划，故验收只对真实 SQL 的必要计划事实作出
声明，并保留 `buyer_refund` 的未解决边界。若未来 staging 发现回归，须由业务
所有者批准新的前向索引处置 Migration；本 Change 不直接删除任何数据库对象。

所有证据均为 LOCAL。没有 staging、REMOTE CI、Cloudflare、D1 远程、R2、Queues、
生产或真实数据验证；Production 保持 `NO-GO`。
