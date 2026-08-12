# Design: Canonical product evidence alignment

## Authority and historical boundary

Authority remains `AGENTS.md` → Decision Register → Product Rules → Contracts → Architecture → acceptance evidence. The user-confirmed product facts in this task are the current decision input. Archived Changes and existing Decision Register entries D-024 and D-025 are historical records; this Change never edits their historical text.

The current canonical specs are updated only through this active OpenSpec Change. No direct runtime or domain change is implied by a spec alignment. If implementation evidence disagrees with a current rule, the disagreement is recorded for controller decision rather than hidden by changing a marker.

## Buyer

The Buyer shell has exactly `产品`, `任务`, `我的`, with `/buyer` redirecting to `/buyer/products`. The product area is the current Buyer-eligible reservable product projection. The task center aggregates the existing reservation, order-evidence, review, and refund API evidence.

Only work the Buyer must perform is actionable. Review-in-progress, order-evidence-in-progress, reservation review, and refund processing are system-processing and are displayed separately without increasing the actionable count. The old Dashboard page and `rankBuyerTasks` helper remain as retained compatibility/evidence files, but their deadline ranking, global deduplication, and newly reservable-demand dashboard semantics are not current product requirements.

## Staff roles

The current canonical role set is exactly `owner`, `acquisition`, `pre_sales`, `seller_ops`, and `buyer_refund`. Migration 0035's four-role stage remains historical and immutable. Migration 0044's introduction of `acquisition` is the current fifth-role boundary. The five-role decision does not rewrite either Migration or D-024.

## Seller settlement gap

The Staff Workbench still contains seller settlement evidence and the corresponding MSW test evidence, and the staff settlement API/contracts remain in the route inventory. The current canonical frontend has not been accepted as a complete takeover of that capability. The gap is therefore tracked as an independent frontend workflow blocker, not as a retirement decision.

## Admin dashboard

`FrozenAdminBusinessDashboard.tsx` is the canonical frontend surface. Its required UI evidence is today/week/month windows, operating metrics, Buyer/Seller funnels, channel/daily facts, projected/completed profit, and current operating-integrity facts. The older `AdminBusinessDashboard.tsx` drilldown/trend consumer is not mandatory canonical UI, but its backend trend/drilldown/read-model/contracts remain in scope for a later consumer audit and are not deleted or weakened here.

## Verifier classification

| Verifier | Current result | Classification | Governance action |
| --- | --- | --- | --- |
| `verify-module1-buyer-formal.mjs` | PASS, 58 requirements / 116 scenarios | Archived formal completeness evidence; not a current Buyer UX semantics verifier | Keep legacy evidence; current canonical semantics are governed by this Change and runtime evidence |
| `verify-staff-acquisition-funnel.mjs` | FAIL: `lead route is not exact-field closed` | Genuine runtime/spec/source-marker conflict | Preserve failure as a blocker; do not change Domain/API behavior or weaken the verifier |
| `verify-product-reservation-order-scheduling.mjs` | FAIL: stale route inventory assertion for 180 | Stale verifier marker | Delegate route-baseline validation to the canonical runtime-backed API contract-baseline test; do not keep a second route count |
| `verify-admin-business-dashboard.mjs` | PASS on local schema 65/query-plan evidence | Backend/no-schema-change verifier | Keep backend contracts; separately record the canonical frontend/consumer boundary |

## Route inventory evidence

The current authoritative route inventory is the exact runtime `app.routes` table reconciled by `apps/api/src/api-contract-baseline-alignment.test.ts`. That test owns the unique route-count assertion and checks the documented inventory against the runtime route table, including Staff workflow-closure registrations. The scheduling verifier invokes this canonical test instead of duplicating a count. The old 180 assertion is stale evidence from an earlier baseline, not a reason to alter route behavior.

## Node safety gate

Both direct baseline tests passed on Node v24.19.0:

- `scripts/google-drive-oauth-pkce.node-test.mjs`: 6/6 passed.
- `scripts/export-d1-redacted.node-test.mjs`: 3/3 passed.

The root `test:node-safety` script contains exactly those two `node --test` commands and is invoked near the start of `check`. This is the only pipeline composition change in this Change; it adds no networked, production, or business-runtime action.

## Verification and no-go boundary

This Change can be strictly structurally validated. The formal `$openspec-verify-change` skill is not available in the current tool context, so no implementation Verify, sync, or archive claim is made here. Production and all remote resources remain untouched.
