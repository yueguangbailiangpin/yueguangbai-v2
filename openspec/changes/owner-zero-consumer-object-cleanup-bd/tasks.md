## 1. 授权与迁移

- [x] 1.1 Owner 2026-09-01 拍板 B+D 两组删除（在 A+C 说明与问答确认后）。
- [x] 1.2 迁移 0039 实证收窄后删 2 表（lead_links+权限目录），保留承重的 defaults 表+视图+守卫触发器并双向断言，schema 38→39。
- [x] 1.3 verify-migrations inventory 155/488/305/10+SHA；required/forbidden 清单同步；db:verify、verify:migration-guards、verify-marketplace-registry 真实退出码 0。

## 2. 锚点与测试对齐

- [x] 2.1 全仓 38→39 锚点（含 backupArgs/schema-39 用例名/migrations[38] 变体），残余为 0。
- [x] 2.2 customer-onboarding 移除 lead_links 期望；internal-finance/staff-order-list 原断言保留（对象未删）；初版误删引发的 53 项失败已全部复绿。
- [x] 2.3 docs/CURRENT_SYSTEM_STATE.md 同步 schema 39 与 inventory。
- [x] 2.4 全量 npm test：267/267 文件、1903/1903 用例、退出码 0（2026-09-01 00:50，/tmp/npmtest_schema39_final.log）。
