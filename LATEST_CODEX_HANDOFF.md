# LATEST CODEX HANDOFF — 2026-08-11

This file supersedes stale migration/version statements in earlier handoff files on this feature branch.
Do not redesign the product. Fix only real integration, type, migration, test, and browser failures.

## Branch

`feature/frozen-portals-staff-acquisition-core`

Baseline when work started:

`d621513b8dfe7450e0af7f278cbfb17d9616b00f`

Current target schema version:

`50`

## Read first

1. `docs/HISTORICAL_CUSTOMER_PORTAL_ONBOARDING_FREEZE.md`
2. `docs/CUSTOMER_REGISTRATION_AND_CHANNEL_DASHBOARD_FREEZE.md`
3. `docs/ACQUISITION_CHANNEL_PRIVACY_FREEZE.md`
4. `docs/FROZEN_PRODUCT_BASELINE.md`
5. `docs/STAFF_ACCESS_CUTOVER.md`
6. this file

If older docs/tests conflict, update the older test/doc; do not revert frozen behavior.

## Latest customer onboarding acceptance

### New Buyer

Staff pre-sales saves Buyer Lead → counts new buyer immediately → same success card generates Buyer registration link → invitation is bound to the exact saved Buyer Lead → buyer registration creates/reuses Buyer Customer/account → invitation consumption links Buyer Customer to Lead for source attribution.

### Historical Buyer

Search existing WeChat → reuse existing Buyer Customer → if portal account missing, issue account activation link using the existing Buyer invitation flow → do not create Lead/channel → do not count new buyer → historical orders remain.

### New Seller

Seller ops saves Seller Lead → counts new seller immediately → same success card generates Seller registration link → creates Seller Organization + primary OWNER member and links organization to Seller Lead → customer sets password → creates SELLER_MEMBER login → enters Seller Portal.

Current Seller registration is AMAZON_JP only because the real Seller Portal business contracts are still JP-first. Do not claim US/KR seller portal support.

### Historical Seller

Search WeChat using both existing member identity and historical `seller_partner_import_source_records` → reuse Seller Organization → if organization already has portal account show already open → otherwise reuse/create primary OWNER member and issue activation link → do not create new organization or acquisition Lead → historical stores/products/orders/settlements remain.

### Duplicate protection

Direct POST to new acquisition Lead must be rejected when WeChat already belongs to existing Buyer/Seller or imported historical Seller.

## Channel privacy

Ordinary pre-sales/seller-ops responses must contain only anonymous `渠道N` labels. They must not contain platform name, real channel name, source URL, CODEX/HUMAN origin, AI score, signal details, or Prospect IDs.
Owner/acquisition may see full source details.

## Dashboard acceptance

Owner dashboard separates:

- 新增买家客户
- 新增卖家客户
- 买家网站注册
- 卖家网站开通 (primary seller organization portal activation, not every future member)
- 新增正式订单
- per-day buyer/seller channel new customers and formal orders
- buyer/seller unattributed historical order counts

Historical customer activation must never increment new-customer counts.

## Required local verification

Run from a clean checkout of this branch with Node 24:

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

Also add/fix targeted tests for migrations 0048-0050, new/historical Buyer onboarding, new/historical Seller onboarding, duplicate guards, source privacy, and dashboard date attribution.

Use a copy of a real historical D1 dataset for an upgrade dry-run before production. Verify that historical customer IDs and order relationships do not change.

Do not merge main and do not deploy production until all failures are resolved and the owner explicitly approves.
