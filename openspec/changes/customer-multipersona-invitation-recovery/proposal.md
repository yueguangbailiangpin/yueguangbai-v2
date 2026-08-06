# Customer Multi-Persona, Invitation and Recovery

## Why

当前 Customer Login Account 把 Buyer 与 Seller Member 定义为互斥类型，且 Buyer 注册只依赖隐藏路径、开关、限流和人机验证，没有 Staff 签发的授权凭证。已确认业务允许同一微信身份同时是 Buyer 和一个 Seller Organization Member，并要求所有 Staff 可签发七天一次性 Buyer 邀请和密码重置链接。

## What Changes

- 将凭证账号与 Buyer/Seller 业务身份拆分：一个 Customer Identity/Account 可拥有两个隔离 Persona。
- 保持同一人最多一个有效 Seller Organization Membership。
- 增加 Staff 签发、绑定微信号/Marketplace、七天有效、可撤销、成功后单次消费的 Buyer 邀请。
- 关闭无邀请注册；固定 `/buyer/register` 只接受合法邀请。签发邀请视为普通无冲突 Buyer 的 Staff 批准，匹配注册成功后直接激活并建立 Session；高风险身份冲突继续只允许 owner 处理。
- 增加全体 ACTIVE Staff 可签发的一次性 Customer Password Reset Link；Staff 不接触新密码。
- 统一 Session 失效、安全事件、限流、审计和冲突处理。

## Non-Goals

- 不允许一个 Customer 加入两个 Seller Organization。
- 不自动读取私人微信或验证微信平台所有权。
- 不建立公开注册、邮箱/短信找回或社交登录。
- 不改变 Staff 身份或飞书授权边界。

## Migration and Contract Impact

需要连续 Migration 重构 `customer_login_accounts.account_type` 权威语义、Persona 关系、邀请/重置 Token、事件与约束。只保存随机 Token 哈希，不保存原 Token。Contracts 增加 Staff issue/revoke DTO、Buyer invitation context、Customer reset start/complete 和多 Persona Session Projection。

## Dependencies

依赖 Multi-Marketplace Change 冻结 Marketplace code；如果实施顺序调整，邀请 Schema 也必须引用唯一权威 Marketplace 表，不复制临时代码。该 Change 必须在生产启用 Buyer 注册和 Seller 完整门户前完成。

## Rollback Boundary

Migration 前备份并验证所有 Identity、Claim、Account、Membership 与 Session 关系。切换前可回滚旧 Worker；产生双 Persona 或新邀请消费事实后禁止降级到互斥 `account_type`，只能前向修复或从隔离备份恢复。

## Acceptance

必须覆盖 Buyer-only、Seller-only、双 Persona、跨组织拒绝、邀请转发/过期/撤销/重放、并发消费、密码重置、全 Session 失效、权限隔离和旧账号升级。
