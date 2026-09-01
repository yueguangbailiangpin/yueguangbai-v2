## 1. 迁移与合同

- [x] 1.1 0041 收口 yueguangbai 通道（组织改指+序号归并撞号安全+墓碑 DISABLED），schema 40→41，断言六 ACTIVE+墓碑+零残留引用+next_sequence 越界。
- [x] 1.2 两份 CHANNEL_ALIASES 归并（yueguangbai/yuegungbai→ygbceping）+契约测试重写+隔离测试注释更新。
- [x] 1.3 verify-migrations 通道期望=7 行（6 ACTIVE+墓碑）+墓碑状态断言；全锚点 40→41；权威文档尾部声明 0041（墓碑口径）。

## 2. 验收

- [x] 2.1 全量 npm test：267/267 文件、1908/1908 用例（含 F2 正向与 FK 迁移两用例）、退出码 0（/tmp/npmtest_41f.log）。
- [x] 2.2 db:verify/guards/marketplace/schema-docs/openspec strict（88/88）全部退出码 0。
- [ ] 2.3 干净提交后 release:check 与 Codex 复审、push。
