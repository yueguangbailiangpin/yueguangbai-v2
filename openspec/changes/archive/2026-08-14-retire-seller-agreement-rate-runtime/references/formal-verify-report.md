# Formal Verify Report: Retire Seller Agreement Rate Runtime

## Verification identity

- Change: `retire-seller-agreement-rate-runtime`
- Fixed implementation SHA: `094b62a779629fe710cb6edbcc0260fb85fed712`
- Base SHA: `93b9c482b47768343fd414ecd0f9f12f432796df`
- Verification mode: repository-local; no production/staging deployment, remote D1/R2 access, secret mutation, provider call, or business-data read/write

## Summary

| Dimension | Status |
|---|---|
| Completeness | PASS — 20/20 implementation and pre-Formal-Verify tasks complete; this report completes task 7.2, while sync/archive and Draft-PR handoff remain subsequent governance tasks |
| Correctness | PASS — 8/8 requirements and 17/17 scenarios covered |
| Coherence | PASS — the owner-confirmed `migration-0069-design.md` inventory, zero-stock boundary, DROP COLUMN rebuild order, and single-authority design were followed |

## Completeness

### One formal-order confirmation authority

- `approveOrderEvidenceAtomically` is the sole Staff formal-order confirmation authority. It resolves Seller Principal Rate Policy unconditionally before mutation and explicitly inserts the financial snapshot, principal-policy snapshot, and generic marketplace-money snapshot in dependency order.
- The duplicate formal-order confirmation service, test-only marketplace snapshot locker, legacy Seller Agreement Rate pricing modules/exports, and compatibility flag are removed.
- Final transaction assertions require all three snapshots and exact Seller-principal equality. Missing or mismatched rate/policy facts fail without partial formal-order, payable, Audit, Outbox, workflow, or successful-idempotency facts.
- The migrated permission, idempotency, concurrency, immutability, payable, review, refund, archive, and rollback suites exercise the canonical authority rather than preserving a second test authority.

### Migration 0069 empty-stock retirement

- `migrations/0069_retire_seller_agreement_rate_runtime.sql` requires healthy Schema 68 and checks the full owner-confirmed zero-stock boundary before its first DDL statement.
- It removes the three legacy agreement-rate tables, five explicit indexes, eleven table/sync triggers, the legacy financial-to-generic sync trigger, and all eleven retired snapshot columns/FKs.
- SQLite `ALTER TABLE ... DROP COLUMN` performs the two internal retained-table rebuilds in the confirmed FK-lineage-first order. Preserved FK-owning tables, triggers, indexes, and views retain exact `sqlite_schema.sql` text; only the two source guards are intentionally replaced.
- Replacement guards use Buyer daily rate, Seller service fee, and the sole `seller_principal_rate_snapshots` authority. The migration advances 68 to 69 with a guarded update and `changes()=1`.

### Contracts, Seller read model, UI, and governance

- Shared Contracts and Seller API/UI no longer project Seller Agreement Rate fields or fallback behavior. Amazon Seller results require the locked Seller Principal Rate Policy snapshot; platform-only rows remain explicitly non-financial.
- Buyer/Seller organization and store scope, concealed cross-organization reads, pagination, file authorization, Staff permissions, Personal DENY, Audit, Outbox, and idempotency boundaries are unchanged.
- Runtime readiness, recovery attestation, staging bootstrap, release preflights, active release documents, migration inventory, and final-production-go verifiers target Schema 69 while still requiring immutable Migration 0068.
- D-045 was appended. Migrations 0001-0068, historical Decisions, archived Changes, and dated freeze/evidence documents remain unchanged.

## Required Migration 0069 test matrix

`apps/api/src/migration-0069-retire-seller-agreement-rate.test.ts` covers every owner-required class:

