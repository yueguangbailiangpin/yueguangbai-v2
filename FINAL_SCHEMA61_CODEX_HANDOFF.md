# FINAL SCHEMA 61 CODEX HANDOFF

Branch: `feature/frozen-portals-staff-acquisition-core`

This file is the final integration pointer for the second-layer hardening pass. Product authority remains, in order:

1. `docs/SECOND_LAYER_HARDENING_FREEZE.md`
2. `docs/OPERATING_INTEGRITY_FREEZE.md`
3. `LATEST_CODEX_HANDOFF.md`
4. the older frozen product/onboarding documents referenced there.

Target schema: **61**. Do not redesign. Do not merge main. Do not deploy.

## Active frontend entrypoints that matter

- Acquisition Core: `AcquisitionCoreWorkbench.tsx` → **V4**.
- Staff W1 integrity tools: extensionless `StaffOperatingIntegrityTools` resolves `StaffOperatingIntegrityTools.ts` → **V2**.
- Seller extensionless `SellerPages` resolves `SellerPages.ts` → `SellerPagesMarketplace.tsx`; current real JP customer-facing date rendering is **Asia/Tokyo**.
- Seller primary registration: extensionless `SellerRegistrationPage` resolves `.ts` → `SellerRegistrationPageV2.tsx`.
- Seller settings uses `SellerSettingsV2Page` + `SellerMemberManagement`.

There may be older `.tsx`/V2/V3 compatibility artifacts with the same business concepts. They are not product authority. After typecheck/build proves the active resolution, Codex may safely delete unused legacy comparison artifacts, but must not remove the active V4/V2/Marketplace implementations.

## Security acceptance added at the end

Adding any Seller persona to a shared Moonwhite login is a privilege change:

- primary Seller registration rotates `customer_login_accounts.session_version` before issuing the current Seller session;
- Seller team-member registration is wrapped by `member-privilege-session-rotation.ts`, which rotates session version after atomic membership creation and replaces the current cookie;
- therefore older Buyer/Seller sessions cannot silently inherit newly granted Seller access.

Test these with a pre-existing Buyer account on two simulated devices.

## 14 second-layer hardening areas to test

1. Cloudflare Access production Staff auth, no active Feishu Staff Auth dependency.
2. Schema61 D1 + R2 recovery evidence and append-only attestation.
3. `/ready` stronger than `/health`.
4. Scheduler + Acquisition Maintenance release gates.
5. DENY-only Staff overrides / no active personal GRANT expansion.
6. file reads revalidate current Role × Marketplace × Entity; legacy Team does not expand explicit file authority.
7. post-confirmation order operational events + signed profit compensation; original order/snapshot immutable.
8. APPROVED review visibility lifecycle + advance principal auto-settlement into later refund ledger, no duplicate payment.
9. PRIMARY open queue, SUPPORT no competing OPEN queue.
10. new channels BUYER/SELLER only; `渠道N` immutable; historical BOTH reporting-only.
11. Owner customer WeChat change preserves business IDs/history and revokes old customer sessions.
12. Seller OWNER invites OPERATIONS/FINANCE/VIEWER with store grants; existing Moonwhite account reuses identity/password and privilege session rotates.
13. per-Agent acquisition machine secret hash + Marketplace/channel scopes + hourly rate + revoke; global shared secret is not runtime authority.
14. canonical Marketplace authority; company report time Asia/Shanghai; current JP customer/schedule time Asia/Tokyo; future non-JP formal orders require explicit marketplace-local business date.

## Migrations to verify especially

- 0054 access/channel/marketplace hardening
- 0055 order/review/advance compensation
- 0056 customer identifier + Seller member invitation
- 0057 scoped acquisition machine credentials
- 0058 marketplace dates + recovery attestation
- 0059 Seller member portal store grants
- 0060 effective marketplace dates
- 0061 post-confirmation integrity guards

Run real chain `0001 -> 0061`, wrong-order/repeat guards, and a copy of the actual historical D1 prefix -> 61. Do not modify historical IDs to make migration pass.

## Required commands

Use Node 24 from a clean checkout:

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
npm run build --workspace @ygb/web
npm run build
npm run test:staff-acquisition:browser
npm run test:admin-dashboard:browser
```

Also run Seller portal browser coverage for member invitation/registration, multi-persona session rotation, and Tokyo date rendering.

## Likely integration drift to fix, not redesign around

- old tests/docs asserting Schema 43/50/53 or Feishu Staff auth;
- old Buyer nav expectations;
- old Team/Department file-authority tests;
- old `PRODUCT_SCHEDULE_TIMEZONE=Asia/Shanghai` assertions;
- old Acquisition V2/V3/BOTH-channel assertions;
- old tests expecting Staff SUPPORT to see the open shared work queue;
- any exact response schema that rejects the new `all_previous_sessions_revoked` Seller registration safety field;
- current ObjectStorageAdapter metadata naming in `/ready` (compile/runtime contract is final; fix adapter field drift if typecheck identifies it);
- historical WeChat claim ACTIVE→RELEASED constraints;
- advance-principal-generated formal refund payment constraints and work-item reconciliation.

Never “fix” these by restoring the stale product rule.

## Production boundary

No production migration, deployment, DNS, Cloudflare Access configuration, real recovery attestation, or live R2/Drive operation has been executed by this branch work. Those remain explicit owner-approved release steps after local acceptance.
