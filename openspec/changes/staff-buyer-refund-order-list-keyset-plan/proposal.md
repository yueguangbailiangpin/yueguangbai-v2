# Proposal: staff-buyer-refund-order-list-keyset-plan

## Decision: explicit NO-CHANGE

本 Change 的结论是 `NO-CHANGE`，不是一个已完成的查询性能修复。独立验收拒绝了
当前 `bda2ca12` 引入的做法：在多 Marketplace 的 `buyer_refund` 列表路径无条件
强制 `INDEXED BY idx_formal_orders_confirmed_id`。该 hint 虽然可以让父查询暂时不出现
排序 TEMP-BTREE，却绕过了 `marketplace_code` 前缀选择性；在授权范围只占全表小部分、
且存在大量无关市场订单时，会把无关行带入授权与固定分配判断之前的扫描候选。

本次前向修复只做安全收口：移除该 hint 及为它增加的 Marketplace metadata 传递，
恢复 `ed15f5a2` 的 planner-autonomous 查询语义。生产列表 SQL 不采用新的物理计划，
原有计划边界保留并如实记录。

## Failure-first evidence

- 测试使用当前 Schema 37 的合法合成源链，不写 Marketplace registry 或 enablement。
- `buyer_refund` actor 拥有两个 canonical Marketplace scope（`AMAZON_US`、
  `AMAZON_JP`）；`COUPANG_KR` 只承载大量无关订单，不进入 actor scope。
- 语料覆盖授权 scope 占全表恰为 1%、20%、80%，固定 assignment 命中与一个未分配买家，
  以及第一页、深页、尾页。
- 直接 SQLite EQP 同时记录 planner 默认路径、强制全局索引候选、父级
  `USE TEMP B-TREE FOR ORDER BY` 与嵌套责任投影排序。确定性候选 probe 计算同一 keyset
  区间内、在 Marketplace 与 fixed-assignment 谓词生效前的候选行数；不依赖计时或机器负载。
- 强制全局索引候选在这些页面与选择性下不能证明安全的扫描收益；因此不进入生产路径。
  当前命令输出的实际候选数字和测试统计以 `tasks.md` 的 LOCAL evidence 为准，不沿用旧报告。

## What Changes

- 保留并扩展失败优先 EQP/HTTP 回归，明确把全局 hint 作为被拒绝的 test-only candidate。
- 移除 `routes.ts` 中 `buyer_refund` 多市场 `INDEXED BY` 分支。
- 移除 `data-scope.ts` 为该分支增加的 `marketplaceCodes` 返回 metadata；授权 SQL 本身不变。
- 将本 Change 的 proposal、design、spec 与 tasks 改写为诚实的 `NO-CHANGE` 结论。

## Preserved contracts and non-goals

不改变 API 路径、参数、DTO、cursor token wire format、`limit+1`、filter echo、
`confirmed_at DESC,id DESC`、fixed buyer assignment、Marketplace/Seller Organization
scope、Personal DENY、concealed 404、角色矩阵、Buyer/Seller surface、market registry/
enablement、0031/0037 migration、D1 schema 或任何应用层过滤边界。固定分配与 Marketplace
范围继续由同一条权威 SQL 负责，不能搬到 TypeScript 过滤。

本 Change 不声称解决以下已知边界：多 Marketplace 父查询的
`USE TEMP B-TREE FOR ORDER BY`，以及 `responsibilitySelects` 中按时间/id 选择最新
责任或事件的嵌套 TEMP-BTREE。它们仍需未来独立、直接 EQP 证明的 Change。

## Evidence boundary

所有证据均为 LOCAL。未执行 staging、REMOTE CI、Cloudflare、远程 D1/R2/Queues、真实
数据、push、PR、部署或生产 Migration；`PRODUCTION_STATUS=NO-GO`。本 Change 保持不归档，
也不修改或归档 `staff-order-list-multimarket-index-preparation`。