| Required class | Executed proof | Result |
|---|---|---|
| Fresh `0001 -> 0069` | Schema 69, integrity `ok`, FK errors 0 | PASS |
| Sequential Schema 68 -> 0069 | exact retirement inventory, integrity `ok`, FK errors 0 | PASS |
| Wrong order from Schema 67 | rejection plus complete schema/data snapshot equality | PASS |
| Repeat on Schema 69 | rejection plus complete schema/data snapshot equality | PASS |
| Dirty legacy definition/event/projection | non-empty legacy chain rejected; Schema 68, integrity, FK state, and complete snapshot unchanged | PASS |
| Dirty legacy immutable residue | Audit, Outbox, and idempotency are each seeded and asserted independently; every case rejects with complete snapshot unchanged | PASS |
| Dirty complete Schema 68 formal chain | order, financial, generic, principal, payable, and event facts are proven healthy, then rejected with complete snapshot unchanged | PASS |
| Preserved objects | exact pre/post SQL equality for all confirmed preserved FK-owning tables, triggers, indexes, and views; direct child FKs retained | PASS |
| Replacement guards | exact canonical insert succeeds; mismatched Buyer rate, fee, principal snapshot, amount, date, currency, or timestamp rejects with zero partial facts | PASS |

Historical immutability is additionally covered by repository migration verification: migrations 0001-0068 remain unchanged, the chain is continuous, and all wrong-order/repeat failure snapshots are unchanged.

## Requirement and scenario coverage

| Capability | Requirements | Scenarios | Result |
|---|---:|---:|---|
| Marketplace money foundation | 2 | 7 | PASS |
| Production backup and recovery | 3 | 5 | PASS |
| Seller complete business loop | 3 | 5 | PASS |
| Total | 8 | 17 | PASS |

- Principal authority completeness, missing configuration, and attempted parallel authority are covered by canonical approval behavior and retirement verification.
- Seller override, shared JPY rate, currency-pair default, and post-completion rule-change scenarios are covered by policy resolution and immutable snapshot tests.
- Current-schema restore, stale schema, release-bound recovery, stale scheduler, and wrong-release recovery remain covered by Schema 69 readiness/recovery tests and static verifiers.
- Seller principal-policy read-only behavior, mutation rejection, USD display, legacy JP display, and platform-only non-financial display are covered by Contract/API/UI/MSW tests.

## Executed verification

- `npm run check`: PASS at fixed implementation SHA.
  - OpenSpec strict: 69/69.
  - Secret scan: PASS, 1637 project files.
  - Dependency audit: 0 high/critical vulnerabilities.
  - Node safety: 9/9; final-production-go verifier tests: 23/23.
  - Full Vitest: 249/249 files, 1647/1647 tests.
  - API Wrangler local dry-run, all workspace typechecks/builds, Web production build, and Web static-build verification: PASS.
- Focused Migration/API/Seller suite: 3/3 files, 51/51 tests PASS.
- `npm run db:verify`: PASS; 69 migrations, Schema 69, 211 tables, 601 indexes, 398 triggers, 12 views, 1222 objects, inventory SHA-256 `0132366ecb08eb8f91680e51d135ac2b238b9b6b737c0dc13f32fac12dc43a0f`, integrity `ok`, FK errors 0.
- `npm run verify:migration-guards`: PASS; 68 wrong-order commits and 69 repeats rejected, 137 failed snapshots unchanged, no partial schema or data.
- `npm run verify:seller-agreement-rate-retirement`: PASS; 559 runtime files scanned, zero legacy runtime markers, zero compatibility flags, canonical authority `order-evidence/approve-order-evidence.ts`.
- Production-readiness and Cloudflare release configuration verifiers: PASS locally. Staging and production preflights remain `BLOCKED_NEEDS_OPERATOR_INPUT`; external calls, deployments, and resource mutations are 0. Production GO remains `NO_GO`.
- `git diff --check`: PASS.

## Browser evidence boundary

The in-scope Seller formal-order visual matrix passed 1/1. The broader `seller-visual-refresh.spec.ts` file passed 4/6: two unrelated existing shell/permission-copy assertions failed because the expected member `张三` and no-permission copy were absent. Those failures do not exercise Migration 0069, the retired rate projection, or the Seller formal-order money display. They are recorded here rather than misreported as a 6/6 browser pass; DTO/UI/MSW behavior in this Change is covered by the passing full Vitest suite and the in-scope visual matrix.

## Issues

- CRITICAL: none in Change scope.
- WARNING: none in Change scope.
- SUGGESTION: none in Change scope.
- Non-blocking unrelated browser evidence: the two exact broader-file failures described above.

## Final assessment

The fixed implementation SHA satisfies the confirmed migration design and all Change requirements/scenarios. It is ready for spec sync, archive, post-archive validation, and a separate governance completion commit, followed by a Draft PR and independent fixed-final-SHA review. This report does not authorize or claim production/staging deployment, remote resource acceptance, historical-data import, or Production GO.
