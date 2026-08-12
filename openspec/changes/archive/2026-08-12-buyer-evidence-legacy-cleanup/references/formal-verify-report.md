# Formal Verify: buyer-evidence-legacy-cleanup

Verified on 2026-08-12 Asia/Shanghai against the proposal, design, tasks, D-033/D-036, the Frozen Product Baseline, current Buyer routing/task implementation, and local gate results. This is a `skip_specs` cleanup Change: it removes obsolete runtime/evidence without changing a user-visible, API, permission, state-machine, or migration requirement.

## Summary

| Dimension | Result |
| --- | --- |
| Completeness | PASS — 9/9 tasks complete; proposal, design, and tasks are complete and specs are explicitly skipped. |
| Correctness | PASS — canonical Buyer route/navigation/task evidence replaced the dead Dashboard test in the Module 1 formal verifier; the old Dashboard files are deleted. |
| Coherence | PASS — D-036 retires only D-033's then-current retained-file status; D-033, D-025, archived Changes, current contracts, and migrations remain intact. |
| Findings | 0 critical, 0 warnings, 0 suggestions. |

## Evidence reviewed

- `apps/web/src/buyer/routes/BuyerRouteModule.tsx` redirects `/buyer` to `/buyer/products`; `BuyerFrame.tsx` declares exactly `产品` / `任务` / `我的`.
- `BuyerTasksPage.tsx` consumes the current reservation, evidence, review, and refund query sources through `task-classification.ts`; `task-classification.test.ts` proves actionable items are counted separately from pending reservation/evidence/review and refund processing.
- `BuyerLayout.test.ts` confirms the three exact navigation items and contextual ownership.
- `scripts/verify-module1-buyer-formal.mjs` now maps `buyer-routing-dashboard` to canonical route, navigation, task behavior, and existing browser evidence; it passed with `COMPLETE=58` and `Scenarios=116/116`.
- `npm run check:module1:buyer` passed: security/migration verifiers, 263 Buyer-scope tests, web typecheck, and production web build.
- `openspec validate buyer-evidence-legacy-cleanup --strict`, `openspec validate --all --strict`, `git diff --check`, migration scope verification, and `npm run check` all passed.

## Retirement and safety review

The removed files are limited to `BuyerDashboardPage.tsx`, `buyer/dashboard/tasks.ts`, and its test. The removed CSS selectors are used only by that Dashboard. The repository search found no runtime import, verifier mapping, source marker, or active test dependency on them. Remaining mentions are historical archived artifacts, D-033's preserved historical wording, D-036's retirement record, or the canonical specification's explicit non-requirement boundary.

No Migration, D1/R2 operation, production configuration, secret, deployment, commit, push, PR, or other remote write occurred.

## Final assessment

All cleanup tasks and gates are complete. Because `skip_specs: true` produces no delta specs, no main-spec sync is required; the Change is ready to archive.
