# 月光白 V2 — 第二层长期运行加固冻结规则

日期：2026-08-11
分支：`feature/frozen-portals-staff-acquisition-core`
当前目标 Schema：**65**；本文件主体仍是 Schema 64 第二层验收快照。

本文件与 `docs/CODE_INTEGRITY_CLEANUP_FREEZE.md` 记录 Schema 64 第二层验收事实，不自行建立文档优先级；当前权威与冲突处理遵循根目录 `AGENTS.md` 的顺序。

## 1. Staff 登录
生产 Staff 身份：Cloudflare Access + Moonwhite Staff Authority。Cloudflare 证明邮箱，Moonwhite active/status/role/Marketplace 决定最终权限。旧 Feishu Staff Auth 不再是正式依赖。

## 2. 恢复证明
Production GO 必须覆盖当前 **Schema 68 + 当前 APP_RELEASE_SHA**：D1 加密备份/隔离恢复、integrity/FK/业务 smoke/财务聚合、R2 manifest 对账和抽样 read-back，并登记不可变 recovery attestation。旧 39/43/61/64/65/66 proof 不能证明当前 release 可恢复。

## 3. health/readiness
`/health` 仅 liveness。`/ready` 同时要求 Schema 68、Scheduler、Acquisition Maintenance、对象存储、Cloudflare Access 配置、APP_RELEASE_SHA，以及同一个 release SHA 的 Schema 68 恢复证明。

## 4. Scheduler
生产必须 `SCHEDULED_OPERATIONS_ENABLED=true`、`ACQUISITION_MAINTENANCE_ENABLED=true`。关键 job 未成功、失败晚于成功、过期或 backlog 超限时 readiness 失败。

## 5. Staff 权限
能力权威 = Role 默认权限 - explicit DENY。历史 personal GRANT 和 Team leader pack 不得扩权。Migration 0054 撤销/禁止 ACTIVE GRANT；运行时同时忽略 GRANT/Team 扩权。

## 6. 文件
Staff 显式文件读取实时验证 current Role × Marketplace × Entity；旧 Team/Department 不能扩权。Seller 文件重新验证当前 Organization + Store 权限。

## 7. 订单确认后异常
原正式订单和冻结财务快照不可修改。后续只追加 PLATFORM_CANCELLED / RETURN_REFUND / BUSINESS_VOID / MANUAL_INVESTIGATION / RESOLVED。

非 NORMAL 状态不是标签：它阻止新的 Review APPROVED、Buyer Refund Obligation 和 review-driven Seller Service Fee payable，直到 RESOLVED 恢复 NORMAL。

Generic financial adjustment 只允许 PROJECTED_GROSS_PROFIT / COMPLETED_GROSS_PROFIT。Seller Principal、Seller Service Fee、Buyer Refund 的真实资金只能走各自 ledger 的正式付款/冲正/更正。

## 8. Review 展示与提前本金
Review APPROVED 是历史审核事实。Marketplace 展示另记 VISIBLE / NOT_VISIBLE / DROPPED / RECHECK_REQUIRED。

提前 Buyer Principal：
- 只允许在正式 refund obligation 形成以前记录；
- 必须绑定已验证内部付款凭证；
- 支付/冲正为不可变追加事实且服务器幂等；
- 正式 obligation 形成时自动抵扣最多到应返金额；
- 超出部分进入 `buyer_advance_principal_overpayments`，不把正式 Refund Ledger 静默推成 OVERPAID；
- 已完全抵扣的正常退款不能继续成为待支付业务。

## 9. PRIMARY / SUPPORT
同 Role × Marketplace 可多人。PRIMARY 处理 OPEN 工作队列；SUPPORT 保持站点业务可见和备用能力，但不抢同一 OPEN 队列。主负责人停用/改岗/离开站点后按完整性规则提升合适 SUPPORT。

## 10. 渠道
新渠道只允许 BUYER 或 SELLER；历史 BOTH 仅报表兼容。员工匿名 `渠道N` 创建后永久固定。Owner 可换接待微信或停用，不可改匿名编号。

## 11. 换微信
登录微信是 identity/account 属性，不是单 Marketplace 属性。Owner 核验后换绑同一个 identity subject/login account，保留所有 Buyer/Seller/Marketplace/订单/财务/渠道关系，session_version 增加，所有旧会话失效。新微信被其他 ACTIVE/RESERVED identity 占用时失败关闭。

## 12. Seller 成员
Seller OWNER 可邀请 OPERATIONS / FINANCE / VIEWER，不通过邀请创建第二 OWNER。成员必须有明确 active-store scope。已有 Moonwhite login 验证原密码并复用同一账号；新增第二 Persona 属于权限升级，必须原子增加 session_version。

当前 Seller Portal live business 是 Amazon JP。如果未来同一身份存在多个 active Seller Organization，而 Portal 尚无明确 organization selector，必须 fail closed，不能随机 `.first()`。

## 13. Agent 机器权限
每个 Acquisition Agent 独立 secret hash、Marketplace scope、channel scope、hourly limit、ACTIVE/REVOKED lifecycle。全局 shared secret 不再是 runtime authority。

## 14. Marketplace/时区
内部使用 canonical Marketplace：AMAZON_JP / AMAZON_US / COUPANG_KR / RAKUTEN_JP / TIKTOK_JP。

时间原则：
- DB timestamp = UTC；
- 公司经营报表 = Asia/Shanghai；
- 客户/订单/预约/任务业务日期 = Marketplace business timezone；
- AMAZON_JP/RakutenJP/TikTokJP = Asia/Tokyo；
- COUPANG_KR = Asia/Seoul；
- AMAZON_US = America/Los_Angeles；
- 浏览器/IP/设备时区不是业务权威；
- 历史当地日期无法可靠推导时显示未知，不能拿北京时间冒充。

`marketplace_runtime_config` 是 migration-controlled DB mirror；typed Marketplace runtime registry 是应用权威。未来变更必须版本化同步，不能 ad-hoc 更新 DB 配置。

## 当前 Migration
- 0054 access/channel/marketplace hardening
- 0055 order/review/advance compensation
- 0056 customer identifier + seller member invitation
- 0057 scoped acquisition machine credentials
- 0058 marketplace date + recovery attestation
- 0059 seller member portal store grants
- 0060 marketplace effective dates
- 0061 post-confirmation integrity guards
- 0062 runtime authority + privilege guards
- 0063 advance principal proof + overpayment
- 0064 Marketplace local-date truth

当前目标：**Schema 68 / 0001→0068 continuous**；0065 继续证明飞书退役，0066 前向补充 Advance 资金完整性，0067 前向冻结 Advance V1 全额付款/整笔冲正，0068 前向关闭 Customer security Personal DENY 绕过并增加独立改密限流。

## 本地 Codex 验收
干净 checkout + Node24：migration guards、local migration、contracts/domain/api/web typecheck、full Vitest、web build、Buyer/Seller/Staff Playwright、真实历史 D1 副本升级。

尤其验证：第二 Persona session bump、非 NORMAL 订单下游阻断、资金幂等、提前本金凭证/超额、文件 Role×Marketplace、PRIMARY/SUPPORT、完整 Seller 页面未回归、Marketplace local date truth、release-bound `/ready`。

旧测试与本文件冲突时更新旧测试；禁止恢复旧业务规则。仍禁止自动合并 main、自动生产 Migration、自动部署或自动修改 Cloudflare 生产设置。
