# Local test evidence

Date: 2026-08-15 (Asia/Shanghai). All commands ran locally in this Change worktree; no remote service or production resource was touched.

- Related Buyer/Seller/Staff/UI regression: `vitest run` over the 17 named files passed 17 files / 128 tests. This includes the batch-window Staff-payment race, same-key idempotency conflict cases, the repaired Wave13 Staff Buyer Refund detail/list runtime fixture, and Staff runtime contract validation.
- Backup/recovery: `npm run test:production-readiness` passed 5 files / 14 tests; `vitest run scripts/backup-restore-cli.test.mjs` passed 1 file / 6 tests. Both successful fixtures now require Schema 70. The active production-backup-recovery spec also requires the `0001`–`0070` chain and Schema 70; historical/archived Schema 69 evidence remains historical.
- Runtime/docs route inventory: `vitest run apps/api/src/api-contract-baseline-alignment.test.ts` passed 1 file / 4 tests after documenting `POST /api/buyer-portal/refunds/:id/remind` and raising the current runtime count to 239.
- Typechecks: `@ygb/domain`, `@ygb/contracts`, `@ygb/api`, and `@ygb/web` passed.
- Migration verifiers: continuous 0001→0070, fresh/sequential Schema 70, 69 wrong-order rejections, 70 repeat rejections, 139 failed snapshots unchanged, integrity and foreign-key checks are run by the local verifier commands below.
- `verify:api-contract` is a baseline-only scope guard: when run on this feature branch it rejects the intentional T7 runtime/schema diff against `origin/main`; the direct runtime/docs contract test above is the relevant behavior verdict. `openspec validate --all --strict` and `git diff --check` are run after this evidence update. Formal Verify, sync, archive, remote validation, staging, and Production GO are deliberately out of scope.
