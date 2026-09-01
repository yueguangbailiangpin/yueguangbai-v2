# Verification Report: staging-isolated-readiness-bootstrap

Verified on 2026-08-13 after Draft PR publication. The original snapshot below is preserved as historical local evidence and is superseded by the 2026-08-15 post-review addendum. Neither snapshot claims remote staging acceptance, Formal Verify, archive readiness or Production GO.

## Summary

| Dimension | Status |
| --- | --- |
| Completeness | 7/9 tasks complete; 6/6 requirements mapped |
| Correctness | 6/6 requirements and 12/12 scenarios mapped to implementation, existing formal lifecycle, tests or explicitly deferred remote acceptance |
| Coherence | Design followed; no Migration, Secret, production resource or remote write in the implementation scope |

## Requirement and scenario evidence

- Resource isolation and fail-closed inputs: `scripts/bootstrap-staging-first-owner.mjs:19-52`, `scripts/bootstrap-staging-first-owner.mjs:134-150`, `scripts/preflight-cloudflare-release.mjs:129-230`, `scripts/bootstrap-staging-first-owner.test.mjs:12-72`.
- Truthful staging readiness without production weakening: `apps/api/src/operational-readiness/routes.ts:28-68`, `apps/api/src/operational-readiness/routes.test.ts:45-85`.
- Atomic, idempotent and redacted first Owner: `apps/api/src/staging-bootstrap/first-owner.ts:48-167`, `apps/api/src/staging-bootstrap/first-owner.ts:170-300`, `apps/api/src/staging-bootstrap/first-owner.test.ts:24-144`.
- Parameterized provider adapter and sanitized failure boundary: `scripts/cloudflare-d1-rest-database.mjs:1-98`, `scripts/cloudflare-d1-rest-database.test.mjs:1-52`.
- Staging Cron/observability configuration: `apps/api/wrangler.staging.template.jsonc:1-56`, `scripts/preflight-cloudflare-release.test.mjs:67-76`.
- Formal Staff and Customer identity lifecycle plus backup/restore and fixed-SHA acceptance remain operator-run stages documented in `docs/runbooks/ISOLATED_STAGING_ACCEPTANCE.md`; they are not simulated or marked complete by local tests.

## Validation evidence

- `npm run test:staging-governance`: PASS, 5 files and 34 tests.
- API typecheck: PASS.
- `npm run db:verify`: PASS, migrations 0001-0065 and Schema 65.
- Migration guards: PASS, 65 migrations including wrong-order and repeat guards.
- OpenSpec target strict: PASS.
- OpenSpec all strict: PASS, 67/67.
- `npm run check`: PASS, 242 test files and 1601 tests plus build, Wrangler dry-run, security, Node safety and governance gates.
- `git diff --check`: PASS.

## CRITICAL before remote staging or archive

1. Task 8 is incomplete: obtain an independent fixed-SHA review of the Draft PR. No remote staging resource write is authorized before that review passes.
2. Task 9 is incomplete: remote resource creation, migrations, first Owner, formal identities, deployment, network checks, backup/restore and continuous monitoring have not been executed.

## Warnings

- `npm run check` and CLI strict validation are local evidence, not Formal Verify and not remote acceptance.
- A shared Cloudflare account provides resource separation only; it does not provide account-level trust isolation.

## Final assessment

Local implementation is coherent and ready for fixed-SHA independent review. Two critical workflow tasks remain before archive. `READY_FOR_REMOTE_STAGING_WRITES=NO`, `READY_FOR_ARCHIVE=NO`, `PRODUCTION_GO=NO`.

## 2026-08-15 post-review remediation addendum

The first fixed-SHA review found two P1 issues: an empty `file_objects` table
allowed `/ready` to report object storage healthy without calling R2, and the
first-owner transaction inferred an empty staging database from Staff authority
plus `buyer_channels` alone. Both findings were fixed before any remote staging
write.

- Empty-bucket readiness now performs a real read-only `head` probe and fails
  closed when the R2 binding rejects it. Existing verified-object receipt checks
  remain unchanged.
- First-owner bootstrap now asserts zero business stock across 29 explicit
  acquisition, Audit/Outbox, Buyer/Customer, file, order, product, review,
  Seller and finance entry tables in the same atomic batch as the Owner write.
  Independent Customer, Seller, Product and Order dirty-stock fixtures each
  prove failure before any Staff fact is created.
- `npm run test:staging-governance`: PASS, 5 files / 45 tests.
- API typecheck: PASS.
- `npm run db:verify`: PASS, migrations `0001`-`0070`, Schema 70, 212 tables,
  604 indexes, 401 triggers, 12 views, integrity `ok`, zero FK errors.
- Migration guards: PASS, 70 migrations, 69 wrong-order and 70 repeat cases,
  139 failed snapshots unchanged.
- OpenSpec all strict: PASS, 71/71; `git diff --check`: PASS.

The original 2026-08-13 full-check counts remain historical and are not reused
as current-SHA evidence. A new fixed SHA review and GitHub CI are still required
before remote staging writes. `READY_FOR_REMOTE_STAGING_WRITES=NO`,
`READY_FOR_ARCHIVE=NO`, `PRODUCTION_GO=NO`.
