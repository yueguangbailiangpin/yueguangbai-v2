# 月光白 V2 — 第二层 14 项长期运行加固冻结规则

日期：2026-08-11

分支：`feature/frozen-portals-staff-acquisition-core`

当前目标 Schema：**61**

本文件高于旧文档中与生产认证、Schema 版本、文件权限、订单异常、评论展示、提前本金、员工主/协助、渠道 BOTH、客户换微信、Seller 多成员、Codex 机器密钥、Marketplace/时区冲突的描述。

## 1. 生产 Staff 登录只认 Cloudflare Access + Moonwhite Authority

生产模板必须配置：

- `STAFF_ACCESS_TEAM_DOMAIN`
- `STAFF_ACCESS_AUD`
- `STAFF_AUTH_ALLOWED_ORIGINS`

旧 Feishu Staff Auth Provider 不再是正式登录依赖。Cloudflare 证明邮箱，Moonwhite Staff active/status/role/Marketplace 是最终权限。

## 2. 生产恢复必须覆盖当前 D1 + R2

旧 Schema 39/43 的恢复证明不代表 Schema 61 可恢复。

Production GO 必须有当前 release SHA 对应的：

- D1 加密备份 / manifest
- Schema 61 隔离恢复
- integrity / foreign keys / row counts / 财务聚合 / smoke read
- R2 manifest 对账
- R2 抽样真实 read-back size + SHA
- append-only `production_recovery_attestations`

恢复证明只能在真实演练完成后由 Owner 受控接口登记。

## 3. `/health` 是 liveness，`/ready` 才是生产可用性

`/ready` 必须同时满足：

- Schema 61
- 关键 Scheduler 最近成功
- Acquisition Maintenance 最近成功
- R2/对象存储可读
- 当前 Schema 恢复证明存在

GitHub 独立生产监控检查 `/ready`，不再把简单 200 当成系统健康。

## 4. Scheduler / Acquisition Maintenance 是生产 Gate

生产模板：

- `SCHEDULED_OPERATIONS_ENABLED=true`
- `ACQUISITION_MAINTENANCE_ENABLED=true`

Scheduler 从未成功运行或最近失败/过期时 `/ready` 必须失败。

## 5. Staff 个人权限 Override 只允许 DENY，不允许 GRANT 扩权

Role 是能力来源。历史 ACTIVE GRANT 在 Migration 0054 被撤销。

数据库禁止以后创建 ACTIVE GRANT override。

Owner 权限来自 Owner role，不靠个人额外 GRANT。

## 6. Staff 文件/截图读取使用当前 Role × Marketplace × Entity

显式文件 grant 只是“这个文件设计上允许哪个业务 audience”的证明，不能用旧 Team/Department 扩权。

Staff 打开文件时实时重新验证：

- Staff active
- 当前 role permission
- 当前 Marketplace scope
- 当前业务实体归属

Seller 文件同时重新验证当前 Seller Organization + Store 权限。

旧 Team/Department 不再决定新 Staff 文件可见性。

## 7. 正式订单确认后异常只能追加补偿，不改原订单

`formal_orders` 与原财务快照保持历史事实。

后续异常记录到：

- PLATFORM_CANCELLED
- RETURN_REFUND
- BUSINESS_VOID
- MANUAL_INVESTIGATION
- RESOLVED

财务补偿写入 signed append-only `formal_order_financial_adjustments`。公司 Owner 经营看板的预计/完成利润读取补偿后的有效结果。

卖家本金/服务费/买家返款的实际现金与 payable/refund ledger 继续使用既有 reversal/correction 流程；不能为了订单异常回写原 financial snapshot。

## 8. 评论审核结果与 Amazon 展示状态分开；提前本金单独记账

Review APPROVED 是“当时审核通过”的历史事实。

审核通过后才允许记录 Marketplace 展示观察：

- VISIBLE
- NOT_VISIBLE
- DROPPED
- RECHECK_REQUIRED

它们不改 Review Approval。

评论正式形成 Buyer Refund Obligation 以前可以记录 `buyer_advance_principal_entries`。

当正式返款义务以后形成时：

- 系统自动把未冲正提前本金转成正式 Buyer Refund PAYMENT
- 建立 settlement link
- 自动计算 DUE / PARTIALLY_PAID / PAID / OVERPAID
- 已完全抵扣的返款任务不能继续出现在 OPEN 工作队列

避免员工重复付款。

## 9. PRIMARY / SUPPORT 不抢同一 OPEN 工作队列

多个员工可以负责同一 Role × Marketplace：

- PRIMARY = 当前主负责人
- SUPPORT = 协助

普通客户/产品数据仍按 Marketplace 可见。

