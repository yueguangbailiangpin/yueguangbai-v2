# Staff 四角色合并 Migration 与恢复 Runbook

## 边界

本 Runbook 只适用于 `staff-four-role-consolidation` 与连续 Migration `0035`。
ACTIVE Staff 角色固定为 `owner`（总管理员）、`pre_sales`（售前）、
`seller_ops`（卖家对接）、`buyer_refund`（买家返款），每名 ACTIVE Staff
恰有一个 ACTIVE 角色。不得用菜单隐藏替代后端授权。

当前实现和验收只读取本地匿名 SQLite/D1。该 OpenSpec Change 已完成本地验收、
同步并归档，但这不代表读取、备份、迁移或修改过生产员工数据，也不代表取得真实
员工映射批准。因此生产切换继续阻断，直到总控授权真实数据库只读预检并由 owner
完成必要的逐员工批准。

## Schema-34 切换前门禁

1. 冻结 Staff 角色、Permission Override、Team/Department 与负责人写入。
2. 创建并隔离验证 schema-34 可恢复备份；记录备份哈希、行数、
   `PRAGMA integrity_check` 与 `PRAGMA foreign_key_check`。
3. 在 schema 34 上调用 `buildStaffRoleConsolidationPlans`，保存每名 ACTIVE Staff 的：
   旧 ACTIVE 角色、唯一目标、旧/新有效权限、新增/减少权限、Personal DENY、
   Team/Leader Scope、authorization version、catalog version/hash 与 mapping hash。
4. 以下任何一项存在时禁止应用 `0035`：
   - ACTIVE Staff 为零角色；
   - 未知 ACTIVE 角色；
   - 多条 ACTIVE 角色但 owner 未选择唯一目标；
   - `buyer_support` 或 `seller_support` 没有逐员工 owner 批准；
   - 批准中的 source roles、target role、authorization version、catalog version/hash
     或 mapping hash 与最新 plan 不一致；
   - 审批者不是当前 ACTIVE `owner`，或 Personal DENY 移除了 `STAFF_MANAGE` / 
     `PERMISSION_MANAGE`。
5. owner 只能通过 `approveStaffRoleConsolidationPlan` 写入不可变
   `STAFF_ROLE_MAPPING_APPROVED` audit；必须提供 Idempotency-Key。不得手工伪造批准。
6. 重新生成 plan。审批后发生任何角色、Override、负责人包或 Scope 变化，都必须
   重新审批。

`owner→owner`、`pre_sales→pre_sales`、`seller_ops→seller_ops`、
`after_sales→buyer_refund` 是直接同义迁移；support 与多角色状态必须审批。

## 应用与验收

在明确授权的环境中才可应用 `0035`。Migration 会在一个事务内：

- 验证 schema 34 与全部映射/审批；
- 保留旧分配的角色、分配时间、原操作者，并将被替换的 ACTIVE 分配变为带撤销时间、
  撤销者和原因的历史；
- 建立每名 ACTIVE Staff 的唯一 canonical ACTIVE 分配；
- 重建持久化 role CHECK 与默认权限投影；
- 递增 authorization/session/version，撤销所有切换前 ACTIVE Staff Sessions；
- 追加 `staff_authorization_events`、`audit_events`、cutover 与 mapping 证据；
- 最终断言唯一角色、无旧 ACTIVE role、无旧 ACTIVE Session 与版本一致。

本地门禁：

```text
npm run db:verify
npm run verify:migration-guards
npm run verify:staff-role-consolidation
npm run test:staff-role-consolidation
```

还必须执行全仓授权、财务、文件、调度、Staff MCP、浏览器、Secret、typecheck 与 build
门禁。任何失败都不允许把 tasks 或归档状态标为完成。

## 切换前恢复

如果 `0035` 事务失败，它必须回滚到 schema 34 且不留下 cutover/mapping 部分 DDL。
如果 Worker 或验收在切换提交前失败：

1. 保持 Staff 写入冻结；
2. 从已验证 schema-34 备份恢复到隔离环境；
3. 核对角色、Override、Session、audit 行数与哈希；
4. 通过完整门禁后，才由总控决定是否替换目标数据库；
5. 不删除或改写失败尝试之外的授权/audit 事实。

## 切换后前向恢复

一旦 `buyer_refund` 分配或 schema-35 audit 已提交，不得回滚旧 Worker 以隐藏新角色，
也不得恢复 schema-34 备份覆盖新事实。必须使用 owner 审批的前向修复事务：撤销当前
ACTIVE 分配、插入唯一 canonical 分配、递增 authorization/session version、撤销
Sessions、追加授权与 audit 事件，并以事务最终断言验证唯一角色。历史分配、审批、
Session 撤销与 cutover 证据均不得删除。
