# 月光白 V2 — 代码完整性收口冻结规则

日期：2026-08-11
分支：`feature/frozen-portals-staff-acquisition-core`
当前目标 Schema：**65**；本文件主体记录 Schema 64 清理验收快照。

本文件用于解决第二层 14 项实现以后审计出的代码层技术债。它不重新设计产品；它把已经冻结的业务规则收成单一、可测试、无旁路的运行实现。

## 1. 一个概念只保留一个正式前端实现

禁止通过同名 `.ts` 覆盖 `.tsx`、marker fixture、ambient PROBE、eslint ignore 等方式制造“测试绿但真实代码未验证”。

正式入口：
- Seller 页面：`apps/web/src/seller/pages/SellerPages.tsx`
- Staff 业务完整性：`apps/web/src/staff/StaffOperatingIntegrityTools.tsx`
- Seller 主账号注册：`apps/web/src/seller/registration/SellerRegistrationPage.tsx`

`apps/apps/**` 测试 marker 目录必须不存在。

Seller 页面保持原成熟业务能力；时区调整不得以重写/简化 Seller 业务为代价。

## 2. Staff 运行权限只等于 Role 默认权限减 DENY

历史 personal GRANT 与 Team leader 数据不能扩权。
Team/Department 可作为历史数据存在，但不是当前权限权威。

正式 Staff assignment HTTP 只暴露当前工作队列读取；availability、fallback、单任务重派、固定客户转移、批量转移不注册到运行时。

## 3. 新增 Persona 属于权限升级

同一 Moonwhite login 新增第二 persona（BUYER / SELLER_MEMBER）时，在 Persona 写入同一数据库事务内增加 `session_version`。

结果：
- 所有旧设备会话立即失效；
- 完成邀请的当前设备随后使用最新 `session_version` 获得新会话；
- 不允许“旧 Buyer 会话在后台自动继承新 Seller 权限”。

## 4. 所有追加型业务命令必须服务器幂等

订单异常、评论展示观察、公司利润补偿、提前本金支付、提前本金冲正都必须使用原项目的 idempotency claim/request hash/completion 机制。

前端按钮防重复不能代替服务器幂等。

## 5. 提前本金是真实资金事实

必须有已验证付款凭证。

正式 Buyer Refund Obligation 后形成时：
- 自动抵扣最多到应返金额；
- 不允许因为提前付款把正式 Refund Ledger 静默推成 OVERPAID；
- 超出正式应返的余额写入明确的 `buyer_advance_principal_overpayments`；
- 凭证与提前付款事实不可修改/删除。

## 6. 订单异常状态必须影响下游状态机

当订单处于 PLATFORM_CANCELLED / RETURN_REFUND / BUSINESS_VOID / MANUAL_INVESTIGATION：
- 不允许新 Review APPROVED；
- 不允许新 Buyer Refund Obligation；
- 不允许基于 Review Approval 新增 Seller Service Fee payable。

只有追加 RESOLVED 后恢复 NORMAL，才允许继续。
历史已经产生的账不删除，只走正式 reversal/correction/compensation。

## 7. Generic financial adjustment 只修公司利润

只允许：
- PROJECTED_GROSS_PROFIT
- COMPLETED_GROSS_PROFIT

Seller Principal、Seller Service Fee、Buyer Refund 必须使用各自正式账本的付款/冲正/更正流程。

## 8. Marketplace 时间必须真实

- 原始 timestamp = UTC；
- 公司经营日报 = Asia/Shanghai；
- 客户/订单/预约/任务业务时间 = Marketplace business timezone；
- 不能拿 China reporting date 冒充 US local date；
- 对历史资料无法可靠推导当地日期时，NULL/未知优于猜测。

当前 Marketplace Runtime：
- AMAZON_JP / RAKUTEN_JP / TIKTOK_JP → Asia/Tokyo
- COUPANG_KR → Asia/Seoul
- AMAZON_US → America/Los_Angeles

当前 Seller Portal 实际业务仍 JP-only，因此完整 Seller 页面显示日本时间。第二个 Seller Marketplace 上线前需要明确 organization/persona selector；当前多组织身份必须 fail closed。

## 9. 生产 readiness 必须绑定当前 release

`/ready` 只有同时满足以下条件才 200：
- Schema 66；
- Scheduler enabled、最近成功、失败不晚于成功、backlog 在上限内；
- Acquisition Maintenance enabled 且最近成功；
- Object Storage 可读；
- Cloudflare Access 配置不是 placeholder；
- `APP_RELEASE_SHA` 有效；
- Recovery Attestation 的 `schema_version=66` 且 `release_sha=APP_RELEASE_SHA`。

本地 release check 不得联网生产。真实 `/ready` 网络探测只能显式执行 `node scripts/probe-production-readiness.mjs`。

## 10. Schema 64 业务 Migration 尾部与当前 0065 清理尾部

- 0061 post-confirmation integrity guards
- 0062 runtime authority + privilege guards
- 0063 advance principal proof + overpayment
- 0064 Marketplace local-date truth

旧 Schema 43/61 测试只能作为历史证据，不能成为当前运行门禁。

## 11. 经营异常计数

“归因异常订单”按 DISTINCT formal order 计数。
同时保留：
- Buyer attribution gap 数量
- Seller attribution gap 数量

同一正式订单 Buyer/Seller 两边都缺来源时：异常订单=1，Buyer gap=1，Seller gap=1。

## 12. 本地验收原则

真实 typecheck/migration/Vitest/build/Playwright/历史 D1 副本升级结果高于静态 source-marker 测试。
任何测试若通过读取 marker 假文件而不是生产实现，一律修测试，不再制造 compatibility fixture。

禁止为了让旧测试通过恢复：Team 权限、个人 GRANT 扩权、重派单 API、简化 Seller 页面、非幂等资金接口、伪本地日期或旧生产认证。
