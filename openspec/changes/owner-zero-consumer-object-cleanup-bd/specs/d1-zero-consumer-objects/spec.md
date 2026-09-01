## Purpose

延续 0038 的零消费者清理：Owner 2026-09-01 追加授权 B+D 两组。

## REMOVED Requirements

### Requirement: Buyer invitation lead attribution link table (retired)

干净基线 MUST NOT 包含 customer_buyer_invitation_lead_links；获客归因映射随阶段 6.6C 退役，邀请持久化由 customer_seller_invitations/events 承担。

#### Scenario: Lead link table is gone from the clean baseline

- **WHEN** 迁移 0001-0039 全量应用于空库
- **THEN** sqlite_master 中不存在 customer_buyer_invitation_lead_links，customer_seller_invitations 与 customer_seller_invitation_events 保持存在

### Requirement: Assignment permission defaults trio stays load-bearing

干净基线 MUST 保留 staff_assignment_role_permission_defaults 表、其 no_delete/no_update 触发器与 staff_effective_assignment_permissions 视图：两个 staff_guard 分配守卫触发器 SELECT 该视图，视图 JOIN 该表。运行时权限解析同时依赖 staff_role_assignments、staff_marketplace_scopes 与 staff_permission_overrides。

#### Scenario: Guard chain survives the B+D cleanup

- **WHEN** 迁移 0001-0039 全量应用于空库并查询 sqlite_master
- **THEN** defaults 表、视图与两个 no_delete/no_update 触发器计数为 4 且守卫触发器定义引用视图

### Requirement: Scheduled operations permission catalog

干净基线 MUST NOT 包含 scheduled_operations_permission_catalog；其声明内容由架构文档承载而非数据库种子。

#### Scenario: Declaration catalog is dropped

- **WHEN** 迁移 0001-0039 全量应用于空库
- **THEN** sqlite_master 中不存在 scheduled_operations_permission_catalog
