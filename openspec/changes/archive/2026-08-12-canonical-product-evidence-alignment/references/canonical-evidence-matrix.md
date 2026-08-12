# Canonical Evidence Matrix

Baseline: `main@3b89b4f2d503f6655e94b6b030d6a7f9637a3ba1`, fetched `origin/main` at the same SHA, clean before this Change.

## Current canonical facts

| Area | Canonical current fact | Runtime/spec evidence | Historical/compatibility boundary |
| --- | --- | --- | --- |
| Buyer routing | `产品` / `任务` / `我的`; `/buyer` → `/buyer/products` | `apps/web/src/buyer/routes/BuyerFrame.tsx`, `BuyerRouteModule.tsx`, Frozen Product Baseline | `BuyerDashboardPage.tsx` and dashboard task helper/test remain retained files only |
| Buyer tasks | API aggregation of reservations, order evidence, reviews, refunds; actionable excludes system-processing | `apps/web/src/buyer/tasks/BuyerTasksPage.tsx` | No reactivation of old deadline-ranking dashboard requirement |
| Buyer demand/reservation | Product area shows current reservable projections; reservation API/mutations remain unchanged | `apps/web/src/buyer/demands/BuyerDemandsPage.tsx`, existing contracts | Existing detail/mutation routes remain implementation paths |
| Staff roles | Exactly `owner`, `acquisition`, `pre_sales`, `seller_ops`, `buyer_refund` | `packages/contracts/src/staff.ts`, `migrations/0044*` if present, Frozen Product Baseline | Migration 0035 four-role stage and D-024 remain historical |
| Seller settlement | Frontend takeover unresolved; preserve old Staff evidence and APIs | `apps/web/src/staff/StaffWorkbench.tsx`, `StaffWorkbench.msw.test.tsx`, route inventory | Independent frontend workflow gap; no retirement claim |
| Admin dashboard | `FrozenAdminBusinessDashboard` is canonical; backend trend/drilldown/read-model/contracts stay | `apps/web/src/staff/admin-dashboard/FrozenAdminBusinessDashboard.tsx`, Admin contract/read model | `AdminBusinessDashboard.tsx` is non-mandatory legacy consumer; later audit |

## Verifier evidence

| Item | Evidence | Status |
| --- | --- | --- |
| Buyer formal verifier | `node scripts/verify-module1-buyer-formal.mjs` | PASS: 58/58 requirements, 116/116 scenarios; archived completeness only |
| Acquisition verifier | `node scripts/verify-staff-acquisition-funnel.mjs` | PASS in the separate `acquisition-source-authority-alignment` Change; D-035 supersedes only D-026's obsolete server-derived/no-`channel_id` rule and the current contract document is aligned |
| Scheduling verifier | `node scripts/verify-product-reservation-order-scheduling.mjs` | Initially failed on stale 180 route marker; it now invokes the canonical API contract-baseline test instead of keeping a duplicate route count |
| Admin verifier | `node scripts/verify-admin-business-dashboard.mjs` | PASS: local schema 65 and query-plan evidence; does not certify canonical frontend selection |

## Gate ownership

| Verifier | Direct npm script | Module check | Included by top-level `npm run check` / `npm run release:check` |
| --- | --- | --- | --- |
| Module 1 formal | `verify:module1:buyer:formal` | none; `check:module1:buyer` runs different security/migration verifiers | No / No |
| Acquisition | `verify:staff-acquisition` | `check:staff-acquisition` | No / No |
| Scheduling | `verify:product-reservation-scheduling` | `check:product-reservation-scheduling` | No / No |
| Admin dashboard | `verify:admin-dashboard` | `check:admin-dashboard` | No / No |

Top-level `npm run check` does include the repository-wide Vitest suite and the API route contract test, but it does not invoke these four standalone verifier commands. `npm run release:check` delegates to top-level `check` plus its other listed release sub-gates and likewise does not add the four module checks.

## Route baseline

`docs/contracts/V2_API_ROUTE_INVENTORY.md` and `apps/api/src/api-contract-baseline-alignment.test.ts` form the unique governed route baseline: the test compares the documented list to the runtime `app.routes` table and owns the count assertion. The scheduling verifier invokes that test rather than duplicating any route count. The old claim of 180 is superseded by this runtime-backed baseline.

## Node safety

| Command | Result |
| --- | --- |
| `node --test scripts/google-drive-oauth-pkce.node-test.mjs` | PASS, 6 tests |
| `node --test scripts/export-d1-redacted.node-test.mjs` | PASS, 3 tests |

`test:node-safety` contains exactly those commands and is invoked near the start of `npm run check`.

## Explicit preservation list

The following remain intentionally retained: `BuyerDashboardPage.tsx`, `buyer/dashboard/tasks.ts`, `buyer/dashboard/tasks.test.ts`, `StaffWorkbench.tsx`, `StaffWorkbench.msw.test.tsx`, `AcquisitionWorkbench.tsx`, `AcquisitionWorkbench.msw.test.tsx`, `AdminBusinessDashboard.tsx`, `AdminBusinessDashboard.msw.test.tsx`, and the manifest fetch script. No production code behavior, API contract, Migration, or production resource changed.
