# Pre-Wave 13 Frontend API Readiness

## 1. Evidence Status

本文件保留 Pre-Wave 13 的历史路由结论，并追加 Wave 13 Feature 的 `REMOTE_IMPLEMENTATION_EVIDENCE`。当前实现只能标记 `IMPLEMENTED_AWAITING_LOCAL_VALIDATION`；整体仍为 `NO_GO_PENDING_LOCAL_VALIDATION`。

本次没有执行 npm、Vitest、D1、R2、Wrangler、OpenSpec CLI、OpenSpec Verify、浏览器或飞书生产应用联调，因此以下数量是静态源码预期，不是运行验收结果。

## 2. Historical Baseline

Pre-Wave 13 formal main 的静态正式路由总数为 108：

- READY：39；
- READY_WITH_LIMITATIONS：17；
- Staff/Internal Finance NOT_READY：52。

历史 52 个 NOT_READY 路由的共同原因是生产入口没有可信 Staff Session Middleware。底层 File、Staff Order Evidence 和 Staff Buyer Refund Service 还缺少正式 HTTP surface。

## 3. Wave 13 Active Route Additions

| Group | Active additions |
|---|---:|
| Staff Auth | 5 |
| Purpose-bound File Intent | 5 |
| Buyer/Seller/Staff File Lifecycle | 12 |
| Staff Order Evidence | 4 |
| Staff Buyer Refund | 4 |
| Total | 30 |

静态总路由预期：

`108 + 30 = 138`

## 4. Staff Auth Routes

| Method | Path | Authority | Static status |
|---|---|---|---|
| POST | `/api/staff-auth/login/start` | public, Origin/return allowlist, rate limit | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| GET | `/api/staff-auth/feishu/callback` | single-use state, server-side Provider exchange | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| GET | `/api/staff-auth/session` | active internal Staff Session | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| POST | `/api/staff-auth/logout` | current Session | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| POST | `/api/staff-auth/logout-all` | active Session or constrained committed replay | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |

Staff Session 由 Worker 签发，D1 只保存 token hash。Staff API 不信任飞书 Header 或客户端 Actor 字段。

## 5. Logout-All Replay Contract

同 Cookie、同 Idempotency-Key 的 lost-response retry 只在以下条件成立时返回首次 200：

- Session 仍未超过绝对 TTL；
- status=`REVOKED`；
- reason=`LOGOUT_ALL`；
- actor/action/target/request hash/Key 与已 COMMITTED 记录完全匹配。

重放不创建新 Claim、不再次递增 `session_version`、不写新 Audit、不再次 revoke、不创建 `staffAuthorization`。不同 Key、其他 reason、expired/unknown/forged Cookie 返回 401。该 Cookie 访问其他 Staff Route 仍 401。

## 6. Active File Intent Routes

| Method | Path | Fixed Purpose | Fixed Visibility |
|---|---|---|---|
| POST | `/api/buyer-portal/file-uploads/order-evidence/intents` | `ORDER_EVIDENCE` | `BUYER_VISIBLE` |
| POST | `/api/buyer-portal/file-uploads/review-evidence/intents` | `REVIEW_EVIDENCE` | `SELLER_VISIBLE` |
| POST | `/api/seller-portal/file-uploads/product-application-images/intents` | `PRODUCT_APPLICATION_IMAGE` | `SELLER_VISIBLE` |
| POST | `/api/staff/file-uploads/buyer-refund-proofs/intents` | `BUYER_REFUND_PROOF` | `INTERNAL_ONLY` |
| POST | `/api/staff/file-uploads/seller-settlement-proofs/intents` | `SELLER_SETTLEMENT_PROOF` | `INTERNAL_ONLY` |

### Approved Wave 13 scope reduction

`ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 的全局 FilePurpose 常量保留，但 Wave 13 不注册活动 Intent Route，也不放入 `STAFF_UPLOADS`。原因是当前没有冻结的实体消费命令、Link 和 Audience 流程。该能力正式归属 Wave 15 内部 Staff 运营工作台。

不存在通用 File Link/Grant HTTP route。

## 7. File Lifecycle Routes

Buyer、Seller、Staff 各有四个 domain-bound lifecycle endpoint，共 12 个：

- `PUT /api/<domain>/file-uploads/:fileObjectId/content`
- `POST /api/<domain>/file-upload-intents/:id/complete`
- `POST /api/<domain>/files/:fileObjectId/read-intents`
- `GET /api/<domain>/file-read-intents/:id/content`

其中 `<domain>` 分别为 `buyer-portal`、`seller-portal`、`staff`。

规则：

- Actor、Purpose、Visibility、owner 和 Scope 均由 Session/D1 派生；
- multipart 只接受一个 `file` part；
- upload token/read token 一次性且有界；
- complete 要求 expected version、R2 HEAD 和 metadata/digest 校验；
- DTO 不返回 object key、永久 URL 或存储凭据；
- Scope miss 404，Permission miss 403。

## 8. Staff Order Evidence Routes

| Method | Path | Permission / Scope | Static status |
|---|---|---|---|
| GET | `/api/staff/order-evidence` | `ORDER_VIEW` + SQL Buyer/Team/Global Scope | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| GET | `/api/staff/order-evidence/:id` | `ORDER_VIEW` + concealed Scope | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| POST | `/api/staff/order-evidence/:id/request-changes` | `ORDER_CONFIRM` + assigned workflow | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| POST | `/api/staff/order-evidence/:id/approve` | `ORDER_CONFIRM` + assigned workflow + atomic batch | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |

Detail DTO 包含 reference/final/difference、price mismatch 和安全截图引用，不包含 storage authority。

Approve 使用 `PRICE_MISMATCH`：差额时 ack 缺失/false 返回 409；ack=true 但 reason 空返回 400；无差额时无意义 ack/reason 返回 400。

## 9. Staff Buyer Refund Routes

| Method | Path | Permission / Scope | Static status |
|---|---|---|---|
| GET | `/api/staff/buyer-refunds` | `BUYER_REFUND_VIEW` + SQL Scope | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| GET | `/api/staff/buyer-refunds/:id` | view + concealed Scope | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| POST | `/api/staff/buyer-refunds/:id/payments` | `BUYER_REFUND_RECORD` + processing assignment | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| POST | `/api/staff/buyer-refunds/:id/payments/:paymentEntryId/reversals` | record + obligation/payment scope | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |

Payment/Reversal 复用 append-only ledger，CNY 以 decimal-string fen 出 DTO，OVERPAID 不截断，proof 固定 INTERNAL_ONLY，Seller DTO 不暴露 Buyer Refund cost/proof。

## 10. Existing Staff Route Families

默认 App 已把以下现有家族统一放在 Staff Session Middleware 之后：

- Assignment；
- Catalog；
- Review；
- Seller Settlement；
- Settlement Proof；
- Internal Finance；
- Order Instructions；
- Staff File；
- Order Evidence；
- Buyer Refund。

新增真实请求测试源码覆盖前九个关键家族：Fake Provider → login/start → callback → Set-Cookie → Default App → Middleware → representative route。

每个家族包含：

- 有效 Session 的代表性 2xx/201 路径；
- 无 Session 401；
- 缺全局 Permission 403；
- 有 Permission 但超 Scope 404；
- Client/Feishu authority Header bypass 失败。

这些测试源码尚未执行。

## 11. Authentication and Disclosure Rules

- 无有效 Staff Session：401；
- Session 有效但缺操作 Permission：403；
- 有 Permission 但资源超 Assignment/Data Scope：404；
- Buyer/Seller 跨租户：404；
- File token 错误：403；File resource Scope miss：404；已知 intent 过期：410；
- Internal Finance 保持 Active system owner + `FINANCIAL_VIEW`，export 另需 `FINANCIAL_EXPORT`。

## 12. DTO and Storage Safety

远程测试源码递归检查 Default App 实际构造的响应对象，禁止：

- `object_key`、永久 URL、signed URL；
- Session token/hash、state hash；
- Provider token、app/client secret；
- internal owner authority；
- Buyer Refund 成本/proof 出现在 Seller DTO；
- mismatch internal reason 出现在 Buyer DTO。

首次 File Intent 的一次性 upload token 只允许出现在明确的首次 token 字段；Replay 不重新发放。

## 13. Test Source Inventory

已写入但未运行：

- Staff Auth 与 logout-all replay Route/Service tests；
- Default App runtime route-family matrix；
- D1 empty/upgrade/state/session/STRICT/Trigger/FK/Assertion/integrity tests；
- Atomic Approve/Refund Payment/Reversal service-level final-batch rollback tests；
- R2 put/receipt/HEAD/D1 final commit/compensation/delete-pending/cleanup tests；
- five-purpose authorization/visibility matrix；
- recursive runtime DTO verifier；
- static security/architecture/mismatch/refund/migration verifiers。

## 14. Readiness Reclassification

历史 Staff/Internal Finance 52 个已注册路由和 Wave 13 新增 30 个路由，当前都只能依据源码标记：

`IMPLEMENTED_AWAITING_LOCAL_VALIDATION`

不能据此标记 READY 或正式关闭 P1。

Customer-facing 历史 READY/READY_WITH_LIMITATIONS 结论保持历史参考，但当前 Feature 的完整回归尚未运行。

## 15. Remaining Frontend Gates

1. 当前 Feature `npm run check`、Vitest、typecheck、build；
2. 真实 D1 schema 27 migration/behavior；
3. 真实 R2 failure/compensation；
4. 当前 Spec 语义更新后的 OpenSpec strict validation；
5. OpenSpec Verify；
6. Ponytail；
7. 浏览器、飞书生产应用、中国大陆网络；
8. PR、Integration、部署和 main 推进。

## 16. Current Recommendation

# NO_GO_PENDING_LOCAL_VALIDATION

正式前端不得把远程测试源码存在误当成运行通过。只有完整本地门禁、D1/R2、OpenSpec Verify 和总控审查完成后，才能重新判断 readiness。

## 17. LOCAL_REMEDIATION_VALIDATION（2026-08-03）

本地修复后，后端面向前端的运行基线已取得以下证据：

- 完整 `npm run check` 通过：111 files / 571 tests，typecheck 和 build 均通过；Wave 13 定向 12 files / 60 tests 通过；
- 默认 App、递归 DTO 与 logout-all replay 为 3 files / 8 tests 通过；401/403/404、authority header bypass、Session/replay 和敏感字段边界由运行测试覆盖；
- Local D1 空库 0001–0027 与真实 26→27 升级均通过；最终 Schema 27、117 张应用表、221 个 Trigger、10 个 View、FK 0、integrity ok；既有 Staff/Customer 数据保留，Customer Auth 表结构不漂移；
- R2 put/HEAD/final-commit/compensation/delete-pending/retry 仅以仓库 Mock 运行，2 files / 11 tests 通过；本地配置没有真实 R2 binding，生产 R2 未运行；
- OpenSpec 仍为 52 Requirements / 104 Scenarios，目标与全仓 strict validation 分别 1/1、2/2 通过；
- `openspec-verify-change` skill 不可用，`OPENSPEC_VERIFY=NOT_AVAILABLE`；正式 Verify 未执行；
- npm allow-scripts 与 Wrangler 用户日志权限提示均为非致命环境告警。

没有运行浏览器、真实飞书、中国大陆网络、生产 R2、Ponytail、PR、Integration、部署或 main 推进。

## 18. Updated Recommendation

# NO_GO_PENDING_OPENSPEC_VERIFY

后端本地门禁与前端所需 API/DTO 运行基线已通过，可交总控复核；正式 Verify 缺失，因此仍不得标记 READY、关闭 P1、进入 Integration 或部署。

## 19. LOCAL_VERIFY_REMEDIATION（2026-08-03）

本节保留原始 readiness/NO_GO/P1 历史并追加最终后端证据：

- 普通 logout 现在在任何 Cookie/Session 副作用前执行 Origin 防护，拒绝路径保持 Session ACTIVE 且原 Cookie 可继续读取；允许路径正常撤销并清 Cookie。
- Order Evidence List 返回 workflow assignment、Buyer/order 安全摘要、reference/final/difference/mismatch 和服务端 deadline；Detail 独立校验当前 Evidence Version 恰好一个有效 screenshot association。
- Buyer Refund List 支持严格 `from`/`to` 中国业务日期边界并返回完整金额、摘要和 workflow DTO；Payment 必填 `china_business_date`；Staff Detail 返回 Payment/Reversal internal notes，Buyer/Seller DTO 不泄漏。
- 真实 Default App route registry 为 138：历史 108 + Wave 13 的 5 Staff Auth、5 Purpose Intent、12 File Lifecycle、4 Staff Order Evidence、4 Staff Buyer Refund。
- 最终全量门禁为 111 files / 580 tests / 0 failed（7.21s），Wave 13 为 12 files / 69 tests；typecheck、六项 verifier、build、Wrangler dry-run 全部通过。
- Local D1 为 27 migrations、Schema 27、117 application tables、221 triggers、10 views、FK 0、integrity ok；空库与 26→27 均通过，无 migration 修改、无 0028。
- R2 fault/compensation 只由仓库 Mock 验证；生产 R2 未验证。OpenSpec target/all strict 为 1/0、2/0。

## 20. FORMAL_OPENSPEC_VERIFY（2026-08-03）

正式 Verify 将 52 Requirements 分类为 51 `COMPLETE` + 1 `APPROVED_SCOPE_REDUCTION`，将 104 Scenarios 分类为 103 + 1；`INCONSISTENT`、`MISSING`、`PARTIAL`、`NOT_VERIFIED`、CRITICAL 和 WARNING 均为 0。唯一 scope reduction 是内部沟通活动上传 Intent 延期至 Wave 15。

生产 R2、真实飞书应用、中国大陆网络、浏览器和部署保持 `NOT_PRODUCTION_VERIFIED`。Ponytail、PR、Integration、部署、main 推进和 Wave 14 均未运行。

# READY_FOR_CONTROLLER_REVIEW

该建议允许总控复核是否考虑后续 Ponytail，但不表示 GO、P1 CLOSED、Integration allowed 或 Wave 14 allowed。

## 21. BACKEND_READY_FOR_INTEGRATION（2026-08-03）

后端 API/DTO 已达到 Integration 候选状态：

- 138 个业务端点可复现：历史 108 + Wave 13 活动新增 30。
- 最终本地门禁为 111 files / 580 tests / 0 failed；Wave 13 定向为 12 files / 69 tests。
- Local D1 为 27 migrations / schema 27 / 117 application tables / 221 triggers / 10 views / FK 0 / integrity `ok`。
- OpenSpec strict target/all 通过，正式 Verify 为 51 `COMPLETE` + 1 `APPROVED_SCOPE_REDUCTION`。

边界保持明确：Wave 14 仍不能开始；必须先完成 Integration 并由总控决定是否推进 main。浏览器真实流程属于 Wave 14，真实飞书属于 Wave 16，生产 R2、Cloudflare 和中国大陆网络属于 Wave 17。

`FRONTEND_BACKEND_BASELINE=READY_FOR_INTEGRATION`

`WAVE14_ALLOWED=no_until_main`

`PRODUCTION_GO=no`

## 22. INTEGRATION_VALIDATION（2026-08-03）

Backend baseline 在 Integration 分支完成复验：基线为 `origin/main`，Feature 仅以 fast-forward 引入，代码树与 Feature Closure HEAD 完全一致；111 files / 580 tests / 0 failed、Wave 13 12 files / 69 tests / 0 failed、OpenSpec strict target/all 1/1 与 2/2、fresh Local D1 27/117/221/10、FK 0、integrity `ok`。

Integration 只做验证，没有开发新业务行为；未修改源码、Contracts、Migration、测试、Verifier、package-lock 或部署配置。未运行 Ponytail，未推进 main，未部署，未开始 Wave 14。

`WAVE13_INTEGRATION_VALIDATED_PENDING_MAIN`

## 23. OPENSPEC_SYNC_ARCHIVE_REMEDIATION（2026-08-03）

- Integration 先完成、再完成 OpenSpec sync/archive 是治理顺序遗漏；本补正仅在现有 Integration 追加普通治理 Commit，未重写、删除或伪造历史。
- 六份 Delta Spec 已同步至 main specs，52 Requirements / 104 Scenarios 已进入主规格，包含最终 Staff Auth、File、Evidence、Refund Contract、138 Route Inventory 关闭依据及内部沟通 Purpose 延期至 Wave 15 的批准范围缩减。
- Wave 13 Change 已归档，Pre-Wave13 Audit Change 保持 active；归档 Tasks 为 85/2，两个 pending 均为 `SKIPPED_BY_CONTROLLER` 的 Ponytail 主动跳过。
- 完整门禁、Wave 13 测试、strict OpenSpec 与 fresh Local D1 已重新通过；Integration 没有开发新业务行为，main 尚未推进，生产验证项继续开放。

`WAVE13_ARCHIVED_INTEGRATION_VALIDATED_READY_FOR_MAIN`
