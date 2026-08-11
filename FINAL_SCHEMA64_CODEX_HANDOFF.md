# FINAL SCHEMA 64 CODEX HANDOFF

Branch: `feature/frozen-portals-staff-acquisition-core`
Baseline: `d621513b8dfe7450e0af7f278cbfb17d9616b00f`
Target schema: **64**

Do not redesign the product. Do not restore stale behavior to make old tests pass. Do not merge `main`, run production migrations, modify production Cloudflare settings, or deploy without explicit owner approval.

## Read first

1. `LATEST_CODEX_HANDOFF.md`
2. `docs/CODE_INTEGRITY_CLEANUP_FREEZE.md`
3. `docs/SECOND_LAYER_HARDENING_FREEZE.md`
4. `docs/OPERATING_INTEGRITY_FREEZE.md`
5. onboarding/privacy/product freeze docs referenced by LATEST.

## What changed after Schema 61

### 0062 runtime authority + privilege guards
- Any second Buyer/Seller persona on an existing customer login atomically bumps `session_version` in the same transaction that inserts the persona.
- Current invite-completing device receives a refreshed cookie using the new version; older devices become invalid immediately.
- Generic formal-order adjustments are profit-only.
- Non-NORMAL formal orders block new Review APPROVED, Buyer Refund Obligation and review-driven Seller service-fee payable creation until explicitly RESOLVED.

### 0063 advance principal proof + excess
- Advance Buyer principal requires verified `BUYER_REFUND_PROOF` files.
- Proof files are explicitly linked to the immutable advance-payment fact.
- Auto-settlement applies at most the later formal refund amount.
- Any excess is recorded separately in `buyer_advance_principal_overpayments`; it does not make the formal refund ledger silently OVERPAID.

### 0064 Marketplace-local date truth
- Historical AMAZON_US rows that only contain the China reporting-date compatibility fallback are cleared to unknown rather than presented as a US-local date.
- Effective local dates are derived only where exact (+09 JP/KR) or from an explicitly persisted Marketplace-local date.
- `marketplace_runtime_config` is a migration-controlled mirror; runtime code uses the typed Marketplace registry.

## Code cleanup that must remain

- Mature `SellerPages.tsx` is the active Seller portal again. It keeps withdrawal flows, real reviews, chat screenshot access, settlement detail and pagination; current live JP presentation uses Asia/Tokyo.
- Delete/keep deleted all `apps/apps/**` marker fixtures, extension-resolution shims, probe declarations and duplicate `.ts` wrappers.
- `StaffOperatingIntegrityTools.tsx` and `SellerRegistrationPage.tsx` are direct authoritative modules.
- Staff runtime authority is Role defaults minus explicit DENY. Historical GRANT and Team leader data do not expand permissions.
- Staff assignment runtime exposes queue reads only. Availability/fallback/reassignment/batch-transfer mutations are not registered.

## Money/state safety acceptance

- Order event, review visibility, profit adjustment, advance payment and advance reversal mutations consume server-side idempotency keys.
- Advance principal requires verified proof; reused proof is rejected.
- Refund auto-settlement never applies more than the obligation due.
- Abnormal order state is consumed by downstream review/refund/service-fee state changes, not merely displayed.
- Seller principal/service fee/Buyer refund corrections must stay in their native ledgers; generic financial adjustment accepts projected/completed company profit only.

## Marketplace/time acceptance

- Raw timestamps: UTC.
- Company operating/dashboard business date: Asia/Shanghai.
- Customer/business dates: Marketplace business timezone.
- Current live Seller/Buyer JP: Asia/Tokyo.
- COUPANG_KR: Asia/Seoul.
- AMAZON_US configured as America/Los_Angeles.
- Never use browser/IP/device timezone as business authority.
- Never use China reporting date as a fabricated US-local date.

## Production readiness acceptance

- `/health` = liveness only.
- `/ready` target Schema 64 and checks schema, scheduler, acquisition maintenance, object storage, Cloudflare Access configuration, running release SHA and a recovery attestation for the same release SHA.
- `APP_RELEASE_SHA` is required production configuration.
- local `verify-production-readiness-formal.mjs` is offline.
- real production network probe is explicit: `node scripts/probe-production-readiness.mjs`.
- `release-check.mjs` must remain offline and must not include the old Feishu workbench Staff-auth gate.

## Required clean checkout verification

Use Node 24:

```bash
npm ci
npm run db:verify
npm run verify:migration-guards
npm run db:migrate:local
npm run typecheck
npm test
npm run build
npm run check:production-readiness
npm run test:wave14a:browser
```

Also run targeted Seller/Staff/Acquisition/Admin browser suites and a copy of the real historical D1 database through `0001 -> 0064` / current-production-prefix -> 64.

Must verify specifically:
- Schema 62 persona trigger does not double-bump on first persona, does bump exactly once on second persona.
- Buyer→Seller and Seller→Buyer shared-account session invalidation on two simulated devices.
- abnormal order blocks approval/refund/service-fee until RESOLVED.
- advance proof upload/link/read, idempotent retry, partial reversal and excess overpayment behavior.
- file reads remain Role × Marketplace × Entity.
- PRIMARY/SUPPORT queue behavior.
- mature Seller portal features were not lost by timezone cleanup.
- `/ready` fails when `APP_RELEASE_SHA` is missing/mismatched, recovery SHA is stale, Scheduler backlog is excessive, Access config is placeholder, or Schema is not 64.

## Expected integration drift

Old tests may still assert Schema 43/61, Team/leader permissions, reassignment endpoints, the simplified Seller shim, or production Feishu Staff auth. Update those old assertions. Never restore the stale runtime behavior merely for test compatibility.

No full green test run has been performed by the GitHub-editing assistant. Local Codex is the execution authority for compile/migration/browser integration failures.
