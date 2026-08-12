# Formal Verify: canonical-product-evidence-alignment

Verified on 2026-08-12 Asia/Shanghai against the active proposal, design, tasks, five delta specifications, current main capabilities, runtime, contracts, Decision Register and existing verification evidence. Ponytail remained off. The controller authorization in this task permits Verify, then sync/archive only after a clean final Verify; no production, migration, remote or runtime operation was performed.

## Initial scorecard

| Dimension | Result |
| --- | --- |
| Completeness | CRITICAL — 19/20 tasks; G5 was intentionally still unchecked when this first assessment began |
| Correctness | PASS — 11/11 current requirements and 24/24 current scenarios mapped to implementation, contracts and tests; five explicitly REMOVED historical requirements are treated as sync removal intent, not live requirements |
| Coherence | PASS — D-033/D-034 and the design preserve historical Decisions/Migrations and retain the Seller settlement gap |
| Findings | 1 critical self-referential task gate, 0 warnings, 0 suggestions |

The initial CRITICAL was not an implementation defect: `tasks.md` G5 deferred this exact workflow pending the now-recorded controller decision. No other CRITICAL or WARNING was found, so G5 was accurately rewritten and checked before final Verify. It did not claim sync or archive completion.

## Requirement and scenario evidence

| Capability | Requirement/scenario coverage | Implementation, Contract and test evidence | Result |
| --- | --- | --- | --- |
| `admin-business-dashboard` | Frozen canonical frontend; retained backend evidence; owner opens dashboard; legacy consumer remains non-mandatory | `apps/web/src/staff/StaffAdminRouteModule.tsx:1` selects `FrozenAdminBusinessDashboard`; `apps/web/src/staff/admin-dashboard/FrozenAdminBusinessDashboard.tsx:31-73` enforces owner plus `FINANCIAL_VIEW`, windows, operating facts, funnels and projected/completed profit without browser authority. `docs/contracts/ADMIN_BUSINESS_DASHBOARD.md:3-33` retains the backend surface and authoritative finance model. `apps/web/e2e/admin-business-dashboard.spec.ts:125-155` covers owner/non-owner, responsive view and no private facts. | PASS |
| `buyer-demand-reservation` | Current paged reservable products; removed/non-reservable product; returned values/empty/later failure; reservation journey; Buyer scheduling privacy | `apps/web/src/buyer/demands/BuyerDemandsPage.tsx:16-70` uses the existing cursor projection and renders only returned list facts with empty/later-error distinction; `BuyerDemandDetailPage.tsx:14-67` renders notes and both deadlines and uses the existing version-bound idempotent reservation API. `apps/api/src/buyer-portal/read-model.ts:79-114,418-479` defines the eligible projection without internal scheduling fields. `apps/web/e2e/buyer-visual-pilot.spec.ts:206-217` checks three-item product focus and no internal fields; `apps/web/e2e/module1-buyer.spec.ts:312-322` checks confirmation, conflict and authoritative reservation navigation. | PASS |
| `buyer-routing-dashboard` | Product/task/me route tree; deep link/safe invalid route; exactly three primary items; nested semantic ownership; actionable/system-processing separation and partial-source recovery | `apps/web/src/buyer/routes/BuyerFrame.tsx:6-35` declares three items and semantic owners; `BuyerRouteModule.tsx:21-32` redirects `/buyer` to products and routes contextual journeys. `apps/web/src/buyer/tasks/BuyerTasksPage.tsx:17-119` aggregates the six current sources, excludes system items from `actionableCount`, and preserves successful results on partial failure. `BuyerLayout.test.ts:4-19`, `apps/web/e2e/foundation.spec.ts:361-382`, and `apps/web/e2e/buyer-visual-pilot.spec.ts:206-217` cover ownership, three items, mobile behavior and privacy. | PASS |
| `frontend-routing-shells` | Mobile-first three-item Buyer shell; 320px/200% zoom; contextual routes retain an owner | `apps/web/src/buyer/routes/BuyerFrame.tsx:6-35` contains the fixed accessible bottom navigation without a desktop sidebar. `apps/web/e2e/foundation.spec.ts:375-382`, `apps/web/e2e/module1-buyer.spec.ts:415-420`, and `apps/web/e2e/buyer-visual-pilot.spec.ts:219-236` cover 320px, 200% zoom, keyboard focus and overflow. | PASS |
| `staff-role-consolidation` | Chinese five-role display, role-free trusted login, zero/multi-role fail-closed, historical boundary, unapproved mapping, exactly five roles | `packages/contracts/src/staff.ts:1-20,101-106` defines only the five codes and Chinese names. `apps/api/src/staff-auth/repository.ts:145-172` rejects zero/multi/unknown role sessions. `migrations/0044_staff_marketplace_acquisition_core.sql:20-24,139-174` is retained historical/current data evidence. `packages/contracts/src/staff.test.ts:10-33` and `apps/web/e2e/staff-visual-refresh.spec.ts:310-331` verify codes and all five UI projections. D-034 is `docs/decisions/V2_DECISION_REGISTER.md:272-278`. | PASS |

## Coherence review

- The Buyer three-item model is a current product decision, while `BuyerDashboardPage.tsx` and `rankBuyerTasks` remain retained compatibility/evidence files, exactly as the proposal/design state.
- The old Seller settlement frontend is retained and explicitly not misrepresented as a completed canonical takeover.
- Route inventory authority is singular: `apps/api/src/api-contract-baseline-alignment.test.ts:31-74` reconciles `app.routes`, the documented inventory and the 237 count; `scripts/verify-product-reservation-order-scheduling.mjs:128-143` invokes that test rather than keeping another count.
- Node safety is accurately limited to the two existing local tests via `package.json:18,121`; no release/deployment behavior is added.
- Migration discipline is preserved: this task's baseline check found no diff under `migrations/`.

## Findings

### CRITICAL

- Initial only: G5 in `tasks.md:14` was incomplete. Resolved under the explicit controller authorization after confirming there were no other blocking findings.

### WARNING

- None.

### SUGGESTION

- None.

## Final scorecard

| Dimension | Result |
| --- | --- |
| Completeness | PASS — 20/20 tasks; all required artifacts are complete |
| Correctness | PASS — 11/11 current requirements and 24/24 current scenarios match implementation, contracts, Decisions and evidence suites; the five removed historical requirements are correctly bounded as removal intent |
| Coherence | PASS — the frozen Buyer/Admin/Staff decisions, legacy retention boundaries, route baseline and Node-safety gate agree with the design |
| Findings | 0 critical, 0 warnings, 0 suggestions |

Final assessment: all blocking findings are resolved. The Change is eligible for its governed spec sync and archive.
