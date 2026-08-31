# Tasks: staff-order-list-multimarket-index-preparation

## Migration

- [x] 1.1 在 `formal_orders` 上新增 `0037` 前向索引
  `marketplace_code, confirmed_at DESC, id DESC`，并把 Schema 36→37、
  transaction assertion、inventory hash 和迁移守卫同步到当前 HEAD。

## Contracts and scope preservation

- [x] 2.1 逐项确认 `packages/contracts`、列表 DTO、API route、cursor codec、
  response shape、limit+1 和 filter echo 未修改。
- [x] 2.2 逐项确认 Staff marketplace scope、固定负责人分配、Seller Organization
  隔离、Personal DENY、concealed 404、dual lookup 以及市场 enable rules 未修改；
  Buyer/Seller 可见性和 DTO 隔离保持原合同。

## Focused tests

- [x] 3.1 先运行旧 Schema 失败回归：合法合成多市场源链在 1/20/80 分布下不能
  命中新索引，并记录一般市场筛选的旧计划/顶层临时 B-tree。
- [x] 3.2 运行实现后的 1/20/80 request-level + EQP suite：seller_ops 结果只
  来自目标市场，顺序为 `confirmed_at DESC,id DESC`，命中新索引且无顶层排序
  临时 B-tree。
- [x] 3.3 验证 Owner 无市场查询仍使用既有 `idx_formal_orders_confirmed_id`，
  并回归 limit+1、cursor echo、filter echo、前后翻页、Personal DENY 和既有
  固定分配/组织隔离测试。
- [x] 3.4 对 `buyer_refund` 固定分配 + seek OR 只记录实际计划与未解决的
  TEMP-BTREE 边界，不把它列为本 Change 的通过条件，不重写 OR 或权限。

## Verifiers and documentation

- [x] 4.1 运行 focused EQP/capacity、Staff order-list、typecheck、test、build、
  check、db:verify、migration guards、API contract、web source/static guards、
  current/all OpenSpec strict 和 `git diff --check`，保留每个直接命令退出码。
- [x] 4.2 更新 `docs/CURRENT_SYSTEM_STATE.md` 与当前迁移/发布准备锚点，明确
  0037 仅为未来多市场上线前性能准备，LOCAL/STAGING/REMOTE CI/PRODUCTION 分层，
  Production=`NO-GO`。
- [x] 4.3 仅创建一个本地原子提交；不 push、不部署、不访问远程 D1/R2/Queues/Cloudflare，
  不归档本 Change。

## Local evidence (2026-08-31)

- 旧 Schema 基线在加入 0037 前运行同一 focused suite 直接退出 `1`：目标索引不存在，
  市场/业务日期路径出现顶层排序 TEMP-BTREE；加入 0037 后同一 suite 直接退出 `0`。
- `npm run verify:order-list-capacity` 直接退出 `0`（2 files / 10 tests）；其中
  `staff-order-list-multimarket-index.test.ts` 覆盖 1%/20%/80% 合成分布、旧计划红灯、
  真实 Hono 列表结果、Owner 无市场路径、cursor echo 和 buyer_refund 计划边界。
- `npm run check` 直接退出 `0`；完整本地证据仍只属于 LOCAL，未执行 staging、REMOTE CI、
  Cloudflare、远程 D1/R2/Queues、部署或生产 Migration；Production=`NO-GO`。
