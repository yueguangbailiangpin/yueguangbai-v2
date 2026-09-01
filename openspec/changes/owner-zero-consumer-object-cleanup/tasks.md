## 1. 盘点与授权

- [x] 1.1 全仓零消费者逐表核查（运行时/工具/脚本/测试四层 grep，排除 migrations/docs/openspec 与守卫清单自身），产出 A/B/C/D 分组。
- [x] 1.2 Owner 2026-09-01 拍板：清 A（买家注册三件套+状态视图+恒空断言表）与 C（formal_order_effective_dates 视图）；B/D 待另行决定；多市场预留表保留。

## 2. 迁移与守卫

- [x] 2.1 新增 0038_owner_cleanup_zero_consumer_objects.sql：DROP 2 视图、8 触发器、4 表（子表先于父表），schema_version 37→38，transaction_assertions 后置断言六对象清零。
- [x] 2.2 verify-migrations.mjs：链尾 0038、inventory 157/490/305/10+SHA、requiredTables/requiredTriggers 移除、forbiddenTables 增 4 表。
- [x] 2.3 db:verify 直接退出码 0；verify:migration-guards、verify-marketplace-registry 直接退出码 0。

## 3. 版本锚点与验收

- [x] 3.1 全仓 37 锚点替换（链长、末迁移文件名、schema_version、TARGET/CURRENT_SCHEMA、--expected-schema、migrations[37] 下标），两轮变体补扫后残余为 0。
- [x] 3.2 受影响测试全绿（baseline-schema 16 用例、customer-onboarding、staging-bootstrap、operational-readiness、backup-restore、staff-assignment 等）。
- [x] 3.3 docs/CURRENT_SYSTEM_STATE.md 数字同步（schema 38、157/490/305/10）。
- [x] 3.4 全量 npm test：267 文件/267、1903/1903 用例、退出码 0（2026-09-01 00:35，/tmp/npmtest_schema38_final.log）；release 门禁待工作树提交后重跑。
