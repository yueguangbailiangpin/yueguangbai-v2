## 1. OpenSpec 与合同

- [x] 1.1 完成独立 Change 的 proposal、spec、design 与 tasks，并用 OpenSpec 当前 Change 与全量 strict 校验其结构和范围。
- [x] 1.2 复核现有 `SellerSettlementBatchMutationDto`、四条 Staff 批次写路径和 HTTP status/envelope 合同，确认不需要 Migration 或合同字段变更。

## 2. 失败测试先行

- [x] 2.1 为成员添加增加 direct service 首次响应、幂等 `response_json` 与同键重放的完整非空 `batch` 及业务字段一致性断言。
- [x] 2.2 为成员移除增加 direct service 首次响应、幂等记录与同键重放的完整非空 `batch` 及移除后金额一致性断言。
- [x] 2.3 为确认和取消增加 direct service 首次响应、幂等记录与同键重放的完整非空 `batch` 及状态/版本/冻结或取消字段一致性断言。
- [x] 2.4 增加四条 HTTP mutation endpoint 的严格 DTO 非空断言，并覆盖 payload mismatch、版本冲突、并发请求以及事件/Audit 不重复。
- [x] 2.5 运行专项测试确认基线因 `batch:null` 幂等重放缺陷失败，并保留真实退出码。

## 3. Domain/API 修复

- [x] 3.1 在成员添加路径构造提交后确定的完整批次响应，并将该响应原子写入幂等完成记录与首次返回值。
- [x] 3.2 在成员移除路径构造提交后确定的完整批次响应，并保持成员释放、账本投影和版本行为不变。
- [x] 3.3 在确认和取消路径构造提交后确定的完整批次响应，并保持状态机、冻结金额/成员数、取消释放、审计和事务断言不变。
- [x] 3.4 确认受影响路径不再写入 `batch:null`，不增加已损坏幂等记录的兜底重查询或放宽类型。

## 4. 本地验证与治理

- [x] 4.1 运行专项结算批次测试、typecheck、`npm test`、build、`npm run check`、`db:verify`、migration guards、API contract 与相关容量验证，并逐项记录直接退出码。
- [x] 4.2 运行 OpenSpec 当前 Change 验证与全量 strict 验证，以及 `git diff --check`；复核 API、数据库/迁移、前端严格 schema 与权限/审计边界。
- [x] 4.3 检查 LOCAL/STAGING/REMOTE CI/PRODUCTION 边界、确认无远程写入，并在所有门禁通过后创建独立本地提交。
