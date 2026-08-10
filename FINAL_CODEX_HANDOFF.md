# FINAL CODEX HANDOFF — Frozen Buyer / Seller / Staff / Acquisition Core

This file supersedes any earlier handoff note on this branch.

## Branch

`feature/frozen-portals-staff-acquisition-core`

Baseline used when implementation started:

`d621513b8dfe7450e0af7f278cbfb17d9616b00f`

## Product source of truth

Read **before touching code**:

1. `docs/FROZEN_PRODUCT_BASELINE.md`
2. `docs/STAFF_ACCESS_CUTOVER.md`
3. this file

Do **not** reinterpret or redesign Buyer, Seller, Staff, Staff roles, Marketplace scope, Acquisition Core, channel attribution, Cloudflare Access login, or Codex machine boundaries.

Your job is integration/testing: fix concrete compile, migration, contract, browser, accessibility, repository-drift and regression defects only.

## Migrations

New migrations on this branch are now:

- `0044_staff_marketplace_acquisition_core.sql`
- `0045_frozen_staff_acquisition_invariants.sql`
- `0046_acquisition_attribution_link_trigger.sql`
- `0047_staff_work_item_marketplace_derivation.sql`

Apply **through 0047**.

Required migration tests:

1. fresh database from migration 0001 through 0047;
2. realistic copy at schema 0043 upgraded through 0047;
3. verify the current ordinary Staff roles backfill to `AMAZON_JP`;
4. verify one active primary Staff per `Role × Marketplace`;
5. verify out-of-scope Staff work items are not returned;
6. verify Prospect → Lead source mismatch is rejected;
7. verify first-touch customer attribution is inserted once when Lead links to Buyer Customer or Seller Organization;
8. verify existing Staff sessions are revoked by the auth cutover;
9. verify `0047` Marketplace derivation against the actual `seller_store_marketplaces` and `buyer_marketplace_assignments` schema. If an old schema name differs, fix the migration/service to use the real existing table/column — do not weaken Marketplace isolation.

## Static / build sequence

Run the repository's pinned Node/package-manager workflow. At minimum:

