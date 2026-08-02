# Pre-Wave 13 Frontend API Readiness

## 1. Scope

This inventory is extracted from the real route registrations in `apps/api/src/index.ts` and the corresponding route modules on formal `main` at `f28c52a36e9498c37453a4a12755d9ad8459ae65`.

It is a remote static review. No API was executed in this audit. Readiness means suitability for formal frontend dependence, not merely the existence of a service function.

Readiness values:

- `READY`
- `READY_WITH_LIMITATIONS`
- `NOT_READY`
- `NOT_VERIFIED`

## 2. API Inventory

### Column conventions

- **Auth/Permission/Scope** combines identity domain, required permission, and tenant/data scope.
- **Contract** names the request/response style when a dedicated exported DTO exists; otherwise it records route-local validation.
- **Errors/Page** records error family and pagination behavior.
- **Concurrency** records Idempotency-Key and expected-version behavior.
- **Special fields** records date, money, or file semantics relevant to the frontend.
- **Evidence** is production route source; tests are module route/service tests and the verifier catalog described in the traceability matrix.

## 3. Buyer APIs

| API ID | Method | Path | Auth / Permission / Scope | Request Contract | Response DTO | Errors / Page | Concurrency | Special fields | Frontend purpose | Evidence / Tests | Readiness |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BUY-001 | GET | `/api/buyer-portal/me` | Buyer customer session; own Buyer identity | none | Buyer portal me DTO | shared Buyer portal errors | none | identity/status only | bootstrap Buyer portal | `buyer-portal/routes.ts`; portal tests | READY |
| BUY-002 | GET | `/api/buyer-portal/demands` | active Buyer; published/open demand scope | limit,cursor | demand page DTO | bounded cursor | none | JPY/self-pay/date snapshots | demand list | same; pagination tests | READY |
| BUY-003 | GET | `/api/buyer-portal/demands/:id` | active Buyer; visible demand | route id | demand detail DTO | concealed not-found | none | self-pay bps, deadlines | demand detail | same; read-model tests | READY |
| BUY-004 | POST | `/api/buyer-portal/demands/:id/reservations` | active Buyer; own reservation | exact body: expected_demand_version, accepted_buyer_self_pay_bps | reservation mutation DTO | validation/state/version/idempotency | required; demand version | bps; server time | reserve capacity | same; reservation tests | READY |
| BUY-005 | GET | `/api/buyer-portal/reservations` | active Buyer; own rows | limit,cursor | reservation page | bounded cursor | none | status/deadlines | reservation list | same; pagination tests | READY |
| BUY-006 | GET | `/api/buyer-portal/reservations/:id` | active Buyer; own row | route id | reservation detail | concealed not-found | none | deadlines/version | reservation detail | same | READY |
| BUY-007 | POST | `/api/buyer-portal/reservations/:id/cancel` | active Buyer; own cancellable row | exact expected_version | reservation mutation DTO | version/state/idempotency | required; expected_version | none | cancel reservation | same; cancel tests | READY |
| BUY-008 | GET | `/api/buyer-portal/order-evidence/eligible-reservations` | active Buyer; own approved/instruction-ready rows | limit,cursor | eligible reservation page | bounded cursor | none | deadlines | choose order to submit | `buyer-order-evidence-portal/routes.ts` | READY |
| BUY-009 | POST | `/api/buyer-portal/order-evidence` | active clear-identity Buyer; own reservation | reservation_id, expected_version=0, order number, final_paid_jpy, file_object_ids, note | order-evidence mutation DTO | validation/state/file/order-number/idempotency | required; version 0 | integer JPY; verified image | first order submission | route/domain/tests | READY_WITH_LIMITATIONS |
| BUY-010 | GET | `/api/buyer-portal/order-evidence` | active Buyer; own rows | limit,cursor | evidence page | bounded cursor | none | normalized order number, JPY, file projections | submission list | same | READY |
| BUY-011 | GET | `/api/buyer-portal/order-evidence/:id` | active Buyer; own row | route id | evidence detail | concealed not-found | none | one evidence version/file | submission detail | same | READY |
| BUY-012 | POST | `/api/buyer-portal/order-evidence/:id/resubmit` | active Buyer; own CHANGES_REQUESTED row | expected_version, order number, JPY, files, note | mutation DTO | version/state/file/deadline | required; expected_version | correction deadline | resubmit | same | READY_WITH_LIMITATIONS |
| BUY-013 | POST | `/api/buyer-portal/order-evidence/:id/withdraw` | active Buyer; own withdrawable row | exact expected_version | mutation DTO | version/state/idempotency | required; expected_version | none | withdraw evidence | same | READY |
| BUY-014 | GET | `/api/buyer-portal/reservations/:id/order-instruction` | active Buyer; own approved reservation | route id | instruction detail DTO | not-found/state | none | six-hour/two-hour deadlines; versions | display ordering guide | `order-instructions/routes.ts`; tests | READY |
| BUY-015 | GET | `/api/buyer-portal/reservations/:id/order-instruction/state` | active Buyer; own reservation | route id | instruction state DTO | not-found/state | none | countdown/status | lightweight refresh | same | READY |
| BUY-016 | POST | `/api/buyer-portal/reservations/:id/order-instruction/images/:position/read-intent` | active Buyer; own instruction/audience | route id + main or positive position | short read-intent DTO | file access/version/state | required | expiring token; no object_key/permanent URL | display product/keyword image | same; file tests | READY |
| BUY-017 | GET | `/api/buyer-portal/formal-orders` | active Buyer; own orders | strict filters, limit,cursor | formal-order page | unknown/repeated rejected; bounded cursor | none | JPY, business date, order number | order history | `buyer-formal-orders/routes.ts` | READY |
| BUY-018 | GET | `/api/buyer-portal/formal-orders/:id` | active Buyer; own order | route id | formal-order detail | concealed not-found | none | safe finance snapshot projection | order detail | same; DTO tests | READY |
| BUY-019 | GET | `/api/buyer-portal/refunds` | active Buyer; own refund obligations | strict limit,cursor | refund page | unknown/repeated rejected; bounded cursor | none | precision-safe CNY/public status | refund list | `buyer-refund-status/routes.ts` | READY |
| BUY-020 | GET | `/api/buyer-portal/refunds/:id` | active Buyer; own refund | route id | refund detail | concealed not-found | none | due/net paid/outstanding/overpaid | refund detail | same; DTO tests | READY |
| BUY-021 | GET | `/api/buyer-portal/reviews/eligible-orders` | active Buyer; own eligible formal orders | strict limit,cursor | eligible page | bounded cursor | none | review type/order fields | choose order to review | `buyer-reviews/routes.ts` | READY |
| BUY-022 | POST | `/api/buyer-portal/reviews` | active Buyer; own formal order | strict formal_order_id, version=0, review_type,url,evidence_files,note | review mutation DTO | state/file/version/idempotency | required; version 0 | up to 3 verified files; URL | submit review | same; review tests | READY |
| BUY-023 | GET | `/api/buyer-portal/reviews` | active Buyer; own reviews | strict limit,cursor | review page | bounded cursor | none | safe file/read URL projections | review list | same | READY |
| BUY-024 | GET | `/api/buyer-portal/reviews/:id` | active Buyer; own review | route id | review detail | concealed not-found | none | versions/public reasons | review detail | same | READY |
| BUY-025 | POST | `/api/buyer-portal/reviews/:id/resubmit` | active Buyer; own CHANGES_REQUESTED review | strict expected_version, type,url,files,note | mutation DTO | version/state/file/idempotency | required | evidence versions | resubmit review | same | READY |
| BUY-026 | POST | `/api/buyer-portal/reviews/:id/withdraw` | active Buyer; own withdrawable review | exact expected_version | mutation DTO | version/state/idempotency | required | none | withdraw review | same | READY |
| BUY-027 | POST | `/api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent` | active Buyer; own review/file grant | exact expected_file_version | read-intent DTO | concealed file denial/version | required | expiring token; no object_key | display submitted evidence | same; file auth tests | READY |

