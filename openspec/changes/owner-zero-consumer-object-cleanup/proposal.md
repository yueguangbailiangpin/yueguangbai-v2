## Why

全仓零消费者盘点（2026-08-31 子代理核查，逐表 grep 运行时/工具/脚本/测试引用）确认六类对象在当前 schema 37 上零读取：买家注册尝试/冲突/冲突事件三表与 0019 状态视图构成互消费孤岛（限流早已改走 buyer_registration_rate_limits）、0015 的 staff_assignment_cursor_assertions 自建表起从未收到任何行、formal_order_effective_dates 视图历经三次重建始终无读取方。Owner 于 2026-09-01 拍板清理 A+C 两组，并确认 seller_customer_groups 两表因即将开新多市场必须保留、test-only 与权限目录两组另行决定。

## What Changes

- 新增前向迁移 0038：DROP 4 表（buyer_registration_attempts / buyer_registration_conflicts / buyer_registration_conflict_events / staff_assignment_cursor_assertions）、8 个关联触发器、2 个视图（buyer_registration_conflict_statuses / formal_order_effective_dates），schema_version 推进至 38 并带 sqlite_master 后置断言。
- scripts/verify-migrations.mjs：expectedLatestSchema/lastMigration/inventory（157 表/490 索引/305 触发器/10 视图+新 SHA）、requiredTables/requiredTriggers 移除被删对象、forbiddenTables 增加被删 4 表。
- 全套版本锚点 37→38：baseline-schema 链测试、TARGET_SCHEMA/CURRENT_SCHEMA 四处运行时常量、迁移链长/末文件名/schema_version 断言测试约 20 文件、backup-restore-cli 与 bootstrap-staging 测试的 --expected-schema。
- docs/CURRENT_SYSTEM_STATE.md 事实数字同步。

## Capabilities

### Modified Capabilities

- d1-zero-consumer-objects：从干净基线中移除 Owner 确认的零消费者注册快照/断言/日期视图对象。

## Impact

- 无运行时行为变化（全部对象零消费者）；历史迁移文件保持不可变，删除仅发生在 0038 前向迁移。
- 备份/恢复、staging bootstrap、生产就绪检查的期望 schema 版本随锚点更新。
- 本地、STAGING、REMOTE CI、PRODUCTION 证据分层不变；本 Change 仅 LOCAL 完成。
