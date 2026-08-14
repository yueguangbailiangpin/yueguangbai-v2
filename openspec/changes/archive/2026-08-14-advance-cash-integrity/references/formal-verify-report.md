# Formal Verify Report: advance-cash-integrity

## Verification boundary

- Implementation fixed SHA: `3c19a9499ee91b36852a228b74060f0d14954576`.
- Base SHA: `1d40c945c7246cebae6b1612e6f864db020b388f`.
- Workflow: `spec-driven`.
- Artifacts reviewed: proposal, delta spec, design, and tasks.
- Production and remote Cloudflare operations were outside this verification
  and remained blocked.

## Summary

| Dimension | Result |
| --- | --- |
| Completeness | PASS — 7/7 tasks, 3/3 requirements |
| Correctness | PASS — 3/3 requirements and 5/5 scenarios covered |
| Coherence | PASS — implementation follows all three design boundaries |

## Completeness

All seven implementation and governance tasks are checked. The fixed-SHA
implementation review completed without an unresolved P0, P1, or P2 finding;
the later archive evidence pointer is recorded separately in
`post-review-completion-addendum.md`.

The three requirements map to implementation as follows:

1. **Bound cumulative Advance reversals:**
   `migrations/0066_advance_cash_integrity.sql:9-42` rejects an already corrupt
   ledger and installs the serialized `BEFORE INSERT` aggregate guard.
2. **Report each real Buyer cash movement once:**
   `migrations/0066_advance_cash_integrity.sql:44-100` excludes Advance
   settlement mirrors and adds Advance payment/reversal movements;
   `apps/api/src/internal-finance/read-model.ts:316-359` aggregates them with
   `BigInt`; `packages/contracts/src/internal-finance.ts:193-203` and
   `apps/api/src/internal-finance/exports.ts:340-350` publish the separate
   totals.
3. **Reject future manual payment occurrence:**
   `apps/api/src/buyer-refunds/record-buyer-refund-payment.ts:81-99` and
   `apps/api/src/operating-integrity/routes.ts:124-130` reject a future
   `paid_at` before idempotency acquisition.

## Correctness and scenario coverage

- **Two stale reversal decisions:**
  `apps/api/src/migration-0066-advance-cash-integrity.test.ts:154-193` applies
  the real 0001-0065 chain, starts from payment 100 plus reversal 40, rejects
  61, accepts 60, rejects a later 1, and ends at Schema 66 with total reversal
  100.
- **Existing ledger already over-reversed:**
  `apps/api/src/migration-0066-advance-cash-integrity.test.ts:127-152` proves
  Migration 0066 fails and leaves the schema at 65.
- **Advance later settles a refund obligation:**
  `apps/api/src/migration-0066-advance-cash-integrity.test.ts:63-124` proves the
  Advance payment is present once, the settlement payment and its reversal are
  excluded, and an ordinary refund payment remains visible.
- **Advance payment partially reversed:**
  the same test reports Advance outflow 100, Advance reversal 40, ordinary
  refund outflow 30, Seller inflow 200, and net cash flow 110.
- **Future payment time:**
  `apps/api/src/buyer-refunds/buyer-refund-ledger.test.ts:415-434` proves a
  future Buyer refund payment creates no idempotency record;
  `apps/api/src/operating-integrity/order-integrity-route.test.ts:19-50`
  proves the same boundary for Advance payment and no batch write.

## Coherence

- The migration is forward-only and does not modify migrations 0001-0065.
- The database trigger is authoritative while the route precheck remains as a
  user-facing early conflict check.
- Cash reporting follows immutable occurrence time, separates normal refund
  and Advance totals, and excludes only accounting mirrors.
- Both manual-payment commands compare against one command-time `now` before
  claiming idempotency.
- Names, locations, immutable-ledger handling, integer-money contracts, and
  `BigInt` aggregation match established repository patterns.

## Verification commands and results

- Migration 0066 targeted suite: 3/3 PASS.
- Full repository gate on the implementation SHA: 245 files / 1,625 tests
  PASS; TypeScript, builds, Wrangler dry-run, Node safety, migration continuity
  and migration guards PASS.
- GitHub CI run `31767182571`: `static-governance` SUCCESS and
  `tests-and-build` SUCCESS.
- OpenSpec strict validation after sync/archive: 68 passed, 0 failed.
- `git diff --check`: PASS.

## Issues

- CRITICAL: none.
- WARNING: none.
- SUGGESTION: none.

## Final assessment

All implementation checks passed and the change was ready for spec sync and
archive. This report does not authorize deployment or any production resource
operation.