**Buyer limitation:** BUY-009/012 HTTP parsing accepts 1–10 file IDs, but the domain requires exactly one. Runtime behavior is safe; the contract should be narrowed before generated-client freeze.

## 4. Seller APIs

| API ID | Method | Path | Auth / Permission / Scope | Request Contract | Response DTO | Errors / Page | Concurrency | Special fields | Frontend purpose | Evidence / Tests | Readiness |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SEL-001 | GET | `/api/seller-portal/me` | Seller customer session; organization membership | none | Seller portal me DTO | Seller portal errors | none | role/org only | bootstrap Seller portal | `seller-portal/routes.ts` | READY |
| SEL-002 | GET | `/api/seller-portal/stores` | Seller organization scope | pagination query | store page | bounded cursor; strictness not uniform | none | none | store list | same | READY_WITH_LIMITATIONS |
| SEL-003 | GET | `/api/seller-portal/products` | Seller organization/store scope | pagination + store_id,status,asin | product page | bounded cursor; extra-query policy not fully uniform | none | versions/status | product list | same | READY_WITH_LIMITATIONS |
| SEL-004 | GET | `/api/seller-portal/products/:id/versions` | scoped product | pagination | version page | bounded cursor | none | immutable versions | product history | same | READY_WITH_LIMITATIONS |
| SEL-005 | GET | `/api/seller-portal/products/:id` | scoped product | route id | product detail | concealed not-found | none | pricing/order-guide safe fields | product detail | same | READY |
| SEL-006 | GET | `/api/seller-portal/product-applications` | Seller organization/store scope | pagination + store_id,status | application page | bounded cursor; strictness limitation | none | status/reason | application list | same | READY_WITH_LIMITATIONS |
| SEL-007 | GET | `/api/seller-portal/product-applications/:id` | scoped application | route id | application detail | concealed not-found | none | public review outcome | application detail | same | READY |
| SEL-008 | POST | `/api/seller-portal/product-applications` | Seller write role; scoped store | route-local body; unknown-key rejection not explicit | application + replayed | validation/state/idempotency | required | no internal_notes authority | submit product | same; command tests | READY_WITH_LIMITATIONS |
| SEL-009 | POST | `/api/seller-portal/product-applications/:id/withdraw` | Seller write role; scoped application | expected_version selected from body | application + replayed | version/state/idempotency | required | none | withdraw application | same | READY_WITH_LIMITATIONS |
| SEL-010 | GET | `/api/seller-portal/demand-batches` | Seller organization/store scope | pagination + store_id,status | demand page | bounded cursor; strictness limitation | none | dates/self-pay public fields | demand list | same | READY_WITH_LIMITATIONS |
| SEL-011 | GET | `/api/seller-portal/demand-batches/:id` | scoped demand | route id | demand detail | concealed not-found | none | quantity/deadlines/status | demand detail | same | READY |
| SEL-012 | POST | `/api/seller-portal/demand-batches` | Seller write role; scoped product | route-local body; unknown-key rejection not explicit | demand + replayed | validation/state/idempotency | required | epoch deadlines; integer quantity | submit demand | same | READY_WITH_LIMITATIONS |
| SEL-013 | POST | `/api/seller-portal/demand-batches/:id/withdraw` | Seller write role; scoped demand | expected_version selected from body | demand + replayed | version/state/idempotency | required | none | withdraw demand | same | READY_WITH_LIMITATIONS |
| SEL-014 | GET | `/api/seller-portal/formal-orders` | Seller organization/store scope | pagination + order filters | formal-order page | bounded cursor; unknown/repeated policy not explicit | none | business date, order number; safe finance projection | formal order list | `seller-formal-orders/routes.ts` | READY_WITH_LIMITATIONS |
| SEL-015 | GET | `/api/seller-portal/formal-orders/:id` | scoped order | route id | formal-order detail | concealed not-found | none | no Buyer Refund/internal profit | order detail | same; DTO verifier | READY |
| SEL-016 | GET | `/api/seller-portal/reviews` | Seller organization/store scope | pagination + review filters | review page | bounded cursor; strictness limitation | none | status/type/order fields | review list | `seller-reviews/routes.ts` | READY_WITH_LIMITATIONS |
| SEL-017 | GET | `/api/seller-portal/reviews/:id` | scoped review | route id | review detail | concealed not-found | none | public review/evidence projection | review detail | same | READY |
| SEL-018 | POST | `/api/seller-portal/reviews/:id/files/:fileLinkId/read-intent` | scoped review and current audience grant | exact expected_file_version | short read-intent DTO | file denials concealed as 404 | required | expiring token; no file_object_id in public DTO | view review evidence | same; file tests | READY |
| SEL-019 | GET | `/api/seller-portal/settlement/summary` | Seller organization scope | none | settlement summary | concealed scope/not-found | none | decimal-string fen; no Buyer Refund cost/profit | settlement dashboard | `seller-settlements/seller-routes.ts` | READY |
| SEL-020 | GET | `/api/seller-portal/settlement/payables` | Seller organization scope | pagination | payable page | bounded cursor; query strictness limitation | none | decimal-string fen | payable list | same | READY_WITH_LIMITATIONS |
| SEL-021 | GET | `/api/seller-portal/settlement/payables/:id` | scoped payable | route id | payable detail | concealed scope/not-found | none | due/paid/outstanding fen | payable detail | same | READY |
| SEL-022 | GET | `/api/seller-portal/settlement/payments` | Seller organization scope | pagination | payment page | bounded cursor; query strictness limitation | none | payment/unallocated fen | payment list | same | READY_WITH_LIMITATIONS |
| SEL-023 | GET | `/api/seller-portal/settlement/payments/:id` | scoped payment | route id | payment detail | concealed scope/not-found | none | allocations/reversals safe projection | payment detail | same | READY |

