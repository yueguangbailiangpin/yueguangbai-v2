# Proposal: staff-buyer-refund-order-list-keyset-plan

## Why

当前 `GET /api/staff/formal-orders` 的 `buyer_refund` 列表在真实 Schema 37
和固定买家分配、Marketplace scope、`confirmed_at/id` seek 共同存在时，虽然能够
命中 `idx_formal_orders_market_confirmed_id`，SQLite 仍在父查询保留
`USE TEMP B-TREE FOR ORDER BY`。这不是当前可见性或结果正确性缺陷，但会在固定分配
买家数量和多市场数据增长后增加排序成本。

本 Change 只研究并处理这一条 Staff 读路径的计划余量风险。先用当前权威 SQL、真实
Schema 37 和合法本地合成源链建立失败证据，再逐个比较等价 SQL 形态；只有结果集、
顺序、分页和授权边界都能由回归证明，才落地最小查询修复。

## What Changes

- 新增独立 OpenSpec Change、失败优先的 Schema 37 EQP 与 HTTP 回归，覆盖固定分配
  命中/不命中、第一页/后续页、1%/20%/80% 市场选择性和 Personal DENY。
- 定位临时 B-tree 的确切来源：Marketplace 前缀、固定 assignment 子查询、seek
  OR、责任投影相关子查询及 `ORDER BY`/索引列序。
- 已证明可行的最小形态是仅在多 Marketplace 的 `buyer_refund` 列表路径选择既有
  `(confirmed_at,id)` 全局索引；固定分配仍由同一权威 SQL 执行，其他路径不改变。

## Non-goals and hard boundaries

不改变 API 路径、参数、DTO、cursor token wire format、`limit+1`、filter echo、
`confirmed_at DESC,id DESC`、任何角色/权限/Personal DENY、固定分配、Marketplace
或 Seller Organization scope、concealed 404、Buyer/Seller surface/DTO、Registry
或 enablement、0031/0037 migration、D1 其他对象。禁止把固定分配判断移到权威 SQL
之外做应用层过滤。

不新增 Migration 或索引，除非真实 EQP 证明一个单独追加对象是必要且足以解决问题；
若需要该对象，必须另行同步 migration guards、inventory、schema 文档与独立回归。

## Risk and evidence boundary

所有证据均为 LOCAL。本 Change 不执行 staging、REMOTE CI、Cloudflare、远程 D1/R2/
Queues、真实数据、push、PR、部署或生产 Migration；Production 保持 `NO-GO`。
查询重写若不能排除跨市场、跨组织、未分配买家、Personal DENY、cursor 边界或
`confirmed_at` tie-breaker 的语义风险，则拒绝实现。

本 Change 当前实现已通过 LOCAL 失败优先 EQP、HTTP 分页/权限回归和仓库门禁；不归档
本 Change，也不修改或归档既有 `staff-order-list-multimarket-index-preparation`。
