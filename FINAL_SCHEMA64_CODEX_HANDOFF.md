# FINAL SCHEMA 64 CODEX HANDOFF — Wave 15 Finalized

Branch: `feature/frozen-portals-staff-acquisition-core`
Baseline: `d621513b8dfe7450e0af7f278cbfb17d9616b00f`
Target schema: **64**

Do not redesign the product. Do not restore stale behavior to make old tests pass. Do not merge `main`, run production migrations, modify production Cloudflare settings, or deploy without explicit owner approval.

## Read first

1. `docs/WAVE15_ARCHITECTURE_FINALIZATION_FREEZE.md`
2. `docs/CODE_INTEGRITY_CLEANUP_FREEZE.md`
3. `docs/SECOND_LAYER_HARDENING_FREEZE.md`
4. `docs/OPERATING_INTEGRITY_FREEZE.md`
5. `LATEST_CODEX_HANDOFF.md`
6. onboarding/privacy/product freeze docs referenced there.

If an older test/doc conflicts, this file + the freeze files above win. Never restore Team authority, personal GRANT expansion, reassignment APIs, simplified Seller pages, Schema43/61 assumptions, duplicate financial ledgers, or front-end-only business guards just to make stale tests pass.

## Current migration tail

- 0061 post-confirmation integrity guards
- 0062 runtime authority + privilege guards
- 0063 advance principal proof + overpayment
- 0064 Marketplace local-date truth

Wave 15 adds **no migration**. Current continuous chain remains `0001 -> 0064`.

## Wave 15 — architecture finalization

### 1. Central Formal Order Domain Policy

Authority:
- `apps/api/src/formal-order-policy.ts`
- `apps/api/src/formal-order-policy-routes.ts`

The following actions are allowed only when effective order operational state is NORMAL:
- APPROVE_REVIEW
- CREATE_BUYER_REFUND
- ACCRUE_SELLER_SERVICE_FEE
- RECORD_ADVANCE_PRINCIPAL

Application services call the central policy. Schema62 triggers stay as the DB safety net. `RESOLVED` restores NORMAL.

### 2. Backend action capabilities

Contract: `BusinessActionCapabilityDto`.

Staff order-integrity lookup returns backend-computed `actions` for order event, review visibility, review approval, advance principal and profit adjustment. Web UI renders those capabilities instead of reimplementing the order state machine.

Actions DTO is UI convenience only; security remains server-side Role/Marketplace/Domain Policy/DB guard.

### 3. Read-only Financial Reporting Projection

Authority:
- `packages/contracts/src/financial-reporting.ts`
- `apps/api/src/admin-business-dashboard/financial-projection.ts`
- `/api/staff/admin-business-dashboard/financial-projection`

This is NOT a new ledger. Buyer Refund, Advance Principal, Seller Payable/Payment, Financial Snapshot and Profit Adjustment remain the write authorities.

Projection provides seller cash-in, buyer cash-out, net cash flow, Seller due/paid/outstanding, Buyer due/paid/outstanding, projected profit and completed profit.

Cash timing is event based:
- Seller payment counts positive on payment date;
- Seller payment reversal counts negative on reversal date;
- Buyer payment/reversal follows its own event timestamp;
- Advance principal is actual cash once; the auto-created Refund Payment generated later by settlement is excluded from cash flow to prevent double counting.

### 4. Conservative File Retention

Authority: `apps/api/src/files/retention.ts`.

No second file lifecycle table. Reuse existing `file_objects` DELETION_PENDING/DELETED state machine.

Rules:
- active business Link => never auto-delete;
- active read intent => postpone;
- specialized Order Instruction ORPHANED assets stay with their existing reconciler;
- durable VERIFIED unlinked files age 30 days before retention;
- durable UPLOADED/REJECTED unlinked files age 7 days;
- never-uploaded RESERVED rows are not treated as R2 delete objects;
- D1 DELETION_PENDING happens before R2 delete;
- D1 DELETED only after R2 succeeds;
- failed R2 delete stays pending with retry;
- generic retention is included in the existing `file_orphan_cleanup` scheduler readiness/backlog.