Seller DTO privacy is strong. The main limitations are request/query exactness and route-family consistency, not tenant isolation.

## 5. Staff APIs

All registered Staff routes below are currently `NOT_READY` because the production app never populates trusted `staffAuthorization`. Their internal permission/scope/state-machine implementation may be strong, but they are not reachable by a real formal Staff frontend.

### Assignment and Work Queue

| API ID | Method | Path | Permission / Scope | Contract / Concurrency | Frontend purpose | Evidence | Readiness |
|---|---|---|---|---|---|---|---|
| STF-001 | GET | `/api/staff/assignment-fallbacks/:marketplaceCode` | assignment management scope | route id | view marketplace fallback | `staff-assignment/routes.ts` | NOT_READY |
| STF-002 | PUT | `/api/staff/assignment-fallbacks/:marketplaceCode` | fallback configure permission | idempotency + expected_version | configure fallback | same | NOT_READY |
| STF-003 | GET | `/api/staff/me/assignments` | own Staff context | none | my fixed assignments | same | NOT_READY |
| STF-004 | GET | `/api/staff/me/work-items` | effective permissions/data scope | status + bounded limit | work queue | same | NOT_READY |
| STF-005 | GET | `/api/staff/me/work-items/:id` | visible scoped item | route id | work detail | same | NOT_READY |
| STF-006 | PATCH | `/api/staff/me/availability` | own or managed Staff | idempotency + expected_version | availability | same | NOT_READY |
| STF-007 | POST | `/api/staff/assignments/reassign` | reassignment permission/scope | idempotency + expected_assignment_version | fixed assignment transfer | same | NOT_READY |
| STF-008 | POST | `/api/staff/work-items/:id/reassign` | work-item reassignment scope | idempotency + expected_version | reassign task | same | NOT_READY |
| STF-009 | POST | `/api/staff/reassignment-batches` | batch-transfer permission | idempotency | create transfer batch | same | NOT_READY |
| STF-010 | POST | `/api/staff/reassignment-batches/:id/run` | batch-transfer permission | idempotency + expected_version + bounded limit | run chunk | same | NOT_READY |
| STF-011 | GET | `/api/staff/reassignment-batches/:id` | ASSIGNMENT_BATCH_TRANSFER | route id | batch status | same | NOT_READY |

