# Formal Verify Report: Customer Security DENY And Password Rate Limit

## Verification identity

- Change: `customer-security-deny-password-rate-limit`
- Fixed implementation SHA: `5f34d09987c4de8dc38a0b2c9e0539d41069fd7d`
- Base SHA: `b0c0d8918231c5ef1c027e80fae9e5f49797d0e2`
- Verification mode: repository-local, no production/staging deployment or remote D1/R2/provider write

## Summary

| Dimension | Status |
|---|---|
| Completeness | 7/7 implementation tasks complete; task 8 is the governance closeout performed after this report |
| Correctness | 6/6 requirements and 11/11 scenarios covered |
| Coherence | Design followed; existing effective-permission, rate-limit, immutable-event and forward-migration patterns reused |

## Completeness

### Customer-security Staff commands honor final Personal DENY

- Login-identifier change now requires ACTIVE owner plus effective `BUYER_IDENTITY_HIGH_RISK_MANAGE`: `apps/api/src/customer-onboarding/login-identifier-change-routes.ts:54`.
- Seller invitation issue/current/read/revoke gates execute before route-specific D1 reads and require `(owner | seller_ops) + SELLER_MANAGE`: `apps/api/src/seller-registration/routes.ts:24-66`, `apps/api/src/seller-registration/routes.ts:127-135`.
- Exported Seller invitation services repeat the permission boundary for direct-call safety: `apps/api/src/seller-registration/service.ts:393`, `apps/api/src/seller-registration/staff-read.ts:12-23`.
- Denied-route tests use a database object that throws on any property access, proving all four Seller operations and login-identifier change return 403 before D1 access: `apps/api/src/customer-security/personal-deny-routes.test.ts:10-60`.

### Authenticated password change has an independent abuse boundary

- The fixed-window store is keyed by operation and keyed hashes for account/network/device; thresholds are bounded and old rows are pruned: `apps/api/src/customer-security/rate-limit.ts:5-89`.
- The password-change route consumes `PASSWORD_CHANGE` with server-derived Session account ID before calling `changeCustomerPassword`, therefore before current-password verification and command idempotency acquisition: `apps/api/src/http-auth/routes.ts:161-220`.
- A blocked request appends only the sanitized event projection and returns 429 with retry seconds: `apps/api/src/http-auth/routes.ts:194-207`, `apps/api/src/http-auth/security-events.ts:3-12`.
- Behavior coverage proves eight allowed failed guesses, the ninth blocked attempt, unchanged credential/session/idempotency facts, three hashed dimensions, no raw account/network/device values and a sanitized blocked event: `apps/api/src/http-auth/http-auth.test.ts:417-531`.
- Login uses a separate table and invitation/reset/password-change rows use distinct `operation` keys, so one operation cannot consume another operation's counter.

### Schema 68 and recovery authority

- Migration 0068 requires Schema 67, rebuilds only the two CHECK-constrained tables, copies all rows, asserts equal counts, restores indexes/immutability triggers and advances with `changes()=1`: `migrations/0068_customer_security_deny_password_rate_limit.sql:1-132`.
- Full `0001`-`0067` upgrade tests prove existing counters/events survive, the new operation/scope/event are accepted, invalid scope is rejected, immutability remains active and repeat application leaves Schema 68 unchanged: `apps/api/src/migration-0068-customer-security.test.ts:17-110`.
- Runtime readiness, recovery attestation, backup/restore, staging bootstrap, release verifiers and current runbooks target Schema 68. Historical migrations 0001-0067 and archived Change evidence were not modified.

## Correctness and scenario coverage

| Requirement / scenarios | Evidence | Result |
|---|---|---|
| Final Personal DENY for high-risk identifier change | permission gate + throwing-DB 403 test | PASS |
| Final Personal DENY for Seller invitation issue/read/revoke | route and service gates + all-operation throwing-DB test | PASS |
| Repeated current-password guesses | fixed-window limiter + 8/9 boundary test | PASS |
| Operation-isolated counters | operation is part of primary key/query; login remains in its dedicated table | PASS |
| Invitation/recovery abuse and replay remains intact | existing customer-security suite plus unchanged idempotency services | PASS |
| Current-schema backup/recovery/readiness | Schema 68 anchors, backup/restore tests and production-readiness verifiers | PASS |

No CRITICAL, WARNING or SUGGESTION issue was found for the Change scope.

## Executed verification

- `npm run check`: PASS at fixed implementation SHA.
  - OpenSpec all strict: 69/69.
  - Secrets scan: PASS, 1629 project files.
  - Dependency audit: 0 high/critical vulnerabilities.
  - Node safety: 9/9.
  - Full Vitest: 249 files / 1640 tests.
  - API Wrangler dry-run, workspace typechecks/builds and Web static build: PASS.
- `npm run db:verify`: PASS; 68 migrations, Schema 68, 1248 schema objects, inventory SHA-256 `0192d1534733c26654cd883ba361428e11a044c4a6380d36b6112962214edea8`, integrity `ok`, foreign-key errors 0.
- `npm run verify:migration-guards`: PASS; 67 wrong-order and 68 repeat cases rejected with 135 unchanged failure snapshots.
- `npm run check:customer-security`: PASS; 14 files / 92 tests.
- `node scripts/verify-production-cloudflare-web-r2-release-configuration.mjs`: PASS; production retains explicit Cron requirement while staging truthfully does not require a production Cron.
- `npx openspec validate customer-security-deny-password-rate-limit --strict`: PASS.
- `npx openspec validate --all --strict`: PASS, 69/69.
- `git diff --check`: PASS.

## Final assessment

All implementation checks passed at the fixed SHA. The Change is ready for the remaining governance closeout: mark task 8 complete, sync delta specs, archive, create the governance commit, re-lock the final PR head and obtain independent fixed-final-SHA review before Ready/merge. This report does not claim remote staging acceptance or Production GO.
