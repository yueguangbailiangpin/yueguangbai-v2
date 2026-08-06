# Customer Multi-Persona Migration 0030 回滚与恢复清单

## 切换前

1. 停止 Customer 身份、邀请、恢复和 Seller Member 写入。
2. 导出并校验 `customer_identity_subjects`、微信 Claim、登录账号、密码凭证、Buyer、Seller Membership、Persona、Session 版本、邀请/恢复及全部事件表。
3. 记录 Migration 0029 数据库哈希、`PRAGMA integrity_check` 和 `PRAGMA foreign_key_check`。
4. 在隔离数据库完整恢复并验证账号、Claim、Buyer、Seller、Store 和 Session 关系。
5. 部署前单独配置至少 32 bytes 的 `CUSTOMER_SECURITY_TOKEN_SECRET`，不得与
   Customer Session Secret 复用；轮换时必须先撤销所有未消费邀请和恢复凭证。
6. `BUYER_SELF_REGISTRATION_ENABLED` 在 Change 完整集成并由生产负责人明确
   放行前保持关闭；本 Change 不执行生产 Secret、开关或数据库写入。

## 尚未产生双 Persona 时

若 0030 已部署但尚无任一账号同时存在 Buyer 与 Seller Persona，且没有 0030 邀请消费或密码恢复事实，可以停止写入并切回旧 Worker；数据库回退只能从已验证的 0029 隔离备份恢复，禁止删除 0030 表或事件来伪造回退。

## 已产生双 Persona 或新安全事实后

旧代码无法表达同一凭证账号的两个 Persona。此后禁止降级旧 Worker、禁止反向改写 `account_type`、禁止删除 Persona、邀请、恢复或审计事件。唯一安全路径是：停止身份写入，修复当前版本并前向迁移；若数据库不可恢复，则从切换前隔离备份整体恢复，并单独保全切换后的安全审计证据供人工处置。

## 失败恢复

- 邀请/恢复未消费：保留摘要和事件，撤销或等待过期，不物理删除。
- 并发消费：数据库条件更新与事务断言只允许一个成功；失败方不应留下孤立 Identity、Buyer、Account 或 Session issuance。
- 密码恢复完成：`session_version` 已递增，禁止恢复旧密码或旧会话；只能再次签发新的恢复链接。
- 校验失败：保持写入停止，保留数据库副本和命令日志，运行完整 Migration、权限、Session、OpenSpec 与 secrets 门禁后再开放。