### Catalog and Demand Review

| API ID | Method | Path | Permission / Scope | Contract / Concurrency | Frontend purpose | Evidence | Readiness |
|---|---|---|---|---|---|---|---|
| STF-012 | POST | `/api/staff/product-applications/:id/review` | PRODUCT_REVIEW + data scope | strict allowed keys; idempotency + expected_version | approve/reject product application | `staff-catalog-routes.ts` | NOT_READY |
| STF-013 | POST | `/api/staff/catalog/products` | PRODUCT_REVIEW + data scope | strict body; idempotency | create approved product | same | NOT_READY |
| STF-014 | POST | `/api/staff/catalog/products/:id/versions` | PRODUCT_REVIEW + data scope | strict body; idempotency + expected_version | add product version | same | NOT_READY |
| STF-015 | POST | `/api/staff/demand-batches/:id/review` | demand review permission/scope | strict body; idempotency + expected_version | approve/reject demand | same | NOT_READY |

### Review Decisions

| API ID | Method | Path | Permission / Scope | Contract / Concurrency | Frontend purpose | Evidence | Readiness |
|---|---|---|---|---|---|---|---|
| STF-016 | GET | `/api/staff/reviews/:id` | REVIEW_VIEW + assignment/data scope | route id | review work detail | `reviews/staff-routes.ts` | NOT_READY |
| STF-017 | GET | `/api/staff/reviews/:id/evidence-versions` | REVIEW_VIEW + scope | route id | review evidence history | same | NOT_READY |
| STF-018 | POST | `/api/staff/reviews/:id/request-changes` | REVIEW_DECIDE + assigned workflow | strict body; idempotency + expected_version | request changes | same | NOT_READY |
| STF-019 | POST | `/api/staff/reviews/:id/reject` | REVIEW_DECIDE + assigned workflow | strict body; idempotency + expected_version | reject review | same | NOT_READY |
| STF-020 | POST | `/api/staff/reviews/:id/approve` | REVIEW_DECIDE + assigned workflow | strict body; idempotency + expected_version | approve review/service fee | same | NOT_READY |

