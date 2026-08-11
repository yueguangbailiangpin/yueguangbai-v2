# LATEST CODEX HANDOFF — 2026-08-11

This file supersedes stale migration/version and operating-flow statements in every earlier handoff file on this feature branch.

Branch: `feature/frozen-portals-staff-acquisition-core`
Baseline: `d621513b8dfe7450e0af7f278cbfb17d9616b00f`
Current target schema: **64**

**Do not redesign the product. Do not restore stale behavior for old tests. Do not merge main or deploy.**

## Read first

1. `FINAL_SCHEMA64_CODEX_HANDOFF.md`
2. `docs/CODE_INTEGRITY_CLEANUP_FREEZE.md`
3. `docs/SECOND_LAYER_HARDENING_FREEZE.md`
4. `docs/OPERATING_INTEGRITY_FREEZE.md`
5. `docs/CUSTOMER_MULTIPERSONA_ONBOARDING_FREEZE.md`
6. `docs/HISTORICAL_CUSTOMER_PORTAL_ONBOARDING_FREEZE.md`
7. `docs/CUSTOMER_REGISTRATION_AND_CHANNEL_DASHBOARD_FREEZE.md`
8. `docs/ACQUISITION_CHANNEL_PRIVACY_FREEZE.md`
9. `docs/FROZEN_PRODUCT_BASELINE.md`
10. `docs/STAFF_ACCESS_CUTOVER.md`

## Product foundation that must remain

Buyer: 产品 / 任务 / 我的 only; invitation registration; historical Buyer reuses existing business identity.

Seller: mature professional portal remains intact. Formal Seller customer and portal account are separate. Seller OWNER may invite scoped OPERATIONS / FINANCE / VIEWER. Current live Seller business is Amazon JP; do not simplify Seller functionality merely to change timezone.

Staff: Cloudflare Access proves email; Moonwhite active Staff + one role + Marketplace scope is final authority. PRIMARY owns open queue, SUPPORT is business visibility/backup only. No availability/reassignment/team-management runtime UI/API.

Acquisition: Channel → Prospect(optional) → formal customer → order → profit. Ordinary pre_sales/seller_ops see only immutable 渠道N. Owner/acquisition see real source. New channel is BUYER or SELLER only.

Historical data: no guessed acquisition source. Historical customer/account activation never becomes a new-customer count.

## Current authority after code-integrity cleanup

### Staff permissions
Role defaults minus explicit DENY only. Historical GRANT and Team leader data never expand capability. Team/Department are not file or business authority.

### Multi-persona session safety
Migration 0062 atomically increments customer `session_version` when a second persona is inserted on an existing login. Buyer/Seller/member registration middleware then only reissues the current device cookie at the committed version. Old devices are invalid immediately.

### Post-confirmation order integrity
Abnormal order states are append-only. A non-NORMAL order blocks new Review APPROVED, Buyer Refund Obligation and review-driven Seller service-fee payable creation until RESOLVED. Original order and frozen financial snapshot remain immutable.

### Money safety
Operating-integrity mutations are server-idempotent. Generic adjustment is company-profit only. Advance Buyer principal requires verified proof, auto-settles no more than later refund due, and records excess separately instead of silently creating formal Refund OVERPAID.

### File authority
Advance-principal proof reuses verified internal `BUYER_REFUND_PROOF`; file read still revalidates live Role × Marketplace × Entity.

### Marketplace/time
Raw timestamps UTC. Company reporting business date Asia/Shanghai. Customer/business date follows Marketplace IANA timezone. Current JP Seller page uses Asia/Tokyo while preserving all mature Seller features. Historical US compatibility dates are not presented as local truth when not reliably known.

### Production readiness
`/health` is liveness. `/ready` targets Schema64 and additionally requires scheduler, acquisition maintenance, object storage, valid Cloudflare Access config, valid `APP_RELEASE_SHA`, and Schema64 recovery attestation for the same release SHA.

Local readiness verification is offline. Explicit production network read is `node scripts/probe-production-readiness.mjs`.

## Current migration tail

- 0054 access/channel/marketplace hardening
- 0055 order/review/advance compensation
- 0056 customer identifier + Seller member invitation
- 0057 scoped acquisition machine credentials
- 0058 Marketplace date + recovery attestation
- 0059 Seller member portal store grants
- 0060 Marketplace effective dates
- 0061 post-confirmation integrity guards
- 0062 runtime authority + privilege guards
- 0063 advance-principal proof + overpayment
- 0064 Marketplace local-date truth

Target chain: **0001 → 0064**.

## Critical verification

Use a clean checkout and Node 24:

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

Then run targeted Staff/Buyer/Seller/Acquisition/Admin browser tests and a copy of the real historical D1 through current-production-prefix → 64.

Must verify:
- 0062 second-persona session bump exactly once and first-persona no bump;
- Buyer→Seller and Seller→Buyer existing-account flow on two devices;
- mature Seller withdraw/review/screenshot/settlement/pagination functions are preserved;
- Staff availability/reassign/fallback/batch endpoints are not registered;
- operating-integrity retry with same idempotency key creates no duplicate money/event;
- advance proof link/read and excess-overpayment behavior;
- abnormal order blocks downstream creation until RESOLVED;
- file Role×Marketplace leakage boundaries;
- PRIMARY/SUPPORT queue behavior;
- channel privacy/BOTH/immutable label/source correction;
- distinct attribution anomaly order count vs Buyer/Seller gap counts;
- Marketplace-local date behavior and unknown historical US local date;
- `/ready` fails for stale schema/release/recovery, Access placeholder, stale scheduler/maintenance, excessive backlog or missing R2 authority.

## Explicit stale behavior not to restore

- production Feishu Staff Auth dependency
- Schema43/61 as current target
- `/health` as readiness proof
- ACTIVE personal GRANT expansion or Team leader permission expansion
- availability/fallback/reassignment/batch-transfer Staff runtime endpoints
- Team/Department file authority
- simplified Seller page replacing mature Seller business functions
- extension-resolution `.ts` wrappers / `apps/apps` marker fixtures / PROBE declarations
- non-idempotent money mutations
- generic Seller-principal/service-fee/Buyer-refund adjustment side ledger
- Review APPROVED while order is abnormal
- advance principal without payment proof
- advance auto-settlement beyond refund due
- SUPPORT competing with PRIMARY open queue
- new BOTH channel or mutable 渠道N
- recreating customer when WeChat changes
- second login account merely to add Seller persona
- one global Acquisition machine secret
- China reporting date used as a fake Marketplace-local date

No full green run has been performed by the GitHub-editing assistant. Local Codex must fix real compile/migration/test/browser drift without changing frozen product behavior.
