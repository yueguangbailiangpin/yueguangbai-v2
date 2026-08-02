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