### Seller Settlement Operations

| API ID | Method | Path | Permission / Scope | Contract / Concurrency | Frontend purpose | Evidence | Readiness |
|---|---|---|---|---|---|---|---|
| STF-021 | GET | `/api/staff/seller-settlements/:organizationId/summary` | SELLER_SETTLEMENT_VIEW + org/data scope | route id | settlement summary | `seller-settlements/staff-routes.ts` | NOT_READY |
| STF-022 | GET | `/api/staff/seller-settlements/:organizationId/payables` | view + scope | bounded cursor | payable list | same | NOT_READY |
| STF-023 | GET | `/api/staff/seller-settlements/:organizationId/payables/:payableId` | view + scope | route ids | payable detail | same | NOT_READY |
| STF-024 | GET | `/api/staff/seller-settlements/:organizationId/payments` | view + scope | bounded cursor | payment list | same | NOT_READY |
| STF-025 | GET | `/api/staff/seller-settlements/:organizationId/payments/:paymentId` | view + scope | route ids | payment detail | same | NOT_READY |
| STF-026 | POST | `/api/staff/seller-settlements/:organizationId/payments` | SELLER_SETTLEMENT_RECORD + scope | exact body; idempotency; decimal-string fen; verified proof file | record payment | same | NOT_READY |
| STF-027 | PATCH | `/api/staff/seller-payments/:paymentId/paid-at` | record/correct permission | exact body; idempotency + expected_version | correct paid time | same | NOT_READY |
| STF-028 | POST | `/api/staff/seller-payments/:paymentId/allocations` | record permission | exact body; idempotency + expected_payment_version | allocate payment | same | NOT_READY |
| STF-029 | POST | `/api/staff/seller-allocations/:allocationId/reverse` | record/correct permission | exact body; idempotency + expected_payment_version | reverse allocation | same | NOT_READY |
| STF-030 | POST | `/api/staff/seller-allocations/:allocationId/reallocate` | record/correct permission | exact body; idempotency + expected_payment_version | reallocate | same | NOT_READY |
| STF-031 | POST | `/api/staff/seller-payments/:paymentId/reverse` | record/correct permission | exact body; idempotency + expected_version | reverse payment | same | NOT_READY |
| STF-032 | POST | `/api/staff/seller-settlements/:organizationId/reconciliation` | settlement management | bounded body; idempotency | reconcile payables | same | NOT_READY |
| STF-033 | GET | `/api/staff/seller-settlements/:organizationId/reconciliation/conflicts` | view + scope | after/limit | conflict list | same | NOT_READY |
| STF-034 | POST | `/api/staff/seller-payments/:paymentId/proof/read-intent` | view + current org scope + dynamic file auth | exact expected_file_version; idempotency | view payment proof | `staff-proof-routes.ts` | NOT_READY |

