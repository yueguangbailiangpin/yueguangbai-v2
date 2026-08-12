# Change Proposal: Canonical product evidence alignment

## Why

The current runtime and frozen product baseline have moved beyond several archived OpenSpec snapshots, but the canonical specs and static evidence still mix old and current facts. The most visible drift is the Buyer five-item/dashboard language, the Staff four-role wording that predates `acquisition`, the stale scheduling route count of 180, and an acquisition verifier that expects a request shape the current runtime no longer uses.

This Change makes the current product decisions explicit and keeps historical Changes immutable. It is a governance and evidence-alignment Change only; it does not use a verifier edit to conceal a runtime/spec conflict.

## What Changes

- Align the current OpenSpec capabilities for `buyer-routing-dashboard`, `buyer-demand-reservation`, `frontend-routing-shells`, `staff-role-consolidation`, and `admin-business-dashboard` with the current frozen product baseline.
- Record the current Buyer three-item navigation/task-center model and the current Staff five-role model through superseding Decision Register entries, using the actual next decision numbers after D-032.
- Record the legacy Seller settlement frontend as an independent workflow gap. The old Staff settlement runtime, test evidence, and API/contracts remain retained until a separate frontend takeover is accepted.
- Record `FrozenAdminBusinessDashboard` as the canonical frontend while retaining the backend trend, drilldown, read-model, and contract surface for a later consumer audit.
- Align the product-scheduling verifier with the single authoritative API contract-baseline test, which reconciles the runtime route table with the route inventory; the verifier holds no second route-count assertion. Acquisition source-authority alignment remains a separate approved Change.
- Add the two existing Node safety tests as one small `test:node-safety` gate and invoke it from `check`, without changing either test or expanding the release pipeline.

## Non-Goals

- No deletion of old runtime files, including `BuyerDashboardPage.tsx`, `buyer/dashboard/tasks.ts`, `buyer/dashboard/tasks.test.ts`, `StaffWorkbench.tsx`, `StaffWorkbench.msw.test.tsx`, `AcquisitionWorkbench.tsx`, `AcquisitionWorkbench.msw.test.tsx`, `AdminBusinessDashboard.tsx`, or `AdminBusinessDashboard.msw.test.tsx`.
- No business Domain, API behavior, API contract, Migration, or historical Decision rewrite.
- No Production deployment, migration, D1/R2 write, secret, DNS, Cloudflare Access mutation, force push, tag, push, or PR.
- No attempt to declare the old Seller settlement Staff UI retired.
- No attempt to restore the legacy Buyer dashboard ranking as a product requirement.

## Migration and Rollback

No Migration is required or changed. The Change is reversible as a documentation/verifier diff. Historical archived Changes remain byte-for-byte untouched; rollback is limited to reverting this uncommitted governance/evidence diff before any remote action.

## Acceptance Boundary

Acceptance requires strict OpenSpec structure validation, the runtime-backed route-baseline test invoked by the scheduling verifier, the `test:node-safety` gate, and an explicit four-verifier status matrix. Formal OpenSpec Verify and sync/archive remain controller-gated; an unavailable Verify skill must not be represented as a passed implementation verification.
