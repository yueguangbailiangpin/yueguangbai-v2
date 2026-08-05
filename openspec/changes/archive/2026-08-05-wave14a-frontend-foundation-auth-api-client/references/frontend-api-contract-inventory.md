# Frontend API and Contract Inventory

## Authority and Envelope

The verified baseline count remains 138 unique registered `GET`/`POST`/`PUT`/`PATCH`/`DELETE` endpoints: 137 under `/api/*` plus one `/health`. The formal frontend inventory does not invent routes to preserve a subgroup count. Formal Staff frontend capability comprises 70 Staff-addressed endpoints: five Staff Auth endpoints and 65 protected Staff endpoints. Staff Order Evidence itself has exactly four formal routes. No `/api/v2/*` alias is a formal frontend route.

After the Controller removes the non-formal internal-communication entry, the explicit frontend-consumable route lines below total 136 unique `/api/*` routes. No guessed replacement is added. The repository-wide 138/137/1 baseline remains the independently verified aggregate; this reference is the formal frontend-consumption inventory, not permission to restore the excluded capability.

Success is `{ data, meta: { request_id } }`. Failure is `{ error: { code, message, details }, meta: { request_id } }`. The frontend must parse both envelopes and treat every payload as untrusted until Zod validation succeeds. `Retry-After` is currently emitted for bounded rate-limit paths and must be parsed from the header. Money contracts mix exact decimal strings and bounded integer JPY according to each DTO; the client must not coerce these generically.

## Auth Contracts

- Customer Auth: `POST /api/customer-auth/login`, `POST /api/customer-auth/change-password`, `POST /api/customer-auth/logout`, `GET /api/customer-auth/session`.
- Buyer self-registration: `POST /api/buyer-auth/register`.
- Customer Session uses one HttpOnly `__Host-ygb_customer_session` Cookie and returns `account_type: BUYER | SELLER_MEMBER`. Buyer and Seller retain separate UI/cache namespaces but share `CUSTOMER_TRANSPORT_INVALIDATION_GROUP`: Customer login, mismatch, logout, or validated Customer 401 cancels and clears both Customer roots without changing Staff.
- Staff Auth: `POST /api/staff-auth/login/start`, `GET /api/staff-auth/feishu/callback`, `GET /api/staff-auth/session`, `POST /api/staff-auth/logout`, `POST /api/staff-auth/logout-all`.
- Staff Session uses a distinct HttpOnly `__Host-ygb_staff_session` Cookie. `login/start` returns an allowlisted Feishu authorization URL; callback consumes single-use state and establishes the Worker Session.

## Buyer Routes (38)

```text
POST /api/buyer-auth/register
GET  /api/buyer-portal/me
GET  /api/buyer-portal/demands
GET  /api/buyer-portal/demands/:id
POST /api/buyer-portal/demands/:id/reservations
GET  /api/buyer-portal/reservations
GET  /api/buyer-portal/reservations/:id
POST /api/buyer-portal/reservations/:id/cancel
GET  /api/buyer-portal/reservations/:id/order-instruction
GET  /api/buyer-portal/reservations/:id/order-instruction/state
POST /api/buyer-portal/reservations/:id/order-instruction/images/:position/read-intent
GET  /api/buyer-portal/order-evidence/eligible-reservations
POST /api/buyer-portal/order-evidence
GET  /api/buyer-portal/order-evidence
GET  /api/buyer-portal/order-evidence/:id
POST /api/buyer-portal/order-evidence/:id/resubmit
POST /api/buyer-portal/order-evidence/:id/withdraw
GET  /api/buyer-portal/formal-orders
GET  /api/buyer-portal/formal-orders/:id
GET  /api/buyer-portal/refunds
GET  /api/buyer-portal/refunds/:id
GET  /api/buyer-portal/reviews/eligible-orders
POST /api/buyer-portal/reviews
GET  /api/buyer-portal/reviews
GET  /api/buyer-portal/reviews/:id
POST /api/buyer-portal/reviews/:id/resubmit
POST /api/buyer-portal/reviews/:id/withdraw
POST /api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent
POST /api/buyer-portal/file-uploads/order-evidence/intents
POST /api/buyer-portal/file-uploads/review-evidence/intents
PUT  /api/buyer-portal/file-uploads/:fileObjectId/content
POST /api/buyer-portal/file-upload-intents/:id/complete
POST /api/buyer-portal/files/:fileObjectId/read-intents
GET  /api/buyer-portal/file-read-intents/:id/content
POST /api/customer-auth/login
POST /api/customer-auth/change-password
POST /api/customer-auth/logout
GET  /api/customer-auth/session
```

The four Customer Auth routes are shared with Seller and counted once in the global total.

## Seller Routes (27 plus shared Customer Auth)

```text
GET  /api/seller-portal/me
GET  /api/seller-portal/stores
GET  /api/seller-portal/products
GET  /api/seller-portal/products/:id
GET  /api/seller-portal/products/:id/versions
GET  /api/seller-portal/product-applications
GET  /api/seller-portal/product-applications/:id
POST /api/seller-portal/product-applications
POST /api/seller-portal/product-applications/:id/withdraw
GET  /api/seller-portal/demand-batches
GET  /api/seller-portal/demand-batches/:id
POST /api/seller-portal/demand-batches
POST /api/seller-portal/demand-batches/:id/withdraw
GET  /api/seller-portal/formal-orders
GET  /api/seller-portal/formal-orders/:id
GET  /api/seller-portal/reviews
GET  /api/seller-portal/reviews/:id
POST /api/seller-portal/reviews/:id/files/:fileLinkId/read-intent
GET  /api/seller-portal/settlement/summary
GET  /api/seller-portal/settlement/payables
GET  /api/seller-portal/settlement/payables/:id
GET  /api/seller-portal/settlement/payments
GET  /api/seller-portal/settlement/payments/:id
POST /api/seller-portal/file-uploads/product-application-images/intents
PUT  /api/seller-portal/file-uploads/:fileObjectId/content
POST /api/seller-portal/file-upload-intents/:id/complete
POST /api/seller-portal/files/:fileObjectId/read-intents
GET  /api/seller-portal/file-read-intents/:id/content
```

