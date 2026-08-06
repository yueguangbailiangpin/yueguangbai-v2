# Design: Customer Multi-Persona, Invitation and Recovery

## Identity Model

`customer_identity_subjects` 与唯一微信 Claim 继续表示自然人身份；一个 `customer_login_account` 保存唯一凭证和 Session 版本。Buyer Profile 与 Seller Membership 是独立 Persona 关系，登录账号不再以单值 `account_type` 决定全部权限。受控 Buyer/Seller 路由分别解析 Persona；Session Projection 可安全声明可用 Persona，但不得携带跨 Persona 数据。

## Invitation Flow

Staff 命令生成至少 256-bit 随机 Token，仅保存哈希、规范化微信哈希/值、Marketplace、issuer、状态、issued/expires/consumed/revoked 时间和版本。注册链接携带原 Token；读取邀请只返回注册所需的安全上下文。邀请签发事实代表普通无冲突 Buyer 已获 Staff 批准。注册命令在一个 D1 原子批次中验证未过期/未撤销/未消费、微信与 Marketplace 一致，创建或连接 ACTIVE Identity/Account/Buyer Profile，消费邀请并写 Audit/Session issuance。任何高风险 Identity Claim 冲突在创建或激活前 fail closed，并进入 owner-only 处理路径。

打开、刷新或验证页面不消费邀请。两个并发成功提交只能有一个消费；另一个返回稳定冲突且不得创建孤立身份。

## Password Recovery Flow

ACTIVE Staff 在人工微信核验后签发短期单次 Reset Token。Customer 提交 Token 与新密码后，系统原子验证/消费 Token、替换密码凭证、递增 password/session version、撤销全部 Customer Sessions 并写安全事件。Staff API 永不接受或返回新密码。

## Authorization and Abuse Controls

所有 ACTIVE Staff 可 issue/revoke，但请求仍需可信 Staff Session、Origin、限流、幂等和 Audit。注册/重置公开边界按网络、设备、微信/Token 哈希限流；错误响应不披露账号是否存在、Persona 或邀请候选。

## Migration

Migration 通过新表/列和复制断言演进账号；不得用 `DUAL` 枚举组合角色。升级 verifier 必须证明一个 Identity 只有一个 Account、一个 Buyer Profile、最多一个有效 Seller Membership，并保持旧 Buyer/Seller 登录凭证与 Session 失效语义。

## Rollback

在双 Persona 写入前可切回旧入口；一旦产生双 Persona，旧代码无法安全表达，回退必须停止写入并恢复升级前隔离备份。邀请/重置失败通过状态和过期清理前向处理，不删除审计事实。
