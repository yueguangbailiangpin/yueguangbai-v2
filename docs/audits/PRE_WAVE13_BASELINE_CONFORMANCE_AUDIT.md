# Pre-Wave 13 Baseline Conformance Audit

## 1. Document Purpose

本文件保留 Pre-Wave 13 审计的历史结论，并追加 Wave 13 Feature 的 `REMOTE_IMPLEMENTATION_EVIDENCE`。历史基线来自 formal `main` `f28c52a36e9498c37453a4a12755d9ad8459ae65` 和 audit branch `5a72fd5d13204a6603ebfe3b39254915972390f8`。当前实现证据来自 `feature/wave13-frontend-readiness-backend-completion`。

本次远程收尾没有运行 npm、Vitest、D1、R2、Wrangler、OpenSpec CLI、OpenSpec Verify、浏览器或生产飞书应用。当前总体状态固定为：

# NO_GO_PENDING_LOCAL_VALIDATION

## 2. Historical Pre-Wave 13 Baseline

Pre-Wave 13 审计确认后端已经具备较强的 Domain 和数据库基础：

- Buyer/Seller session 与租户 Scope；
- Staff Role、Permission、Personal DENY、Team、Department、Assignment 和 Data Scope 引擎；
- 文件 upload intent、对象验证、entity link、audience grant、短期 read intent、compensation 和 cleanup；
- Order Evidence、Formal Order、Amazon order claim、financial snapshot；
- Review、Buyer Refund、Seller Payable/Payment、Internal Finance；
- integer JPY、integer-fen CNY、e8 rate、不可变账本、冲正、更正、Audit、Outbox、Idempotency 和 Transaction Assertions。

历史接受的本地基线为：

| Item | Historical accepted value |
|---|---:|
| Migrations | 0001–0026 |
| Schema version | 26 |
| Application tables | 113 |
| Triggers | 213 |
| Views | 10 |
| Test files | 99 |
| Tests | 511 |

这些值不是本次 Feature 的当前运行结果。

## 3. Historical P1 Findings

### P1-01 — Missing production Staff authentication/session boundary

生产入口注册 Staff/Internal Finance 路由，但没有可信 Staff login、内部 Session 和 Middleware 生成 `staffAuthorization`，因此正式 Staff 前端无法建立可用身份上下文。

### P1-02 — Missing required frontend HTTP capability surfaces

底层 File、Order Evidence 和 Buyer Refund Service 已存在，但缺少正式 File HTTP、Staff Order Evidence 和 Staff Buyer Refund 路由，正式前端无法完成完整运营闭环。

### P1-03 — Staff identity governance conflict

历史治理文字对“独立 Staff 身份”与“飞书身份入口”的关系不一致，Staff Auth Contract 不能冻结。

以上三项是历史 P1。Wave 13 已写入对应修复源码，但在完整本地和运行时验收前只能标记：

`IMPLEMENTED_AWAITING_LOCAL_VALIDATION`

不得标记正式关闭。

## 4. Historical Local Validation Supplement

历史 audit branch 曾记录：

- Node/npm/Codex/OpenSpec 环境信息；
- `npm ci`；
- 当时 schema 26 的 `npm run check`；
- 99 test files / 511 tests；
- schema 26、113 application tables、213 triggers、10 views；
- FK 0、integrity `ok`；
- strict OpenSpec validate；
- OpenSpec Verify 当时不可执行；
- real R2 failure compensation 未运行。

这些是 Pre-Wave 13 历史证据，不能证明 Wave 13 当前源码已经通过。

## 5. Wave 13 REMOTE_IMPLEMENTATION_EVIDENCE

### 5.1 Migration and Contracts

远程 Feature 新增：

- `migrations/0027_staff_auth_sessions.sql`；
- `staff_users.session_version`；
- `staff_login_states`；
- `staff_sessions`；
- `staff_auth_rate_limits`；
- `staff_auth_security_events`；
- Staff Auth、File HTTP、Staff Order Evidence、Staff Buyer Refund Contract；
- `PRICE_MISMATCH` 公共错误与 HTTP mapping。

静态 schema 预期为 27。真实 D1 应用、Trigger、FK、integrity 和行为仍等待本地运行。

### 5.2 Staff Authentication

远程源码实现：

- `POST /api/staff-auth/login/start`；
- `GET /api/staff-auth/feishu/callback`；
- `GET /api/staff-auth/session`；
- `POST /api/staff-auth/logout`；
- `POST /api/staff-auth/logout-all`；
- 10 分钟 hashed single-use state；
- 12 小时 absolute opaque internal Session；
- `__Host-ygb_staff_session` Cookie；
- Fake Provider seam；
- D1 每请求授权重算；
- 默认入口统一 Staff Session Middleware；
- Feishu/client authority Header bypass 拒绝。

Decision D-014 已明确：D1 Staff 是身份/授权权威；飞书只作为第一版认证 Provider。

### 5.3 Logout-All Replay Safety

远程源码增加受限 replay：

- 仅接受仍未超过绝对 TTL、状态 `REVOKED` 且 reason=`LOGOUT_ALL` 的旧 Session；
- 只读取 Session ID、Staff ID、issued session version；
- 使用相同 actor/action/target、Idempotency-Key 和 request hash 查询已 `COMMITTED` 记录；
- 命中后返回首次业务响应并清 Cookie；
- 不创建 Claim、不递增 `session_version`、不重复 Audit、不再次撤销 Session、不创建 `staffAuthorization`；
- 不同 Key、普通 LOGOUT、其他 reason、expired/unknown/forged Cookie 返回 401；
- 旧 Cookie 访问其他 Staff Route 仍 401。

