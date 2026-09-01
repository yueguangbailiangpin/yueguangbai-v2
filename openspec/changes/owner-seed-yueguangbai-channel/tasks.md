## 1. 迁移与守卫

- [x] 1.1 迁移 0040 补种 yueguangbai 通道（ACTIVE），断言 7 通道与双月光白并存，schema 39→40。
- [x] 1.2 verify-migrations 通道种子期望 7；新增被删对象幸存引用门禁（Codex Q6 采纳）。
- [x] 1.3 全锚点 39→40（含 '0001 -> ' 输出串、测试名裸 schema 号两处历史漏网变体本轮一并清零）。
- [x] 1.4 db:verify / verify:migration-guards / verify-marketplace-registry 真实退出码 0。

## 2. 合同与守卫测试

- [x] 2.1 主 spec 冻结路由要求按 Owner 终裁修订（delta）。
- [x] 2.2 baseline-schema 新增七通道种子断言。
- [x] 2.3 权威文档 tail 更新（V2_DATABASE_CONVENTIONS / FINAL_PRODUCTION_GO_LOCAL_PREPARATION）。

## 3. 验收

- [ ] 3.1 全量 npm test 真实退出码。
- [ ] 3.2 干净提交后 release:check。
