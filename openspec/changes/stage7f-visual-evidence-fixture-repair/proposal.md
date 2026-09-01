# Proposal: stage7f-visual-evidence-fixture-repair

## Why

Stage 7F's current browser evidence harness is stale at the fixed local checkout. The Staff visual suite still assumes hidden navigation text, retired role labels, and the previous dashboard response shape; the isolated Stage 7.5 evidence fixtures also omit current strict response fields. Those defects prevent reliable normal-state screenshots even though the production components and current Review runtime are available.

## What Changes

- Add only the current Stage 7F evidence fixture and harness repairs: semantic waits, current role/navigation labels, strict dashboard/service-channel/settlement/work-item/order-evidence responses, protected-image read fixtures, the missing Review access-management demo reads, and the Seller home member-response schema alignment required by the existing backend response.
- Add a dedicated browser evidence spec that captures the frozen 17 Staff-page views and four `/review` recovery views from the real application runtime.
- Record the command exits, screenshot manifest, and manual inspection results after all 21 views pass normal-state assertions.
- Apply one narrowly scoped Dashboard window-control touch-target rule required by the existing 44px acceptance assertion.

## Non-Goals

- No backend/API/DTO/permission/database contract changes, schema changes, business-policy changes, or real-data/import/image-inventory work.
- No portal redesign, visual-spec change, broad CSS cleanup, selector weakening, skipped tests, static/fake screenshots, or changes to the completed Stage 7F-4 child change.
- No push, deployment, remote-resource access, production action, or OpenSpec archive/sync operation.

## Migration

None. This is a local-only test/evidence and narrowly scoped Staff control-style repair.

## Impact

- `apps/web/e2e/` deterministic evidence fixtures and browser assertions.
- `apps/web/src/review/demo-api.ts` only for schema-valid Review access-management reads.
- `apps/web/src/seller/pages/SellerPages.tsx` only to accept the existing `wechat_id` field returned by the seller member read contract.
- One scoped Staff Dashboard rule in `apps/web/src/styles/staff-pages.css`.
- OpenSpec evidence and the parent Stage 7F task/handoff are updated only after the 21-view acceptance completes.
