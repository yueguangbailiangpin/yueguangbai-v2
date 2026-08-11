# LATEST CODEX HANDOFF — 2026-08-11

This file supersedes stale migration/version and operating-flow statements in every earlier handoff file on this feature branch.

**Do not redesign the product.** Fix real integration, type, migration, test, accessibility, historical-data-upgrade, and browser failures only.

## Branch

`feature/frozen-portals-staff-acquisition-core`

Baseline when work started:

`d621513b8dfe7450e0af7f278cbfb17d9616b00f`

Current target schema version:

**`61`**

## Read first, in this order

1. `docs/SECOND_LAYER_HARDENING_FREEZE.md`
2. `docs/OPERATING_INTEGRITY_FREEZE.md`
3. `docs/CUSTOMER_MULTIPERSONA_ONBOARDING_FREEZE.md`
4. `docs/HISTORICAL_CUSTOMER_PORTAL_ONBOARDING_FREEZE.md`
5. `docs/CUSTOMER_REGISTRATION_AND_CHANNEL_DASHBOARD_FREEZE.md`
6. `docs/ACQUISITION_CHANNEL_PRIVACY_FREEZE.md`
7. `docs/FROZEN_PRODUCT_BASELINE.md`
8. `docs/STAFF_ACCESS_CUTOVER.md`
9. this file

If an older test/doc conflicts, update the older assertion. Do not restore stale behavior merely to make tests pass.

## Product foundation that must remain

### Buyer

产品 / 任务 / 我的 only. Invite registration. Historical Buyer reuses the existing Buyer Customer and opens only portal access; it never becomes a new customer again.

### Seller

Formal Seller customer intake and Seller Portal registration are separate. Amazon JP Seller Organization is created at formal intake; website registration only activates portal identity. Seller OWNER may now invite OPERATIONS / FINANCE / VIEWER members with explicit store scope. Same WeChat reuses an existing Moonwhite login after password confirmation instead of creating a second login account.

### Staff

Cloudflare Access proves Staff email. Moonwhite active Staff + one role + Marketplace scope is final authority. PRIMARY handles the open operational queue; SUPPORT retains normal Marketplace business visibility but does not compete for the same OPEN queue.

### Acquisition

Channel → Prospect(optional) → formal customer → order → profit. Ordinary pre_sales/seller_ops receive only immutable anonymous `渠道N`. Owner/acquisition see real sources. New operational channels are BUYER or SELLER only; historical BOTH is reporting-only compatibility.

## First operating-integrity pass

`docs/OPERATING_INTEGRITY_FREEZE.md` remains authoritative for the original 12 fixes: immutable intake facts, precision cutover, scoped password recovery, Seller Organization separation, invitation lifecycle, PRIMARY/SUPPORT, identity conflict resolution, append-only source correction, consultation completeness, split Buyer/Seller attribution profit views, minimal Owner anomaly center, and Marketplace-aware Lead uniqueness/Seller groups.

## Second-layer 14 hardening acceptance

`docs/SECOND_LAYER_HARDENING_FREEZE.md` is the highest-priority authority for these areas:

1. production Staff auth/config is Cloudflare Access, not Feishu Staff Auth;
2. current release requires Schema 61 D1 + R2 recovery rehearsal and immutable recovery attestation;
3. `/health` is liveness only; `/ready` is the production gate;
4. Scheduler + Acquisition Maintenance must be enabled and recently successful;
5. active personal permission GRANT overrides are forbidden; role is capability authority and overrides are DENY-only;
6. explicit file reads use current Role × Marketplace × Entity authority, not legacy Team/Department expansion;
7. post-confirmation order failures are append-only operational events plus signed financial compensation, never rewrites of confirmed order/snapshot;
8. post-approval review visibility is separate from approval, and advance buyer principal is a separate ledger automatically settled into the later formal refund obligation;
9. SUPPORT does not see/compete for the PRIMARY open work queue;
10. new acquisition channels cannot be BOTH, and `渠道N` is immutable;
11. Owner can change a customer's login WeChat while preserving Buyer/Seller/order identity and revoking old sessions;
12. Seller OWNER can invite scoped OPERATIONS/FINANCE/VIEWER members;
13. Acquisition machines use per-Agent secret hash + Marketplace/channel scope + hourly rate limit + revoke lifecycle; the old global shared secret is not runtime authority;
14. canonical Marketplace + local business timezone are separated from company reporting timezone.

## Current migration tail

- `0054_access_channel_marketplace_hardening.sql`
- `0055_order_review_advance_compensation.sql`
- `0056_customer_identifier_seller_members.sql`
- `0057_acquisition_machine_credentials.sql`
- `0058_marketplace_dates_recovery_attestation.sql`
- `0059_seller_member_portal_grants.sql`
- `0060_marketplace_effective_dates.sql`
- `0061_post_confirmation_integrity_guards.sql`

Target chain: **0001 → 0061**.

## Critical end-to-end flows to verify

### New / historical customer onboarding