1. install/restore dependencies;
2. TypeScript/typecheck all workspaces;
3. unit/integration tests;
4. migration tests;
5. Buyer E2E;
6. Seller E2E;
7. Staff E2E;
8. build;
9. full repository `npm run check` (or the repository's equivalent final gate).

Do not stop after the frontend compiles.

## Buyer acceptance

Frozen primary nav: **产品 / 任务 / 我的**.

- `/buyer` enters products.
- Products use S3 compact list, 6 local rows/page, search/filter/local pagination and backend cursor.
- Do not invent a thumbnail backend field.
- Task center aggregates real reservation/order-evidence/review/refund facts.
- System-processing items are visually separate and do not count as buyer actionable work.
- M2 business center remains under 我的.
- Existing product → reservation → instruction → evidence → formal order → review → refund flow remains functional.

Update obsolete tests that still expect the old five-item Buyer navigation. Do not restore the old navigation to make tests pass.

## Seller acceptance

Seller stays the existing real V1 professional desktop console.

- Seller green visual identity.
- Existing product/demand/order/review/settlement logic remains intact.
- Order Business Completion keeps all four: 评论 / 买家返款 / 卖家本金 / 卖家服务费.
- Buyer refund is not hidden.

The final CSS layer is `apps/web/src/styles/design-freeze.css`; browser-check selector coverage instead of rebuilding Seller markup unnecessarily.

## Staff authentication acceptance

Active production composition is Cloudflare Access + Email OTP → Moonwhite Staff Session.

Required:

- Feishu login/workbench routes are not registered in active `apps/api/src/index.ts` composition.
- missing Access assertion is rejected;
- bad signature is rejected;
- wrong issuer is rejected;
- wrong audience is rejected;
- expired token is rejected;
- valid RS256 Access JWT with an ACTIVE bound email can bootstrap a Staff session;
- valid Cloudflare email with Moonwhite `DISABLED` Staff is rejected;
- email / role / Marketplace / status change revokes old Moonwhite sessions;
- last active Owner cannot be disabled/demoted.

Do not deploy this auth cutover before completing `docs/STAFF_ACCESS_CUTOVER.md` and binding the real primary Owner email.

## Staff role/navigation acceptance

Five roles:

- owner = 总管理员
- acquisition = 获客
- pre_sales = 售前
- seller_ops = 卖家对接
- buyer_refund = 买家返款

Navigation must project exactly as frozen:

Owner:
- 工作队列
- 客户开发
- 买家客户
- 卖家客户
- 产品库
- 经营看板
- 本金汇率策略
- 员工管理

Acquisition:
- 客户开发 only

Pre-sales:
- 工作队列
- 买家客户
- 产品库

Seller Ops:
- 工作队列
- 卖家客户
- 产品库
- 本金汇率策略

Buyer Refund:
- 工作队列 only

Do not reintroduce daily UI for task reassign, availability, Team/Department, raw permission checkboxes, Marketplace fallback, SLA/high-risk queues, or a Staff message center.

## Marketplace authorization acceptance

Server-side rule:

> Role decides what. Marketplace decides where.

Test copied/direct URLs and raw API calls, not only hidden navigation.

At minimum create test Staff for:

- pre_sales + AMAZON_JP
- pre_sales + AMAZON_US
- seller_ops + AMAZON_JP
- seller_ops + AMAZON_US
- buyer_refund + AMAZON_JP
- buyer_refund + AMAZON_US

A US-only employee must not receive JP data.

Audit all Staff read/write surfaces touched by the frozen UI, especially:

- work queue;
- catalog/product routes;
- buyer customer/lead routes;
- seller customer/lead routes;
- order evidence;
- review;
- buyer refund;
- Seller principal-rate reads/writes;
- dashboard drill-downs.

If any existing route still relies only on legacy assignment/team scope, extend its **server-side** Marketplace scope. Frontend-only hiding is not acceptable.

## W1 Staff workbench acceptance

`FrozenStaffWorkbench.tsx` is the frozen structure:

- left: queue;
- middle: business facts/evidence;
- right: current customer + current actions + collapsed audit.

Queue only needs:

- 待处理;
- 已完成;
- type filter.

Customer invitation/password-reset tools belong under 买家客户, not the W1 right pane.

Sensitive confirmations:

- buyer refund payment;
- refund reversal;
- Staff disable;
- principal-rate confirmation.

Normal review/reservation/product approvals should not gain unnecessary confirmation dialogs.

Static-check `FrozenStaffWorkbench.tsx` carefully against the real query-key API and real Staff DTO schemas. Fix implementation names/types without changing the W1 product structure.

## Staff management acceptance

Owner-facing UI is one simple page:

- 姓名;
- 登录邮箱;
- 岗位;
- 负责 Marketplace;
- ACTIVE/DISABLED;
- 最后登录.

No Team or raw permission UI.

Creating/editing Staff must respect one active primary employee per `Role × Marketplace` for non-owner roles.

Cloudflare allow-list remains manual because the team is intentionally small.

## Acquisition Core acceptance

One shared core for Buyer and Seller:

`Channel → Prospect (optional) → Lead → Customer → Order → Profit`

### Responsibilities

- acquisition / future Codex finds or attracts customers;
- pre_sales only creates/handles formal Buyer Lead after WeChat is established;
- seller_ops only creates/handles formal Seller Lead after contact/WeChat is established.

Pre-sales must not be able to create Seller Lead.
Seller Ops must not be able to create Buyer Lead.

### Channel

Owner configures platform name + audience + Marketplace as data. Future TikTok/X/知无不言/BOSS platforms should normally not require enum/code changes.

### Prospect / handoff

Prospect can be HUMAN or CODEX.

Acquisition/Owner can mark `HUMAN_HANDOFF`.
Buyer handoff appears to Pre-sales in the matching Marketplace.
Seller handoff appears to Seller Ops in the matching Marketplace.

Creating formal Lead from a Prospect must inherit:

- original channel;
- original source URL;
- HUMAN/CODEX origin mode;
- Marketplace.

### Attribution

`acquisition_customer_attributions` is durable first-touch attribution.

Per-channel stats must be channel-specific facts; never repeat one global funnel total for every channel.

Test Buyer and Seller channel paths through downstream customer/order/profit attribution.

## Codex machine boundary

Machine routes are intentionally separate under `/api/acquisition-machine/*`.

Required machine headers/secrets:

- Bearer `ACQUISITION_MACHINE_SHARED_SECRET`;
- stable `X-Moonwhite-Machine-Id`;
- idempotency key where required.

Allowed:

- create Prospect;
- add public-information Signal;
- update AI score/research state.

Not allowed:

- Moonwhite Staff session;
- orders;
- finance;
- buyer refunds;
- Staff/permissions;
- direct formal customer conversion.

Human handoff is the boundary into formal customer business.

## Principal-rate confirmation

A wrapper exists at:

`apps/web/src/staff/pricing/FrozenSellerPrincipalRatePolicyWorkspace.tsx`

Ensure `StaffRouteModule.tsx` routes the principal-rate page through this confirmation boundary. Do not redesign the underlying principal-rate business component.

## Legacy compatibility code

Some old Feishu/assignment source files remain in the repository because broad deletion is higher regression risk than leaving inactive code during the cutover.

Do not reactivate them.

Only delete legacy files if the full test suite proves the removal safe and the active composition remains exactly aligned to the frozen product.

## Stop conditions

Do not merge to `main` automatically.
Do not deploy production automatically.
Do not invent production Owner email or Cloudflare credentials.

If a real fix requires changing a frozen product rule rather than correcting implementation drift, stop and report the conflict.