开放业务工作队列只给 PRIMARY。SUPPORT 不与 PRIMARY 同时处理同一批 OPEN 任务。

PRIMARY 停用、改岗或失去站点后按既有完整性规则自动提升合适 SUPPORT。

## 10. 运营渠道只允许 BUYER 或 SELLER；`渠道N` 永久不改名

新渠道禁止 `BOTH`。

同一真实平台同时做买家和卖家时建立两条独立渠道记录。

历史 BOTH 仅 Owner/获客报表兼容读取，不给售前/卖家对接使用。

员工匿名编号 `渠道1/渠道2/...` 创建后不可重命名。Owner 只能：

- 改对应接待微信
- 停用渠道

避免历史聊天/统计中的“渠道1”后来被改成“渠道4”。

## 11. 客户换微信不新建 Customer / Seller / Order

Owner 通过具体 Buyer Customer 或 Seller Organization 人工核验后执行换绑：

- 原 ACTIVE WeChat claim → RELEASED
- 新微信 → 同一个 identity subject 的 ACTIVE claim
- login identifier 更新
- session version +1，所有旧客户会话失效
- append-only change event + audit

不改变：

- Buyer Customer ID
- Seller Organization ID
- 历史订单
- 历史财务
- 获客渠道

新微信已被别的 ACTIVE/RESERVED identity 使用时失败关闭。

## 12. Seller 主账号可以邀请团队成员

Seller OWNER 可以邀请：

- OPERATIONS
- FINANCE
- VIEWER

不能通过邀请创建第二个 OWNER。

邀请需要选择允许的 active stores；token 只存 hash，链接明文只在生成时显示一次。

新成员：

- 已有月光白账号时验证原密码，复用 identity/login account
- 无账号时才创建新登录账号
- 激活 SELLER_MEMBER persona
- 使用 Store Grant 限制店铺范围

Seller Store 读取同时兼容历史 store scope 和新 Portal grant。

## 13. Codex / Agent 不再共享一个全局万能 Secret

每台获客 Agent 拥有独立：

- machine id/name
- 随机 secret（数据库只存 SHA-256）
- allowed Marketplaces
- allowed acquisition channels
- hourly request limit
- ACTIVE/REVOKED lifecycle

机器密钥明文只在 Owner 创建成功时显示一次。

Prospect 创建、Signal、Analysis 都重新检查该 machine 的 Marketplace + Channel scope。

一个 Agent 密钥泄漏不能扩大到其它 Agent、站点或渠道。

## 14. Marketplace 代码与时区正式分层

内部新逻辑以 canonical Marketplace 为权威：

- AMAZON_JP
- AMAZON_US
- COUPANG_KR
- RAKUTEN_JP
- TIKTOK_JP

旧 `JP/US/KR` 只作为 legacy persistence adapter。

`marketplace_runtime_config` 保存：

- legacy order code
- business timezone
- reporting timezone
- currency/exponent
- buyer/seller portal readiness

时间原则：

- 公司经营报表：Asia/Shanghai
- 当前 Amazon JP 客户/订单/排期：Asia/Tokyo
- 未来 Marketplace：使用自己的 business timezone

`formal_orders` 有 canonical marketplace authority，并通过 `formal_order_effective_dates` 提供站点本地日期与公司报表日期。

未来非 Amazon JP 正式订单如果没有明确 Marketplace local business date，数据库失败关闭，不允许静默使用北京时间代替。

## 当前 Migration

本轮新增：

- 0054 access/channel/marketplace hardening
- 0055 order/review/advance compensation
- 0056 customer identifier + seller member invitation
- 0057 scoped acquisition machine credentials
- 0058 marketplace date + recovery attestation
- 0059 seller member portal store grants
- 0060 marketplace effective dates
- 0061 post-confirmation integrity guards

当前目标：**Schema 61**。

## 本地 Codex 验收要求

必须从干净 checkout 运行：

- `npm ci`
- `npm run db:verify`
- `npm run verify:migration-guards`
- `npm run db:migrate:local`
- contracts/domain/api/web TypeScript
- targeted security/integrity tests
- full Vitest
- web build
- Staff/Buyer/Seller Playwright
- 历史 D1 副本 43/现有生产前缀 → 61 升级 dry-run
- 文件/截图 Role×Marketplace leakage tests
- Seller member multi-persona tests
- advance principal auto-settlement/double-payment tests
- order compensation + dashboard tests
- channel BOTH/label immutable tests
- per-machine Agent scope/rate tests
- `/ready` fail-closed tests

旧测试与本文件冲突时，更新旧测试，不能恢复旧业务规则。

仍然禁止：自动合并 main、自动生产 Migration、自动部署、自动 Cloudflare 配置修改。
