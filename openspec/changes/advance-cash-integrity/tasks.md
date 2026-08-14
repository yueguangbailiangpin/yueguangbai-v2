# Tasks: Advance Cash Integrity

- [x] 1. Add failing behavior tests for cumulative advance reversal, cash double-counting and future Buyer refund payment time.
- [x] 2. Add forward-only Migration 0066 with the existing-ledger assertion, serialized reversal guard and rebuilt cash movement view.
- [x] 3. Extend the internal-finance cash-flow DTO, read model and CSV export with explicit advance totals.
- [x] 4. Reject future Buyer refund and advance payment timestamps before idempotency acquisition.
- [x] 5. Advance canonical schema/verifier/runbook baselines from 65 to 66 without rewriting historical decisions or migrations.
- [x] 6. Run targeted tests, migration continuity/guard verification, strict OpenSpec validation, `git diff --check` and full `npm run check`.
- [ ] 7. Complete fixed-SHA review and keep production/remote resource operations blocked.
