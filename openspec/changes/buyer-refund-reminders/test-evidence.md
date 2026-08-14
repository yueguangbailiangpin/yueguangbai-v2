# Local test evidence

Date: 2026-08-15 (Asia/Shanghai). All commands ran locally in this Change worktree; no remote service or production resource was touched.

- Focused Vitest: buyer refund ledger/status and Migration 0070 behavior — 23 tests passed across their direct runs. The authoritative related Buyer/Seller/Staff/UI/production-readiness regression command passed 17 files / 125 tests, including the new batch-window Staff-payment race and both same-key idempotency conflict cases.
- Typechecks: `@ygb/domain`, `@ygb/contracts`, `@ygb/api`, and `@ygb/web` passed.
- Migration tests: a real non-empty Schema 69 database containing a buyer-channel row plus immutable command/audit facts advances to 70 and preserves them. Wrong-order, repeat, and explicitly non-empty partial-0070 dirty-stock cases compare the full `sqlite_schema` and representative data snapshots before/after, then run `integrity_check` and `foreign_key_check`.
- Migration verifiers: continuous 0001→0070, fresh/sequential Schema 70, 69 wrong-order rejections, 70 repeat rejections, 139 failed snapshots unchanged, integrity and foreign-key checks passed.
- `openspec validate buyer-refund-reminders --strict` and `git diff --check` passed. Formal Verify, sync, archive, remote validation, staging, and Production GO are deliberately out of scope.
