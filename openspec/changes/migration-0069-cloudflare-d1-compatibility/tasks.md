# Tasks: Migration 0069 Cloudflare D1 Compatibility

## 1. Controlled source amendment

- [x] 1.1 Lock the independent branch to reviewed `origin/main` and preserve all other worktrees.
- [x] 1.2 Record the owner-authorized `0069`-only exception and remote safety boundary.
- [x] 1.3 Remove unsupported whole-database checks while retaining every bounded failure-closed guard.
- [x] 1.4 Add migration-source compatibility tests, repository verification and the current staging runbook boundary.

## 2. Local verification

- [x] 2.1 Run Migration `0069` targeted tests including every dirty-stock category independently.
- [x] 2.2 Run migration continuity, wrong-order, repeat, integrity, FK and schema inventory gates through `0070`.
- [x] 2.3 Run OpenSpec target/all strict, typecheck, full repository check and diff hygiene.
- [ ] 2.4 Complete Formal Verify and record exact current-SHA evidence.

## 3. Disposable D1 canary

- [ ] 3.1 Create one uniquely named staging-only D1 canary and verify it is distinct from staging and production IDs.
- [ ] 3.2 Apply exact migrations `0001`–`0068`; export and verify native SQLite integrity/FK/Schema/ledger.
- [ ] 3.3 Apply exact migrations `0069`–`0070`; verify remote Schema/ledger/FK/object/column inventory.
- [ ] 3.4 Export Schema 70 and repeat native SQLite full-health verification.
- [ ] 3.5 Delete the canary and prove the exact name/ID no longer exists.

## 4. Review handoff

- [ ] 4.1 Commit by concern, push the independent branch and create a Draft PR.
- [ ] 4.2 Wait for CI and hand off the fixed head SHA plus local/canary evidence for independent review.
- [ ] 4.3 Keep the real staging D1 at Schema 68 until review and ordinary merge authorize resuming T8.
