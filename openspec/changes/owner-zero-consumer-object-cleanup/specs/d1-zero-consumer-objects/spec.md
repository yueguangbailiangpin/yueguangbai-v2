## Purpose

Owner 2026-09-01 授权从干净基线移除零消费者数据库对象；本能力固化删除清单与保留边界，防止被删对象回归或预留表被误删。

## REMOVED Requirements

### Requirement: Buyer registration attempt and conflict snapshot objects

干净基线 MUST NOT 包含 buyer_registration_attempts、buyer_registration_conflicts、buyer_registration_conflict_events 表、其 no_delete/no_update 触发器，以及 buyer_registration_conflict_statuses 视图；注册限流唯一权威是 buyer_registration_rate_limits。

#### Scenario: Clean baseline contains no registration snapshot island

- **WHEN** 迁移 0001-0038 全量应用于空库并查询 sqlite_master
- **THEN** 六个被删对象名计数为 0，且 buyer_registration_rate_limits 及其触发器保持存在

### Requirement: Staff assignment cursor assertion table

干净基线 MUST NOT 包含 staff_assignment_cursor_assertions 表及 trg_staff_assignment_cursor_assertion_cleanup/guard 触发器；该表自创建起从未写入。

#### Scenario: Always-empty assertion table is gone

- **WHEN** 迁移 0001-0038 全量应用于空库
- **THEN** sqlite_master 中不存在 staff_assignment_cursor_assertions 与两个关联触发器

### Requirement: Formal order effective dates view

干净基线 MUST NOT 包含 formal_order_effective_dates 视图；Owner 确认无外部报表消费该视图。

#### Scenario: Zero-consumer date view is dropped

- **WHEN** 迁移 0001-0038 全量应用于空库
- **THEN** sqlite_master 中不存在 formal_order_effective_dates

## ADDED Requirements

### Requirement: Multi-marketplace reserved tables survive the cleanup

清理 MUST NOT 删除 seller_customer_groups 与 seller_customer_group_marketplaces 及其维护触发器；两者为即将开启的多市场能力预留。

#### Scenario: Reserved group tables remain writable by their triggers

- **WHEN** 迁移 0001-0038 全量应用并触发 seller store 变更
- **THEN** 两张预留表仍存在且其 0004/0021 维护触发器仍可写入
