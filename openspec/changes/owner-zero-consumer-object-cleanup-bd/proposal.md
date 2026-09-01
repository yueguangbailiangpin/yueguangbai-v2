## Why

0038 清理 A+C 后，Owner 于 2026-09-01 复核 B、D 两组说明后拍板删除。实施中的实证审计（按迁移链建真实库查 sqlite_master 幸存对象引用）纠正了原盘点的一处方法缺陷——grep 只扫代码目录、漏掉"触发器体"这一数据库内消费渠道——最终收窄范围。

## What Changes

- 迁移 0039 实际删除（确认零幸存消费者，含触发器/视图体核查）：customer_buyer_invitation_lead_links（0029 获客退役后零读写，0017/0022/0023/0027 的历史触发器消费者均已被后续迁移取代）与 scheduled_operations_permission_catalog（单行声明性种子、全库零引用）。
- **保留并显式断言其存活**：staff_assignment_role_permission_defaults、其 no_delete/no_update 触发器与 staff_effective_assignment_permissions 视图——两个活守卫触发器（trg_buyer/seller_staff_assignments_staff_guard，0030 现行版）SELECT 该视图做分配资格强制校验，视图又 JOIN defaults 表，三件构成承重链。0039 的 transaction_assertions 同时断言"两表已删"与"四对象仍在"。
- verify-migrations.mjs：inventory 155 表/488 索引/305 触发器/10 视图+SHA、requiredTables/requiredTriggers 移除两表的关联项、forbiddenTables 增 2 表。
- 全套 38→39 锚点同步；customer-onboarding 邀请对象期望移除 lead_links；docs 数字同步。

## Impact

- 零运行时行为变化；分配资格守卫链完整保留。
- 历史迁移不可变；删除只发生在 0039 前向迁移。仅 LOCAL 完成。
