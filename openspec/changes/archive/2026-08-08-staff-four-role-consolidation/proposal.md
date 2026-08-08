# Change Proposal: Staff Four-Role Consolidation

## Why

正式合同和数据库仍允许六类 Staff 角色，而业务已冻结为总管理员、售前、卖家对接、买家返款四类。只改菜单会留下后端旧角色真值和权限漂移，必须通过独立 Migration、合同和授权回归安全收敛。

## Scope

- 将 ACTIVE Staff 角色收敛为 `owner`、`pre_sales`、`seller_ops`、`buyer_refund`。
- 每名 ACTIVE Staff 只允许一个 ACTIVE 角色，不做多角色权限并集。
- 保留旧角色分配的历史审计，并安全处理 `seller_support`、`buyer_support`、`after_sales`。
- 更新角色默认权限、分派资格、Staff Session DTO、工作台导航和中文显示名。
- 生成逐员工迁移前/后的有效权限差异并要求 owner 批准。
- 验证 Personal DENY、团队/部门、客户/店铺 Scope 和 hard deny 不变。

## Out of Scope

- 获客表、经营看板、飞书真实接入、Customer/Seller 成员角色或生产员工数据迁移。
- 借角色合并扩大内部财务、身份高风险、审计或系统管理权限。

## Migration

需要 Migration。若实现开始时 `origin/main` 仍为 schema 34，则唯一候选编号为 `0035`；开始前必须重新断言连续链。此 Change 未合入 main 前，`staff-acquisition-funnel-workbench` 不得创建或实现自己的 Migration。

## Risk and Rollback

最高风险是客服角色自动映射后获得新的正式写权限、多条旧角色被自动合并，或旧 Worker 无法读取新角色。采用 expand/validate/cutover：先建立兼容读和新约束，生成并批准唯一目标映射，原子撤销旧 ACTIVE 分配并创建新分配，最后只允许四类角色且每名 ACTIVE Staff 恰有一个 ACTIVE 角色。任何差异未批准或目标不唯一则失败关闭。切换前可恢复 schema-34 备份；切换后保留历史并使用前向更正，不删除授权审计。