### Order Instructions

| API ID | Method | Path | Permission / Scope | Contract / Concurrency | Frontend purpose | Evidence | Readiness |
|---|---|---|---|---|---|---|---|
| STF-035 | GET | `/api/staff/order-instructions/:id` | ORDER_INSTRUCTION_VIEW + Buyer data scope | route id | instruction detail | `order-instructions/routes.ts` | NOT_READY |
| STF-036 | GET | `/api/staff/order-instructions/:id/versions` | view + scope | route id | version history | same | NOT_READY |
| STF-037 | POST | `/api/staff/order-instructions/:id/assets/prepare` | publish/manage + scope | idempotency + expected_version | generate image assets | same | NOT_READY |
| STF-038 | GET | `/api/staff/order-instructions/:id/assets/:batchId` | view + scope | route ids | asset batch status | same | NOT_READY |
| STF-039 | POST | `/api/staff/order-instructions/:id/publish` | publish + scope | idempotency + expected_version | publish instruction | same | NOT_READY |
| STF-040 | POST | `/api/staff/order-instructions/:id/cancel` | manage + scope | idempotency + expected_version | cancel instruction | same | NOT_READY |
| STF-041 | POST | `/api/staff/order-instructions/expiry-scan/run` | ORDER_INSTRUCTION_EXPIRY_RUN | idempotency + bounded limit | run expiry scan | same | NOT_READY |
| STF-042 | GET | `/api/staff/order-instructions/expiry-scan/state` | expiry/view permission | none | scan cursor/status | same | NOT_READY |
| STF-043 | POST | `/api/staff/order-instructions/assets/reconciliation/run` | manage permission | idempotency + bounded limit | clean/repair asset orphans | same | NOT_READY |
| STF-044 | POST | `/api/staff/order-instructions/reconciliation/run` | ORDER_INSTRUCTION_MANAGE | idempotency + cursor/limit | repair missing aggregates/tasks | same | NOT_READY |
| STF-045 | POST | `/api/staff/order-evidence/:id/internal-communication-files` | Staff order/file scope | idempotency; slot + verified file | attach internal communication file | same | NOT_READY |

## 6. Internal Finance APIs

All are strongly implemented internally but `NOT_READY` for a formal frontend until trusted Staff session creation exists.

| API ID | Method | Path | Permission / Scope | Contract / Page | Special rules | Evidence | Readiness |
|---|---|---|---|---|---|---|---|
| FINAPI-001 | GET | `/api/staff/finance/summary` | active system owner + FINANCIAL_VIEW | exact filters | order date basis; decimal-string money | `internal-finance/routes.ts` | NOT_READY |
| FINAPI-002 | GET | `/api/staff/finance/orders` | same | exact filters + bounded cursor | no OFFSET; conflict classifications | same | NOT_READY |
| FINAPI-003 | GET | `/api/staff/finance/orders/:formalOrderId` | same | no query; route id | detailed fact provenance | same | NOT_READY |
| FINAPI-004 | GET | `/api/staff/finance/groups` | same | exact filters + group_by | bounded group output | same | NOT_READY |
| FINAPI-005 | GET | `/api/staff/finance/cash-flow` | same | exact cash filters | CASH date basis | same | NOT_READY |
| FINAPI-006 | GET | `/api/staff/finance/exceptions` | same | exact filters + bounded cursor | missing/conflicting facts | same | NOT_READY |
| FINAPI-007 | POST | `/api/staff/finance/exports/csv` | system owner + FINANCIAL_VIEW + FINANCIAL_EXPORT | exact export_type,filters,date_basis | 50k/25MiB; BOM/CRLF/RFC4180; SHA-256; audit/outbox; ephemeral | same; export tests/verifiers | NOT_READY |

## 7. File APIs

### Registered dedicated read-intent endpoints

- BUY-016 — order-instruction images.
- BUY-027 — Buyer review evidence.
- SEL-018 — Seller review evidence.
- STF-034 — Staff seller-payment proof.

These routes correctly use short-lived tokens and dynamic authorization.

