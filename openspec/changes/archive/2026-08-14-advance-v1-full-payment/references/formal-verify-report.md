# Formal Verify Report: advance-v1-full-payment

## Verification boundary

- Implementation fixed SHA: `d96d13ef68b88c746145c93074b87c573cb3a9ed`.
- Base SHA: `d84094c0910ac6c31dfd09f979865228c8034f10`.
- Workflow: `spec-driven`.
- Artifacts reviewed: proposal, two delta specs, design and tasks.
- Production, staging, remote Cloudflare resources and historical-data import were
  outside this verification and remained blocked.
- Sync/archive and external review of the final post-archive SHA are subsequent
  governance gates; this report does not claim they have happened.

## Summary

| Dimension | Result |
| --- | --- |
| Completeness | PASS — 8/8 tasks, 5/5 requirements |
| Correctness | PASS — 5/5 requirements and 10/10 scenarios covered |
| Coherence | PASS — implementation follows the authoritative-amount, immutable-ledger and forward-migration design |

## Completeness

The five requirements map to implementation as follows:

1. **One server-authoritative full Payment:**
   `apps/api/src/operating-integrity/routes.ts:124-143` accepts no client amount,
   reads the immutable snapshot, includes the derived amount in idempotency,
   ledger, Audit and response facts, and retains proof authorization.
2. **Full and server-derived Reversal:**
   `apps/api/src/operating-integrity/routes.ts:147-159` accepts only a reason,
   derives the original Payment amount and rejects settled or already-reversed
   records before appending one immutable full Reversal.
3. **Schema 67 refuses incompatible history:**
   `migrations/0067_advance_v1_full_payment.sql:4-58` requires Schema 66 and
   fails on non-snapshot Payments, partial/multiple Reversals or multiple
   outstanding Payments without rewriting ledger rows.
4. **Database write-boundary authority:**
   `migrations/0067_advance_v1_full_payment.sql:60-129` installs snapshot amount,
   single-outstanding-Payment and full-Reversal triggers, retains the 0061 source
   guard and 0066 cumulative guard, then advances exactly 66 to 67.
5. **Current-release recovery evidence:**
   `apps/api/src/operational-readiness/routes.ts`,
   `apps/api/src/production-readiness/recovery-attestation-routes.ts` and the
   current production-backup-recovery spec now require Schema 67 while retaining
   release-bound recovery and `/ready` failure-closed behavior.

## Correctness and scenario coverage

- **Full Payment / legacy amount / two Payments:**
  `apps/api/src/operating-integrity/order-integrity-route.test.ts:26-105` proves
  snapshot authority and rejects legacy Payment and Reversal amount fields before
  idempotency. `apps/api/src/migration-0067-advance-v1-full-payment.test.ts:10-22`
  proves the database accepts the full amount, rejects a different amount and a
  second outstanding Payment.
- **Full correction / partial or repeated Reversal:**
  `apps/api/src/migration-0067-advance-v1-full-payment.test.ts:15-21` rejects a
  partial Reversal, accepts one full Reversal, rejects another, and permits one
  replacement full Payment.
- **Incompatible existing ledger:**
  `apps/api/src/migration-0067-advance-v1-full-payment.test.ts:24-38` proves a
  partial historical Reversal rolls the migration back at Schema 66.
- **Real migration chain:**
  `apps/api/src/migration-0067-advance-v1-full-payment.test.ts:40-73` applies the
  real 0001-0066 chain and exercises the installed full-Reversal guard. Repository
  migration verification separately proves a continuous 0001-0067 chain,
  Schema 67, inventory equality, integrity success and zero foreign-key errors.
- **Protected DTO and read-only Staff controls:**
  `apps/api/src/operating-integrity/advance-principal-lookup-route.ts:24-74`
  projects authoritative amount and active Payment only to owner/buyer_refund;
  `apps/web/src/staff/StaffOperatingIntegrityTools.tsx:21-46` displays the amount
  read-only, submits no amount, offers reason-only full Reversal, hides reversal
  after an obligation exists and refreshes authoritative server state after
  either write. `StaffOperatingIntegrityTools.advance.test.tsx:9-37` covers both
  controls.
- **Cash single-counting:** the Change does not replace Migration 0066 cash-flow
  authority. The full repository suite retains the settlement-mirror exclusion,
  distinct Advance totals and zero net contribution for a full Payment/Reversal
  pair.
- **Recovery stale/current scenarios:** current readiness, recovery-attestation,
  backup/restore, staging-bootstrap and release verifier tests all use Schema 67
  and continue rejecting stale-schema evidence.

## Coherence

- D-043 records the owner-selected V1 rule without changing D-042 or any earlier
  Decision.
- Migration 0067 is forward-only; migrations 0001-0066 and archived OpenSpec
  changes are byte-unchanged.
- Existing 0061 same-Payment/same-order/same-Buyer source integrity and 0066
  cumulative reversal authority are reused, not duplicated or rewritten.
- API prechecks improve conflict responses; database triggers remain the
  serialized financial authority.
- Amounts remain integer CNY fen and JSON decimal strings. Payment, Reversal,
  proof, Audit, idempotency, settlement and cash facts remain immutable.
- Ordinary Buyer Refund, Seller Settlement, Seller Allocation, financial
  formulas, Staff roles and permissions are unchanged.

## Verification commands and results

- Targeted Advance/API/Web/migration suite: PASS.
- Full repository gate before the implementation commit and again after
  sync/archive: 247 files / 1,633 tests PASS; TypeScript,
  dependency/security gates, API Wrangler dry-run, Web build and static-build
  verification PASS. Implementation code, tests and Migration bytes in
  `d96d13ef68b88c746145c93074b87c573cb3a9ed` are unchanged across both gates.
- Migration continuity and guards: 67 migrations, Schema 67, 410 triggers,
  inventory SHA-256
  `969f0a7e930cb9c4ede979fa2e557de3faa5a9f1bfb8b035d4115eeb2651bf65`,
  66 wrong-order commits rejected, 67 repeats rejected and 133 failed snapshots
  unchanged.
- OpenSpec strict validation: 69 passed, 0 failed.
- `git diff --check`: PASS.
- Staging and production Cloudflare dry-runs: expected
  `BLOCKED_NEEDS_OPERATOR_INPUT`; zero external calls, deployments or mutations.

## Issues

- CRITICAL: none.
- WARNING: none.
- SUGGESTION: none.

## Final assessment

All implementation-consistency checks passed. The Change is ready for semantic
spec sync and archive. This report does not authorize deployment, remote resource
mutation, historical-data import or Production GO.