### 5. Real behavior tests

New/extended behavior coverage:
- `apps/api/src/wave15-architecture-finalization.behavior.test.ts`
- `apps/api/src/formal-order-policy-routes.test.ts`
- `apps/api/src/files/retention-current-schema.test.ts`
- `apps/api/src/customer-security/migration-0030.test.ts`

Required facts:
- abnormal order blocks gated actions; RESOLVED restores them;
- HTTP guard returns 409 while blocked;
- real 0030 persona relation + 0062 trigger bumps shared-account session exactly once on second persona;
- advance 600 → formal refund 500 → formal payment 500 + overpayment 100;
- linked files are retained; unlinked durable old files are deleted only after D1 planning; delete failures remain pending;
- retention succeeds against the real migrated Schema64 file constraints;
- advance settlement does not double-count cash;
- Seller Payment reversal is a negative cash event on reversal day, not a rewrite of the original payment day.

Source-marker tests are secondary. Real DB/API behavior wins.

## Product/security foundation that must remain

- Buyer nav: 产品 / 任务 / 我的.
- Seller mature portal remains active; do not replace with simplified timezone rewrite. JP customer-facing time uses Asia/Tokyo.
- Staff: Role decides capability; Marketplace decides visibility. PRIMARY owns open queue; SUPPORT does not compete.
- Cloudflare Access proves Staff email; Moonwhite Staff authority is final.
- same WeChat reuses one Moonwhite login; second persona rotates session version and invalidates older sessions.
- customer registration/historical-customer rules remain as frozen in onboarding docs.
- acquisition ordinary Staff see only immutable 渠道N; Owner/acquisition see real source.
- new channels BUYER or SELLER only; historical BOTH reporting-only.
- raw timestamps UTC, company reporting Asia/Shanghai, business timestamps use Marketplace timezone.

## Production readiness

- `/health` = liveness only.
- `/ready` = Schema64 + Scheduler + Acquisition Maintenance + object storage + Cloudflare Access config + valid running `APP_RELEASE_SHA` + recovery attestation for the same release SHA.
- local release gate must not actively probe Moonwhite production.
- explicit real production readiness probe only: `node scripts/probe-production-readiness.mjs`.

## Explicitly NOT building now

Do not add without a real measured need:
- permission cache;
- Lead Score;
- full Seller organization selector UI;
- migration squash;
- generic universal financial-events ledger;
- complex Staff scheduling/SLA/reassignment system.

Future fresh-install baseline is allowed, but production migration history `0001 -> 0064` remains immutable.

## Required clean-checkout verification

Use Node 24:

```bash
npm ci
npm run db:verify
npm run verify:migration-guards
npm run db:migrate:local
npm run typecheck --workspace @ygb/contracts
npm run typecheck --workspace @ygb/domain
npm run typecheck --workspace @ygb/api
npm run typecheck --workspace @ygb/web
npm run test:customer-security
npm run test:staff-acquisition
npm run test:admin-dashboard
npm test
npm run build
npm run check:production-readiness
npm run test:wave14a:browser
npm run test:staff-acquisition:browser
npm run test:admin-dashboard:browser
```

Also run the real historical D1 copy through current-production-prefix -> Schema64. Verify original Buyer/Seller/Store/Product/FormalOrder IDs, snapshots, file links and historical relationships remain unchanged.

Targeted Wave15 checks must include:
- central Domain Policy + HTTP guards;
- Buyer→Seller and Seller→Buyer two-device session invalidation;
- 600/500/100 advance settlement;
- Capability DTO response/UI behavior;
- financial cash projection including later reversals;
- retention full-schema transition, linked-file protection, active-read protection and R2 retry;
- mature Seller pages still retain withdrawal/reviews/chat screenshot/settlement/pagination.

## Current execution status

The GitHub-editing assistant implemented and statically reviewed these changes, but **did not run a full Node24/Vitest/TypeScript/Playwright/real-history-D1 green suite**. Local Codex is the execution authority for real integration failures.

Do not merge or deploy until those checks are green and the owner explicitly approves.