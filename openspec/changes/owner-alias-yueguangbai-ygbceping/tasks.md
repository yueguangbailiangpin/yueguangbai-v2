## 1. 迁移与合同

- [x] 1.1 0041 撤销 yueguangbai 通道种子，schema 40→41，断言六通道与两号并存口径反转（yueguangbai 不存在）。
- [x] 1.2 两份 CHANNEL_ALIASES 归并（yueguangbai/yuegungbai→ygbceping）+契约测试重写+隔离测试注释更新。
- [x] 1.3 verify-migrations 通道期望回 6；全锚点 40→41；七份权威文档尾部声明 0041。

## 2. 验收

- [x] 2.1 全量 npm test：267/267 文件、1906/1906 用例、退出码 0（/tmp/npmtest_41.log）。
- [x] 2.2 db:verify/guards/marketplace/schema-docs/openspec strict（88/88）全部退出码 0。
- [ ] 2.3 干净提交后 release:check 与 Codex 复审、push。