- New Buyer intake writes immutable new-customer fact; registration remains separate.
- Historical Buyer opens existing account only; no new Lead/channel/customer count.
- New Seller intake creates Seller Organization immediately; portal activation later.
- Historical Seller reuses existing organization.
- Duplicate and ambiguous identities fail closed.
- Customer WeChat change keeps the same business subject/order history and invalidates old login sessions.

### Seller members

- OWNER can issue one-time hashed member invite for OPERATIONS/FINANCE/VIEWER and active stores only.
- Existing Buyer/Moonwhite login must verify the existing password and gain Seller persona on the same account.
- New identity creates account only after customer completes invite.
- New `seller_member_portal_store_grants` and legacy store scopes both resolve correctly.
- Cross-organization store grants must fail at DB boundary.

### Order/review/refund integrity

- Staff can find the exact formal order by Amazon order number only within current Marketplace authority.
- Seller Ops/Owner can append platform cancellation / return-refund / business void / investigation / resolved events without rewriting the formal order.
- Owner financial adjustment is append-only and Owner company profit totals apply PROJECTED/COMPLETED profit adjustments.
- Review visibility observation can be inserted only when review status is APPROVED.
- Advance principal can be paid only before a formal refund obligation.
- Advance payment reversals cannot exceed payment and cannot reverse a settled advance payment.
- When review approval later creates the formal refund obligation, remaining advance principal automatically becomes formal Buyer Refund PAYMENT rows exactly once.
- Fully satisfied obligations do not remain in the OPEN refund work queue.

### File authorization

Test Buyer, Seller, owner, pre_sales, seller_ops, buyer_refund and cross-Marketplace cases for review evidence, order chat/evidence, product/application images and settlement proof. Legacy Team membership must not expand new explicit-audience Staff access. Current Role permission + Marketplace + entity ownership must be authoritative.

### Acquisition

- New channel accepts BUYER or SELLER only.
- pre_sales/seller_ops never receive historical BOTH channels.
- `staff_label` cannot be changed after creation; receiving WeChat can be changed.
- source correction remains append-only.
- consultation missing is not zero.
- Acquisition Core active UI is V4.
- Owner creates Agent secret once, scopes it to Marketplaces/channels, can revoke it.
- machine create/signal/analysis all enforce machine scope and hourly limit.

### Marketplace/time

- Current real JP scheduling timezone is Asia/Tokyo.
- Owner company reporting remains Asia/Shanghai.
- formal orders expose canonical Marketplace authority.
- `formal_order_effective_dates` provides reporting date + Marketplace-local date.
- future non-AMAZON_JP formal-order inserts without explicit local Marketplace business date fail closed.

### Production/readiness/recovery

- production template requires Cloudflare Access settings, scheduled operations=true, acquisition maintenance=true.
- GitHub production monitor probes `/ready`, not `/health`.
- `/ready` requires Schema 61, recent required scheduler success, recent acquisition maintenance success, object storage read authority, and recovery attestation schema>=61.
- Owner recovery-attestation API accepts only current Schema 61 and all real pass booleans.
- recovery rehearsal must cover Schema 61 D1 + R2 manifest/read-back; old Schema 39/43/53/58 proof is stale.

## Required clean-checkout verification

Use Node 24 and a clean checkout:

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
npm run build --workspace @ygb/web
npm run test:staff-acquisition:browser
npm run test:admin-dashboard:browser
npm test
npm run build
```

Also run/update targeted tests for migrations 0051–0061, old-production-prefix → 61 upgrade, Cloudflare Access cutover, file authorization, PRIMARY/SUPPORT queue visibility, order compensation, review visibility, advance-principal settlement/double-payment protection, WeChat change, Seller member invitations/multi-persona reuse, channel label/BOTH rules, machine credentials/scopes/rate limits, Marketplace local dates, `/ready`, and recovery attestation.

Use a copy of the real historical D1 dataset for the upgrade dry-run. Confirm historical Buyer Customer IDs, Seller Organization IDs, Store/Product/Order IDs, financial snapshots, file links, and historical relationships remain unchanged.

## Explicit prohibitions

Do not restore any of these stale behaviors to make tests pass:

- production Feishu Staff Auth dependency
- Schema 39/43/53/58 as current target
- `/health` as production readiness proof
- disabled production scheduler/acquisition maintenance
- ACTIVE personal permission GRANT expansion
- Team/Department as authority for new explicit file reads
- editing/deleting confirmed orders or frozen snapshots to handle later cancellation/refund
- rewriting Review APPROVED to represent dropped/not-shown review
- treating advance principal as a normal refund before obligation exists
- SUPPORT competing with PRIMARY for the same open work queue
- new BOTH acquisition channels
- mutable `渠道N`
- recreating customer when WeChat changes
- second login account for same identity merely to add Seller persona
- one global Acquisition machine secret
- company Beijing reporting timezone reused as future Marketplace local date

Do not merge `main`, run production migrations, or deploy production until all local verification failures are resolved and the owner explicitly approves.