## Formal Staff Frontend Routes (70: 5 Staff Auth + 65 protected Staff)

```text
POST /api/staff-auth/login/start
GET  /api/staff-auth/feishu/callback
GET  /api/staff-auth/session
POST /api/staff-auth/logout
POST /api/staff-auth/logout-all
GET  /api/staff/assignment-fallbacks/:marketplaceCode
PUT  /api/staff/assignment-fallbacks/:marketplaceCode
GET  /api/staff/me/assignments
GET  /api/staff/me/work-items
GET  /api/staff/me/work-items/:id
PATCH /api/staff/me/availability
POST /api/staff/assignments/reassign
POST /api/staff/work-items/:id/reassign
POST /api/staff/reassignment-batches
POST /api/staff/reassignment-batches/:id/run
GET  /api/staff/reassignment-batches/:id
POST /api/staff/catalog/products
POST /api/staff/catalog/products/:id/versions
POST /api/staff/product-applications/:id/review
POST /api/staff/demand-batches/:id/review
GET  /api/staff/reviews/:id
GET  /api/staff/reviews/:id/evidence-versions
POST /api/staff/reviews/:id/request-changes
POST /api/staff/reviews/:id/reject
POST /api/staff/reviews/:id/approve
GET  /api/staff/order-evidence
GET  /api/staff/order-evidence/:id
POST /api/staff/order-evidence/:id/request-changes
POST /api/staff/order-evidence/:id/approve
GET  /api/staff/order-instructions/:id
GET  /api/staff/order-instructions/:id/versions
POST /api/staff/order-instructions/:id/publish
GET  /api/staff/order-instructions/:id/assets/:batchId
POST /api/staff/order-instructions/:id/assets/prepare
POST /api/staff/order-instructions/:id/cancel
GET  /api/staff/order-instructions/expiry-scan/state
POST /api/staff/order-instructions/expiry-scan/run
POST /api/staff/order-instructions/assets/reconciliation/run
POST /api/staff/order-instructions/reconciliation/run
GET  /api/staff/buyer-refunds
GET  /api/staff/buyer-refunds/:id
POST /api/staff/buyer-refunds/:id/payments
POST /api/staff/buyer-refunds/:id/payments/:paymentEntryId/reversals
GET  /api/staff/seller-settlements/:organizationId/summary
GET  /api/staff/seller-settlements/:organizationId/payables
GET  /api/staff/seller-settlements/:organizationId/payables/:payableId
GET  /api/staff/seller-settlements/:organizationId/payments
GET  /api/staff/seller-settlements/:organizationId/payments/:paymentId
POST /api/staff/seller-settlements/:organizationId/payments
POST /api/staff/seller-settlements/:organizationId/reconciliation
GET  /api/staff/seller-settlements/:organizationId/reconciliation/conflicts
PATCH /api/staff/seller-payments/:paymentId/paid-at
POST /api/staff/seller-payments/:paymentId/allocations
POST /api/staff/seller-payments/:paymentId/reverse
POST /api/staff/seller-payments/:paymentId/proof/read-intent
POST /api/staff/seller-allocations/:allocationId/reverse
POST /api/staff/seller-allocations/:allocationId/reallocate
GET  /api/staff/finance/summary
GET  /api/staff/finance/orders
GET  /api/staff/finance/orders/:formalOrderId
GET  /api/staff/finance/groups
GET  /api/staff/finance/cash-flow
GET  /api/staff/finance/exceptions
POST /api/staff/finance/exports/csv
POST /api/staff/file-uploads/buyer-refund-proofs/intents
POST /api/staff/file-uploads/seller-settlement-proofs/intents
PUT  /api/staff/file-uploads/:fileObjectId/content
POST /api/staff/file-upload-intents/:id/complete
POST /api/staff/files/:fileObjectId/read-intents
GET  /api/staff/file-read-intents/:id/content
```

## File Contract Boundary

Five active purpose routes are fixed: Buyer order evidence, Buyer review evidence, Seller product application image, Staff buyer refund proof, and Staff seller settlement proof. Each identity domain also has upload, complete, create-read-intent, and consume-read endpoints. Multipart accepts exactly one `file` part. Intent and access tokens are one-time and memory-only at the frontend. The client receives safe File IDs/versions/digests, never `object_key` or a permanent URL. Entity Link and Audience Grant creation remains inside approved business commands; no generic client route exists. `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` remains a historical global Purpose only: Wave 14A has no upload intent or active Staff consume/Link/Grant HTTP capability, and the complete workflow is deferred to Wave 15.

## Error and Authority Boundary

Published codes include validation/auth/not-found, version/idempotency/request-in-progress/state/price conflicts, rate limits, dependency failures, and file-specific failures including `FILE_COMPENSATION_REQUIRED`. The client must preserve exact HTTP status, code, `request_id`, safe details, and `Retry-After`. A Customer 401 invalidates Buyer and Seller together; a Staff 401 invalidates only Staff. 403 is permission denial and 404 is concealed missing/out-of-scope; neither changes Session. 409 is explicit conflict, 422 is file/semantic validation, and 503 requires code-specific user action rather than unbounded retry.

Roles, permissions, staff/customer IDs, organization IDs, assignments, scopes, and file ownership are server-derived authority. Frontend values are display and routing hints only.