### Missing registered upload surface — P1 blocker

`apps/api/src/files/**` contains production services for:

- creating upload intents;
- uploading file objects;
- completing/HEAD-verifying intents;
- creating entity links;
- creating audience grants;
- compensation and cleanup.

However, `apps/api/src/index.ts` registers no generic or domain-specific HTTP route that lets a Buyer, Seller, or Staff frontend create and complete an upload intent. There is no `registerFileRoutes` in the production entrypoint, and `apps/api/src/files/routes.ts` does not exist.

Impact:

- BUY-009/012 cannot obtain order-evidence file IDs through the formal API.
- BUY-022/025 cannot obtain review evidence file IDs through the formal API.
- STF-026 cannot obtain a payment-proof file ID through the formal API.
- STF-045 cannot obtain an internal communication file ID through the formal API.

The file service layer is strong, but the frontend capability is `NOT_READY` because the HTTP contract is absent.

## 8. Authentication APIs

| API ID | Method | Path | Auth / Contract | Response | Limitation | Evidence | Readiness |
|---|---|---|---|---|---|---|---|
| AUT-001 | POST | `/api/buyer-auth/register` | public + origin guard; strict body/size; rate limit; optional human verification | Buyer identity + session established | feature/config dependent | `buyer-self-registration/routes.ts`; contract path | READY |
| AUT-002 | POST | `/api/customer-auth/login` | public + origin guard; account_type, login, password | trusted customer session cookie | unknown body keys are not rejected | `http-auth/routes.ts` | READY_WITH_LIMITATIONS |
| AUT-003 | POST | `/api/customer-auth/change-password` | customer session + origin guard | updated session/account state | unknown body keys are not rejected | same | READY_WITH_LIMITATIONS |
| AUT-004 | POST | `/api/customer-auth/logout` | customer session + origin guard | session cleared | none material | same | READY |
| AUT-005 | GET | `/api/customer-auth/session` | customer session | session/account DTO | none material | same | READY |

### Missing Staff authentication surface — P1 blocker

There is no registered Staff login, session, logout, exchange, or trusted middleware route. `resolveStaffAuthorizationByFeishu` is a database resolver, not an HTTP session boundary. All `/api/staff/**` routes therefore lack a production mechanism to receive `staffAuthorization`.

## 9. Shared Contract Rules

- Mutations generally require `Idempotency-Key` and domain request hashes.
- Mutations generally require `expected_version` or an equivalent expected aggregate version.
- Buyer/Seller authority IDs are derived from sessions and scoped DB rows.
- JPY is integer; CNY fen is precision-safe decimal string where exposed.
- Business dates use `YYYY-MM-DD`; timestamps use epoch milliseconds.
- File access uses short-lived read intents; object keys and permanent URLs remain server-side.
- Exact-key validation is strong in newer Buyer/Staff/Finance modules but inconsistent in customer auth and some Seller/Staff modules.

## 10. Pagination

Confirmed patterns:

- bounded limits;
- opaque cursors;
- keyset/cursor reads in Buyer formal orders/refunds/reviews, Seller portals, settlement, and Internal Finance;
- stable empty page envelopes in the inspected modules.

Limitation: a complete SQL-level audit of every read model was not executed locally. Seller and older Staff route families also do not uniformly reject unknown/repeated query parameters.

## 11. Errors

Strengths:

- stable shared envelope with request ID;
- explicit validation, state, version, idempotency, and dependency errors;
- customer routes frequently conceal cross-tenant resources as not-found;
- finance export has explicit `EXPORT_TOO_LARGE`.

Limitations:

- Staff review missing authorization maps to `FORBIDDEN` rather than a uniform unauthenticated code.
- equivalent scope denials vary between 403 and concealed 404 by route family.
- module-specific public messages and aliases require a frontend mapping table before a shared error layer is frozen.

## 12. Date and Money Serialization

- UTC operational timestamps: epoch milliseconds.
- Business dates: validated `YYYY-MM-DD`, with finance views using the formal China business-date offset where specified.
- JPY: safe integer.
- CNY: integer fen internally and decimal strings in precision-sensitive JSON/CSV paths.
- Frontend code must not coerce CNY fen strings to JavaScript Number.

