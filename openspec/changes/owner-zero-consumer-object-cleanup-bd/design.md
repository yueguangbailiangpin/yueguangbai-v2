## 审计纠错记录（重要教训）

原零消费者盘点（grep apps/packages/tools/scripts）判定 defaults 表+视图"仅测试引用"。实施 0039 初版删除后，staff-buyer-refund-order-list-keyset-plan 等 53 项测试失败，报 `no such table: staff_effective_assignment_permissions`——根因是**两个活守卫触发器的触发器体**（定义在迁移 SQL 里，grep 代码目录扫不到）SELECT 该视图。修正方法：按迁移链建真实库后查 sqlite_master 中幸存对象的 sql LIKE 引用（排除对象自身），以此为准。结论：视图+defaults 表+守卫触发器为承重结构，恢复保留；lead_links 与 catalog 实证零消费者，删除。

## Decisions

- 0039 后置断言双向：被删 2 表在 sqlite_master 计数 0；被保留 4 对象（表+视图+2 触发器）计数 4——防止未来误删或误恢复。
- 测试对齐仅一处（customer-onboarding 移除 lead_links 期望）；internal-finance 的 defaults 种子断言与 staff-order-list 的视图诊断 SQL 原样保留（对象未删）。
