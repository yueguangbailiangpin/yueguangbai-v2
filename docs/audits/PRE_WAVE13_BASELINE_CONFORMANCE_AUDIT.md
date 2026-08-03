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

- Migration 0027 测试源码 `apps/api/src/wave13-migration-0027.test.ts`；
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

## 12. LOCAL_REMEDIATION_VALIDATION（2026-08-03）

本地修复后的运行证据如下；它补充第 7、10、11 节的“未运行”状态，但不改写历史快照：

- `npm ci` 成功；`npm run check` 成功，Vitest 111 files / 571 tests 全部通过，typecheck 与 build 通过；
- `npm run check:wave13`、`npm run test:wave13`、`npm run db:verify`、migration guards 全部通过；Wave 13 定向套件为 12 files / 60 tests；
- 空库通过 Wrangler Local D1 依次应用 0001–0027；Schema 27、117 张应用表（另有 2 张 D1 平台表）、221 个 Trigger、10 个 View，`foreign_key_check=0`、`integrity_check=ok`；
- 真实 26→27 本地升级只应用 `0027_staff_auth_sessions.sql`；升级前 Staff 与 Customer Auth 数据保留，`staff_users.session_version` 回填/默认值为 1，既有 `customer_login_rate_limits` 与 `customer_auth_security_events` 结构未变化；
- Staff Auth 临时数据清理覆盖 24 小时保留、每表每批最多 100 行、继续批处理、近期/issued/blocked 保留以及失败先于 state/session 创建；未增加 Cron 或 Scheduled Handler；
- R2 仅使用仓库 Mock 验证 put/receipt/HEAD、D1 final commit、compensation、delete-pending 与 retry：2 files / 11 tests 通过；本地配置无真实 R2 binding，生产 R2 未运行；
- Default App、递归 DTO 与 logout-all replay 定向验证为 3 files / 8 tests 通过；
- OpenSpec 计数仍为 52 Requirements / 104 Scenarios；目标 strict validation 1/1、全仓 strict validation 2/2 通过；历史审计 change 保留 6 条既有 INFO，不构成失败；
- 当前可用 skills 中没有 `openspec-verify-change`，因此 `OPENSPEC_VERIFY=NOT_AVAILABLE`，未用普通 CLI 冒充正式 Verify；
- 非致命环境告警：npm allow-scripts 未覆盖 esbuild/fsevents/workerd；Wrangler 无权写用户 Preferences 日志，但 Local D1 命令与 dry-run 均以 0 退出。

未执行且不得声称完成：正式 OpenSpec Verify、Ponytail、浏览器/真实飞书、生产 R2、PR、Integration、部署或 main 推进。

## 13. Local Remediation Status

# NO_GO_PENDING_OPENSPEC_VERIFY

本地代码与运行门禁已通过，可以交还总控复核；正式 Verify 不可用，因此本审计不关闭 P1，也不授权 Integration 或部署。

## 14. LOCAL_VERIFY_REMEDIATION（2026-08-03）

本节追加最终修复证据，保留此前 `NO_GO`、P1、`NOT_VERIFIED` 与 `LOCAL_REMEDIATION_VALIDATION` 历史：

- 六个 Critical 已全部修复：logout Origin、Order Evidence 完整 List DTO、Refund 日期筛选与完整 List DTO、Payment `china_business_date`、Staff-only internal notes、Detail 恰好一张截图不变量。
- 原 7 条 Requirement 不一致（S9、O1、H2、R1、R3、R2、O5）已通过实现、Contract、运行测试和组合 verifier 归零。
- Default App 真实 route registry 稳定复现 138 个业务端点：历史 108 + Wave 13 活动新增 30（5/5/12/4/4）；重复注册块会失败，延期 Purpose、`/api/v2` 和通用 Link/Grant 不计入活动路由。
- `npm run typecheck`、定向 Vitest、6 项 Wave 13 verifier、Wave 13 12 files / 69 tests 和完整 `npm run check` 均通过；全量为 111 files / 580 tests / 0 failed（7.21s），build 与 Wrangler dry-run 通过。
- Local D1 为 27 migrations / Schema 27 / 117 application tables / 221 triggers / 10 views / FK 0 / integrity ok；空库与 26→27 升级均通过，本轮无 migration 修改、无 0028。
- R2 仅由仓库 Mock 完成 fault/compensation 验证；生产 R2 未验证。
- OpenSpec target/all strict 分别为 1/0、2/0。

