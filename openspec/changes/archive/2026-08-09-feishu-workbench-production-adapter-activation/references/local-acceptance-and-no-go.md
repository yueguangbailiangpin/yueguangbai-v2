# Local Acceptance and Production NO-GO Evidence

## Migration

- Decision: `NO_SCHEMA_CHANGE`.
- 0033 already owns immutable work-item mirrors and callback receipts.
- 0034 already owns Feishu dead-letter categories.
- Existing `feishu_staff_identities` already maps configured tenant plus open_id to Staff.
- Tenant tokens remain memory-only and are not business facts.

## Local evidence allowed by this Change

- Anonymous Task v2 token/create/update request and strict response tests.
- Fake-time token cache, early expiry, concurrent refresh and 401 refresh tests.
- Fake 429/Retry-After, 5xx/unavailable, timeout, response bound and redacted error tests.
- Encrypted URL challenge/card callback, official X-Lark signature, replay and D1 authorization tests.
- Local D1 Outbox/mirror/dead-letter and runtime fail-closed tests.
- A local D1 scheduler proof that the exact Feishu-only combination records only `feishu_sync`, produces zero acquisition maintenance runs and never reads the acquisition identity Secret.
- Disabled staging/production templates and Secret-name-only zero-network preflight.

None of these are real Feishu acceptance.

## Production NO-GO blockers

- No real application, tenant, bot, user, permission or managed Secret was inspected or created.
- No real callback URL was registered or challenged.
- No Provider API, Cloudflare, production D1/R2, domain, DNS or deployment was called.
- No real rate/permission/mobile/network-carrier behavior was measured.
- No owner activation or rollback approval exists in this Change.

Conclusion: `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`.

Final local gate evidence:

- `npm run check`: PASS; 200 Vitest files and 1305 tests passed, all workspace type checks/builds passed.
- strict OpenSpec: 49 passed, 0 failed.
- Chromium: 180 passed, 1 pre-existing skipped, 0 failed.
- Feishu module: 21 tests passed; activation preflight: 6 tests passed.
- Security scan: 1421 project files passed; dependency vulnerabilities: 0.
- Migration: 37 sequential migrations, schema 37, integrity `ok`, foreign-key errors 0.
- Ponytail read-only review: no dependency or speculative abstraction was added; security-boundary validation was retained.

## Rollback contract

1. Disable sync.
2. Disable callback.
3. Keep `ACQUISITION_MAINTENANCE_ENABLED=false` and verify it before any Feishu activation or rollback.
4. Disable only `feishu_sync` scheduling if further isolation is required.
5. Preserve business facts, mirrors, receipts, Outbox and dead letters.
6. Provider credential rotation/revocation and callback removal require a separate externally approved operation.