## 13. DTO Privacy

- Buyer DTOs exclude Staff internals and internal profit.
- Seller DTOs exclude Buyer Refund cost, internal profit, and other Seller data.
- Internal Finance DTOs are separate owner-only projections.
- File read DTOs omit object storage keys; some internal file object IDs are returned only where required for a Staff follow-up action.
- DTO isolation has dedicated historical verifiers, pending local rerun.

## 14. Missing Frontend Capabilities

### P1

1. Staff login/session/logout or trusted session-exchange middleware.
2. File upload-intent/create-upload/complete/link HTTP APIs.
3. Staff order-evidence read/list/request-changes/verify HTTP APIs. The services `read-order-evidence.ts` and `review-order-evidence.ts` exist, but no routes are registered.
4. Staff Buyer Refund ledger/read/record-payment/reverse-payment HTTP APIs. The service functions exist under `apps/api/src/buyer-refunds/**`, but no routes are registered.

### P2 / freeze limitations

5. Uniform exact-key validation.
6. Uniform unknown/repeated query rejection.
7. Approved 404/403 disclosure matrix by auth domain.
8. Narrow the order-evidence file list contract to exactly one.
9. Confirm whether Staff formal-order operational read/list actions are expected to use work-item source data or need dedicated routes.

## 15. Contract Freeze Candidates

### Freeze candidates after local validation

- Customer session envelope and Buyer self-registration.
- Buyer demand/reservation read and mutation contracts.
- Buyer order-instruction reads and image read intents.
- Buyer formal-order, refund-status, and review read contracts.
- Seller stores/products/applications/demands/formal-orders/reviews/settlement read DTOs.
- Money/date serialization rules.
- File short-read-intent response shape.
- Internal Finance formula names and money semantics, but not frontend reachability.

### Do not freeze yet

- Staff identity/session contract.
- Staff route authentication behavior.
- File upload HTTP contract.
- Staff order-evidence workflow contract.
- Staff Buyer Refund operational contract.
- shared exact-key/query/error/disclosure conventions.
- full Staff/Internal Finance route set as a frontend SDK.

## 16. READY Summary

**39 registered endpoints** are READY:

- health: 1;
- authentication: 3;
- Buyer: 25;
- Seller: 10.

These counts describe route readiness only. They do not include missing capabilities.

## 17. READY_WITH_LIMITATIONS Summary

**17 registered endpoints** are READY_WITH_LIMITATIONS:

- authentication: 2;
- Buyer: 2;
- Seller: 13.

Primary limitations are exact-key/query strictness and the order-evidence file-cardinality contract mismatch.

## 18. NOT_READY Summary

**52 registered endpoints** are NOT_READY:

- Staff operational APIs: 45;
- Internal Finance APIs: 7.

All are blocked by the absent trusted Staff session boundary. Missing file-upload, Staff order-evidence, and Staff Buyer Refund capabilities are additional NOT_READY capabilities and are not included in the 52 registered-route count.

## 19. NOT_VERIFIED Summary

**0 registered endpoints** are classified NOT_VERIFIED. Source was sufficient to classify every registered route. Runtime behavior still requires local validation and may change readiness if a discrepancy is found.

## 20. Local Validation Requests

1. Run the real production app entrypoint with customer sessions and all route suites.
2. After resolving Staff identity authority, add trusted Staff middleware and run end-to-end Staff route tests.
3. Add and test the missing file upload HTTP surface against the real object-storage adapter.
4. Add and test Staff order-evidence request-changes/verify routes.
5. Add and test Staff Buyer Refund payment/reversal routes.
6. Re-run all pagination/cursor malformed-input and large-dataset tests.
7. Re-run DTO isolation, finance formulas, export safety, migration, and security verifiers.
8. Validate real D1 strict tables, triggers, transaction assertions, and rollback behavior.
9. Run strict OpenSpec validation and real OpenSpec verify.
10. Run authorized Wrangler validation before Integration.

## Overall API Recommendation

# NOT READY FOR BIG MODULE 5

Customer-facing route families are leading freeze candidates. The full formal frontend is blocked by missing Staff authentication and multiple missing HTTP capability surfaces despite the presence of underlying domain services.