## 15. FORMAL_OPENSPEC_VERIFY（2026-08-03）

正式 workflow 逐项核对 52 Requirements / 104 Scenarios：

| Classification | Requirements | Scenarios |
|---|---:|---:|
| `COMPLETE` | 51 | 103 |
| `APPROVED_SCOPE_REDUCTION` | 1 | 1 |
| `INCONSISTENT` | 0 | 0 |
| `MISSING` | 0 | 0 |
| `PARTIAL` | 0 | 0 |
| `NOT_VERIFIED` | 0 | 0 |

唯一 scope reduction 为 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 活动上传 Intent 延期至 Wave 15。正式 Verify 未发现新的 CRITICAL 或 WARNING。

生产 R2、真实飞书应用、中国大陆网络、浏览器与部署单独保持 `NOT_PRODUCTION_VERIFIED`。Ponytail、PR、Integration、部署、main 推进和 Wave 14 均未运行；P1 未在本审计中正式关闭。

# READY_FOR_CONTROLLER_REVIEW

该状态仅表示本地实现、门禁、strict 与正式 Verify 已达到交还总控复核的条件，不表示 GO、P1 CLOSED、Integration allowed 或 Wave 14 allowed。

## 16. CONTROLLER_CLOSURE_DECISION（2026-08-03）

本节为总控在保留全部历史审计结论基础上的正式关闭记录：

- 原始审计 `NO_GO` 历史保留；原始 P1-01、P1-02、P1-03 历史保留；不倒写、不删除历史结论。
- 最终本地门禁：111 test files / 580 tests / 0 failed；Wave 13 定向门禁：12 files / 69 tests。
- Local D1：27 migrations / schema version 27 / 117 application tables / 221 triggers / 10 views / foreign key check 0 / integrity check `ok`。
- OpenSpec strict target/all 均通过；正式 Verify：51 `COMPLETE` + 1 `APPROVED_SCOPE_REDUCTION`，`INCONSISTENT=0`、`MISSING=0`、`PARTIAL=0`、`NOT_VERIFIED=0`、`CRITICAL=0`、`WARNING=0`。
- 唯一批准范围缩减为 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 活动上传 Intent 延期至 Wave 15。

### Controller P1 Closure

#### P1-01：`CLOSED`

- 飞书仅为认证 Provider；D1 为 Staff 主体和授权权威。
- 使用 Worker 内部 Staff Session，默认启用 Staff Middleware。
- 九家族 Default App E2E 已验证。
- 401/403/404 与 authority Header bypass 已验证。
- 正式 OpenSpec Verify 无不一致。

#### P1-02：`CLOSED`

- 五种活动 Purpose File HTTP 已验证。
- Staff Order Evidence API 与 Staff Buyer Refund API 已验证。
- R2 Mock fault/compensation、原子事务与 rollback 已验证。
- DTO 隔离已验证；138 个业务端点可复现。
- 内部沟通 Purpose 作为批准范围缩减处理。

#### P1-03：`CLOSED`

- D-004 历史保留，D-014 正式澄清。
- 飞书不再作为业务权限权威。
- Staff API 只消费内部 Session 和 D1 授权。

当前审计严重级别：`P0=0`、`P1=0`。此前其他 P2/P3 与历史风险不因本节而关闭，继续按原范围和后续 Wave 保留。

审计最终状态：

`WAVE13_READY_FOR_INTEGRATION`

`WAVE13_IMPLEMENTATION_ACCEPTED=yes`

`PRODUCTION_GO=no`

原因：生产 R2、真实飞书应用、中国大陆网络、浏览器前端、部署和回滚均未验证。本节只授权 `READY_FOR_INTEGRATION`，不表示 `PRODUCTION_GO`、`DEPLOYMENT_READY` 或 `WAVE14_STARTED`。
