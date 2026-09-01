## 1. 迁移与守卫

- [x] 1.1 迁移 0040 补种 yueguangbai 通道（ACTIVE），断言 7 通道与双月光白并存，schema 39→40。
- [x] 1.2 verify-migrations 通道种子期望 7；新增被删对象幸存引用门禁（Codex Q6 采纳）。
- [x] 1.3 全锚点 39→40（含 '0001 -> ' 输出串、测试名裸 schema 号两处历史漏网变体本轮一并清零）。
- [x] 1.4 db:verify / verify:migration-guards / verify-marketplace-registry 真实退出码 0。

- [x] 1.5 Codex push 总审 P1 采纳：显式 yueguangbai 与文件夹默认冲突时隔离为 FOLDER_CHANNEL_CONFLICT 的语义测试（seller-partner-import.test.ts）+ 注册表种子即可达性的边界声明（proposal "Reachability boundary" 节）。

## 2. 合同与守卫测试

- [x] 2.1 主 spec 冻结路由要求按 Owner 终裁修订（delta）。
- [x] 2.2 baseline-schema 新增七通道种子断言。
- [x] 2.3 权威文档 tail 更新（V2_DATABASE_CONVENTIONS / FINAL_PRODUCTION_GO_LOCAL_PREPARATION / 四份生产文档 0001–0040 声明 / G3 清单 / CURRENT_SYSTEM_STATE）。

## 3. 验收

- [x] 3.1 全量 npm test：267/267 文件、1904/1904 用例、退出码 0（schema 40，/tmp/npmtest_schema40.log）。
- [ ] 3.2 干净提交后 release:check。
