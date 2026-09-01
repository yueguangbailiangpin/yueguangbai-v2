## Context

schema 37 上 161 表/313 触发器/12 视图中存在零消费者对象；清理必须走前向迁移而非改写历史（AGENTS.md 迁移不可变约束、交接 HANDOFF_CODEX_TO_GLM_20260831.md §3.10 要求另立 Change 且不与导入/索引任务混合）。

## Goals / Non-Goals

- Goals：只删 Owner 授权的 A+C 两组共 6 对象及其 8 触发器；全锚点同步；守卫清单把被删表转入 forbiddenTables 形成回归防线。
- Non-Goals：不动 seller_customer_groups/seller_customer_group_marketplaces（多市场预留、触发器仍在写）；不动 customer_buyer_invitation_lead_links、staff_assignment_role_permission_defaults（test-only，待 Owner 另决）；不动 scheduled_operations_permission_catalog；不做数据迁移（被删表恒空或仅含历史快照，无导出义务——Owner 已确认无外部报表消费 formal_order_effective_dates）。

## Decisions

- 删除顺序：视图→触发器→表（FK 子表先于父表：conflict_events 先于 conflicts），并在 transaction_assertions 断言六对象名在 sqlite_master 中计数为 0、schema_version=38。
- 版本锚点采用全仓字面量清单一次性替换+两轮变体补扫（?.schema_version 双括号、带空格 length），以 db:verify、verify:migration-guards、marketplace registry 守卫与受影响测试的真实退出码验收。

## Risks / Trade-offs

- 若未来需要注册冲突审计，只能从 extract 前的备份或 0038 前快照恢复；Owner 已确认无此需求路径。
- migration 数量断言散布约 20 文件，漏改即红——以守卫清单（memory 锚点清单）为对照逐项核对，本次全绿后清单同步更新。

## Migration Plan

- 0038 一次事务内完成删除+版本推进+断言；本地 D1 未部署，STAGING/PRODUCTION 应用遵循既有放行流程（当前均未授权）。
