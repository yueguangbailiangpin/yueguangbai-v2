# Design: seller-owner-operations-write-authorization

## 1. Authoritative policy location

`packages/domain/src/seller-authorization.ts` is the single role-semantics
source. It depends only on the canonical `SellerMemberRole` contract and
publishes:

- `sellerMemberCapabilities(role)` and `sellerMemberCan(role, capability)`;
- `canWriteSellerOperations`;
- `canCreateSellerStore`;
- `canWriteSellerSettlementAccount`;
- `canManageSellerMembers`;
- `canReadSellerSettlementFinancials`.

The role-to-capability table is frozen and unknown runtime values return an
empty capability set. The policy does not decide whether a session is valid,
whether a member is active, which organization/store is in scope, or whether a
command is legal in its current state.

## 2. Call-site migration

| Existing call site | Shared policy decision | Preserved boundary |
| --- | --- | --- |
| Seller actor `/me` projection and `requireSellerPortalWriteRole` | `canWriteSellerOperations` | active session/membership and Seller `403` handling |
| `resolveSellerMemberStoreAccess` | `canWriteSellerOperations` for the existing `canManageProducts` projection | organization-wide active-store read scope |
| Product-application command guard | `canWriteSellerOperations` | `canManageProducts`, idempotency, expected version, files, audit, state |
| Demand-batch command guard | `canWriteSellerOperations` | `canManageProducts`, schedule/state/idempotency/version/audit |
| Seller file route authority | `canWriteSellerOperations` | re-resolved actor and existing upload-purpose map; file lifecycle checks |
| Seller store command | `canCreateSellerStore` | actor organization match, marketplace scope, idempotency and catalog checks |
| Settlement-account route | `canWriteSellerSettlementAccount` | input validation and organization update behavior |
| Seller member route `ownerActor` | `canManageSellerMembers` | invitation validation, event writes, expected-version revoke behavior |
| Seller settlement financial reads | `canReadSellerSettlementFinancials` | existing concealed `404` on summary/payables/payable |

No Staff authorization helper is imported into this policy. Staff assignment
and permission checks remain in their existing modules, avoiding a domain/API
cycle and preventing same-spelled but differently scoped roles from being
combined.

## 3. Endpoint classification

The following Seller portal commands are classified as organization writes and
are covered by the matrix or an explicit exception:

- `PATCH /api/seller-portal/me/settlement-account`;
- `POST /api/seller-portal/stores`;
- `POST /api/seller-portal/product-applications` and `.../:id/withdraw`;
- `POST /api/seller-portal/demand-batches` and `.../:id/withdraw`;
- `POST /api/seller-portal/file-uploads/product-application-images/intents`;
- `PUT /api/seller-portal/file-uploads/:fileObjectId/content`;
- `POST /api/seller-portal/file-upload-intents/:id/complete`;
- member invitation issue and revoke routes.

POST routes that create file read intents, the public member-registration
route, and read-only settlement-batch GET routes are not organization-write
authorization decisions and remain untouched.

The fixed `OWNER` checks used while creating or activating the primary Seller
member are onboarding/data-integrity invariants and remain in their existing
customer-auth/customer-master-data commands. The organization-level file-read
link special case that requires `OWNER` also remains a read authorization rule.

## 4. Behavior preservation

- Product application, demand-batch, store, and settlement-account tests retain
  their current status codes and response assertions.
- Existing replay tests remain responsible for idempotency behavior; stale
  expected-version tests remain responsible for `409 VERSION_CONFLICT`.
- Existing cross-organization product/file tests retain concealed `404` and
  no data leakage assertions.
- Unauthenticated requests remain `401 UNAUTHENTICATED`; an active login
  account with no active Seller membership remains `401 SESSION_INVALID`.
- Existing Origin Guard and password-change-required protections execute before
  or around the same command handlers as before.

## 5. Rejected alternatives

- Do not replace every Seller role check with `OWNER`/`OPERATIONS`: store
  creation and settlement-account update have explicit broader rules, member
  management is Owner-only, and financial reads have a separate Owner/Finance
  rule.
- Do not reuse Staff `owner`/`seller_ops` permissions: they describe staff
  assignments and are not Seller organization-member roles.
- Do not add a database capability table or migration: the four roles are a
  closed contract and the requested change is an in-process behavior-equivalent
  refactor.
- Do not add a financial gate to payment list/detail in this Change: the
  current route behavior and contract evidence do not establish a safe
  write-scope equivalence for that read-side question.