### 5.4 File HTTP

Wave 13 活动 Purpose 为五种：

- `ORDER_EVIDENCE / BUYER_VISIBLE`；
- `REVIEW_EVIDENCE / SELLER_VISIBLE`；
- `PRODUCT_APPLICATION_IMAGE / SELLER_VISIBLE`；
- `BUYER_REFUND_PROOF / INTERNAL_ONLY`；
- `SELLER_SETTLEMENT_PROOF / INTERNAL_ONLY`。

`ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 全局常量保留，但活动 Intent Route 和 `STAFF_UPLOADS` mapping 已删除。没有创建通用 Link/Grant。该能力正式归属 Wave 15，因为当前没有冻结的实体消费命令、Link 和 Audience 流程。

文件 HTTP 实现包含 purpose-bound intent、multipart upload、complete/HEAD、short read-intent create/consume。object key 和永久 URL 不进入 DTO。

### 5.5 Staff Order Evidence

远程源码实现 list、detail、request-changes、approve。Atomic approve 在一个 D1 batch 中组合 Evidence、Claim、Formal Order、Snapshot、Seller Payable、Instruction、Evidence consume、Work Item、Audit、Event、Outbox、Idempotency 和 Assertions。

`PRICE_MISMATCH` 要求显式 ack+reason；Buyer DTO 不返回内部 reason；Snapshot 使用最终实际支付金额。

### 5.6 Staff Buyer Refund

远程源码实现 list、detail、Payment 和 Reversal：

- `BUYER_REFUND_VIEW` 与 `BUYER_REFUND_RECORD` 分离；
- SQL Scope 过滤与 404 concealment；
- append-only Payment/Reversal；
- OVERPAID 不截断；
- proof 固定 `BUYER_REFUND_PROOF / INTERNAL_ONLY`；
- Seller DTO 不暴露 Buyer Refund 成本或 proof。

## 6. Route Inventory Supplement

Pre-Wave 13 静态正式路由：108。

Wave 13 活动新增：30：

| Group | Added routes |
|---|---:|
| Staff Auth | 5 |
| Active purpose-bound File Intent | 5 |
| Buyer/Seller/Staff File lifecycle | 12 |
| Staff Order Evidence | 4 |
| Staff Buyer Refund | 4 |
| Total | 30 |

静态总路由预期：138。

延期的 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` Intent Route 不计入活动端点。

## 7. Test and Verifier Source Evidence

远程 Feature 已写入但未运行：

- Migration 0027 测试源码；
- Staff Auth 和 logout-all replay Route/Service 测试源码；
- Default App 九个 Staff 路由家族真实请求矩阵源码；
- 空库 0001–0027、26→27、state 并发、Session revoke/version、STRICT/Trigger/FK/Assertion/integrity 测试源码；
- 正式 Atomic Approve、Refund Payment、Refund Reversal 最终 batch 故障注入源码；
- R2 put、receipt、HEAD、D1 final commit、compensation delete 成功/失败、delete pending、cleanup retry 源码；
- 五种活动 Purpose/Visibility 测试源码；
- 递归遍历实际 Default App response object 的 DTO verifier 源码；
- Staff Auth route、secret/DTO、File architecture、Mismatch、Refund isolation 和 Migration 门禁源码。

“测试源码已写”不等于“测试通过”。

## 8. Requirements and Scenarios

Wave 13 保持 52 Requirements / 104 Scenarios：

| Classification | Requirements | Scenarios |
|---|---:|---:|
| `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | 37 | 74 |
| `PARTIAL` | 5 | 10 |
| `APPROVED_WAVE13_SCOPE_REDUCTION` | 1 | 2 |
| `LOCAL_VALIDATION_REQUIRED` | 9 | 18 |
| Total | 52 | 104 |

`APPROVED_WAVE13_SCOPE_REDUCTION` 只对应内部沟通 Purpose 的活动 HTTP Route 延期到 Wave 15，不删除历史常量。

## 9. P1 Re-evaluation

| Finding | Current static status | Closure condition |
|---|---|---|
| P1-01 Staff Auth/Session | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | Default App、Cookie、Middleware、全部 Staff family、D1/Provider 本地运行通过 |
| P1-02 Missing HTTP surfaces | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | File、Evidence、Refund 的 Route/D1/R2/Scope/DTO 运行证据通过 |
| P1-03 identity governance conflict | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | D-014 与实现经 OpenSpec Verify 和总控确认 |

没有任何 P1 在本文件中正式关闭。

## 10. Remaining Validation Gates

以下仍未执行：

1. 当前 Feature 的 dependency install 与 `npm run check`；
2. Vitest、typecheck、build；
3. 真实 D1 0001–0027、26→27、事务、Trigger、STRICT、FK、integrity；
4. 真实 R2 put/HEAD/compensation/cleanup；
5. 本次语义更新后的 OpenSpec strict validation；
6. OpenSpec Verify；
7. Ponytail；
8. 浏览器、飞书生产应用和中国大陆网络联调；
9. PR、Integration、部署或 main 推进。

## 11. Final Audit Status

# NO_GO_PENDING_LOCAL_VALIDATION

远程源码足以证明修复已经实现到 Feature，但不足以证明运行正确、P1 正式关闭或允许进入 Integration。
