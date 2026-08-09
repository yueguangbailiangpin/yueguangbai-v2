# Tasks: Seller Formal-Order Chat Screenshot Access

## 0. Baseline and Migration

- [x] 0.1 Re-verify `origin/main`, current migration/schema, existing file purpose policy, formal-order relation, explicit audience reader and Seller Store scope.
- [x] 0.2 Record `NO_SCHEMA_CHANGE`; prove the current tables and constraints cover one screenshot per formal order without importing or rewriting data.

## 1. Contracts and File Boundary

- [x] 1.1 Add the Seller-safe chat screenshot status/read-intent/attach contracts while retaining the existing purpose literal.
- [x] 1.2 Activate only the fixed Staff upload-intent route with `SELLER_VISIBLE`; keep object keys, URLs, owner and audience authority out of HTTP DTOs.
- [x] 1.3 Remove the obsolete internal-only/deferred route and make the formal-order attach command the only association entry.

## 2. API and Authorization

- [x] 2.1 Implement idempotent, expected-version, Staff-permission/Data-Scope checked attachment with audit, Outbox and final assertions.
- [x] 2.2 Add Seller order status projection and formal-order-specific read-intent creation using the existing single-use file service.
- [x] 2.3 Enforce organization and active Store scope dynamically in both explicit Audience authorization and the Seller business query.

## 3. Seller Web

- [x] 3.1 Add runtime schemas, API adapters and identity-separated query keys for chat status/read intent.
- [x] 3.2 Add lazy collapsed/expanded `聊天截图` rendering to `订单与业务完成`, including no-image and safe failure states.
- [x] 3.3 Keep the existing completion, settlement, order and financial fields unchanged; do not model or display arrival images.

## 4. Tests and Verification

- [x] 4.1 Test same-organization Seller access, cross-organization denial, cross-Store denial and dynamic membership/Store-scope revocation.
- [x] 4.2 Test Staff Personal DENY/Data Scope, purpose/visibility/owner/version checks, duplicate attachment and idempotent replay/conflict.
- [x] 4.3 Test single-use read intent, expiry, wrong actor, replay, revoked link/audience, no object key/permanent URL and missing-image projection.
- [x] 4.4 Test Seller list lazy loading, cache identity separation, runtime schema and MSW/JSDOM image expansion.
- [x] 4.5 Run focused tests, typecheck/build, migration/route/security verifiers, full local gates and strict OpenSpec; report every skip/failure honestly.

## 5. Rollback

- [x] 5.1 Verify code-only rollback leaves existing immutable file/order/audience/audit/idempotency facts intact and records zero remote writes/resource touches.
