# LATEST CODEX HANDOFF — 2026-08-11

This file supersedes stale migration/version and operating-flow statements in earlier handoff files on this feature branch.

**Do not redesign the product.** Fix real integration, type, migration, test, accessibility, and browser failures only.

## Branch

`feature/frozen-portals-staff-acquisition-core`

Baseline when work started:

`d621513b8dfe7450e0af7f278cbfb17d9616b00f`

Current target schema version:

**`53`**

## Read first, in this order

1. `docs/OPERATING_INTEGRITY_FREEZE.md`
2. `docs/CUSTOMER_MULTIPERSONA_ONBOARDING_FREEZE.md`
3. `docs/HISTORICAL_CUSTOMER_PORTAL_ONBOARDING_FREEZE.md`
4. `docs/CUSTOMER_REGISTRATION_AND_CHANNEL_DASHBOARD_FREEZE.md`
5. `docs/ACQUISITION_CHANNEL_PRIVACY_FREEZE.md`
6. `docs/FROZEN_PRODUCT_BASELINE.md`
7. `docs/STAFF_ACCESS_CUTOVER.md`
8. this file

If an older test/doc conflicts, update the older test/doc. Do not revert the current frozen behavior merely to satisfy stale assertions.

## Latest customer onboarding acceptance

### New Buyer

Pre-sales saves Buyer Lead → immutable new-buyer intake fact is written immediately → success card may generate Buyer registration link → invite binds to exact Buyer Lead → registration creates/reuses Buyer Customer/account → invite consumption links Buyer Customer to Lead → source attribution remains traceable.

Website registration is independent from new-customer count.

### Historical Buyer

Search existing WeChat → reuse existing Buyer Customer → do not create Lead/channel → do not count new buyer → historical orders remain.

If portal account missing, issue account activation link. If portal account exists, password recovery must use the exact Buyer Customer subject-scoped endpoint, not ordinary Staff WeChat-only reset.

### New Seller

Seller Ops saves Seller Lead → immutable new-seller intake fact is written immediately → **AMAZON_JP Seller Organization is created in the same formal customer-intake transaction** and linked to Seller Lead.

Seller Portal invitation happens afterwards and controls website access only. Issuing or not issuing the website link does not decide whether the Seller is already a formal business customer.

The invite itself does not grant Seller persona. Customer confirmation/password boundary activates the primary OWNER Seller Member / Seller persona.

If WeChat already has a Moonwhite Buyer login, verify the existing password and add `SELLER_MEMBER` persona to that same login. Never create a second login account for the same identity.

Current Seller Portal onboarding is AMAZON_JP only. Do not fake US/KR Seller Portal support.

### Historical Seller

Search WeChat using existing Seller identity plus historical `seller_partner_import_source_records` and any Owner-confirmed manual binding → reuse Seller Organization → never create a second historical organization → historical stores/products/orders/settlements remain.

If identity is ambiguous, fail closed and create an Owner identity-resolution case. Ordinary Staff must not guess.

### Seller invitation lifecycle

Staff can:

- issue
- inspect current status without seeing token
- revoke
- reissue after revoke/expiry

Invitation token remains hash-only. After a Staff page refresh an ACTIVE historical token cannot be recovered as plaintext; Staff must revoke the old invite then create a new link.

### Password recovery

Daily Staff recovery is subject-scoped:

- pre_sales → Buyer only, in assigned Marketplace
- seller_ops → Seller only, in assigned Marketplace
- owner → both
- acquisition / buyer_refund → denied

The old generic WeChat-only reset endpoint is Owner emergency compatibility only.

## Operating integrity acceptance — 12 frozen fixes

`docs/OPERATING_INTEGRITY_FREEZE.md` is authoritative. In particular:

1. new customer counts come from immutable `acquisition_customer_intake_facts`, not current ACTIVE Lead state;
2. precision cutover separates normal historical unknown source from post-cutover attribution anomaly;
3. password recovery is customer/role/Marketplace scoped;
4. Seller business subject exists independently of Seller Portal registration;
5. Seller invite lifecycle includes safe status/revoke/reissue;
6. multiple Staff may cover one Role×Marketplace; exactly one ACTIVE PRIMARY, others SUPPORT;
7. Owner has audited historical identity conflict resolution;
8. source correction is append-only; reporting uses latest confirmed source while original remains;
9. consultation missing is not zero; completeness is explicit;
10. Buyer-source and Seller-source profits are separate attribution views and must never be summed as company profit;
11. Owner has only a minimal operating-integrity anomaly center, not a new ERP/task system;
12. Lead active uniqueness is `lead_type × marketplace_code × identity_hash`, and Seller global customer grouping is prepared for future Marketplace expansion.

## Channel privacy

Ordinary pre-sales/seller-ops responses contain only anonymous `渠道N` source labels. They must not receive real platform, real source name, source URL, CODEX/HUMAN origin, AI score, Signal details, or Prospect research data.

Owner/acquisition may see full source details.

A disabled channel remains visible in historical Owner/acquisition reporting; disabling affects future intake only.

## Dashboard acceptance

Owner dashboard separates:

- 新增买家客户
- 新增卖家客户
- 买家网站注册
- 卖家网站开通
- 新增正式订单
- 历史客户 / 来源未知（normal historical category）
- 新系统归因异常（error requiring attention）
- identity conflicts
- finance conflicts
- per-day Buyer/Seller channel new customers/orders

Portal activation is based on successful invitation consumption date.
Historical portal activation never increments new-customer counts.

Past new-customer counts must remain stable after Lead invalidation/anonymization or Channel disable.

## Staff management acceptance

Owner still sees one simple Staff account page.

No scheduling/team/availability system is added.

For each Role×Marketplace:

- first active coverage is PRIMARY / 主负责人
- later coverage is SUPPORT / 协助
- only one ACTIVE PRIMARY is allowed
- disabling the PRIMARY promotes an active SUPPORT when available
- re-enabling a lone SUPPORT restores PRIMARY if the slot has no active PRIMARY

## Database migrations added by operating-integrity pass

- `0051_business_integrity_reporting_scope.sql`
- `0052_identity_resolution_and_reporting_ops.sql`
- `0053_operating_integrity_guards.sql`

Target migration chain is now **0001 → 0053**.

## Required local verification

Run from a clean checkout with Node 24:

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

Also run/update targeted tests for:

- migrations 0051–0053
- immutable intake after Lead invalidation and Channel disable
- precision boundary + historical exemptions + post-cutover anomalies
- same protected identity across different Marketplaces, while same Marketplace duplicate still fails
- scoped Buyer/Seller password recovery permissions and multi-persona warning/behavior
- Seller Organization created at formal Seller intake, not invitation issuance
- Seller invite current-state / revoke / reissue
- Owner identity conflict report/search/resolve/manual binding
- append-only source correction and effective reporting source
- consultation missing vs explicit zero
- disabled-channel historical reporting
- split Buyer-source/Seller-source profit attribution with company profit counted only once
- PRIMARY/SUPPORT staff behavior

Use a copy of the real historical D1 dataset for an upgrade dry-run before production. Confirm all historical Buyer Customer IDs, Seller Organization IDs, Order IDs, store/product/order relations, and financial facts remain unchanged.

## Explicit prohibitions

Do not restore any of these stale behaviors to make old tests pass:

- ACTIVE Lead count as historical new-customer total
- disabling Channel erases historical performance
- post-cutover missing source treated as ordinary historical unknown
- ordinary Staff WeChat-only password reset
- Seller Organization created only when Seller invite is issued
- one and only one Staff total per Role×Marketplace
- direct overwrite of source attribution without correction history
- missing consultation silently treated as zero
- Buyer-source + Seller-source channel profit summed as company profit
- global Lead uniqueness across all Marketplaces

Do not merge `main` and do not deploy production until all local verification failures are resolved and the owner explicitly approves.
