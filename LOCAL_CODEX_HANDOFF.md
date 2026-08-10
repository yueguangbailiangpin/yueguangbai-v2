# Local Codex Handoff — Frozen Portals + Staff Acquisition Core

Branch:

`feature/frozen-portals-staff-acquisition-core`

Baseline main SHA used when work started:

`d621513b8dfe7450e0af7f278cbfb17d9616b00f`

## Your job

You are the **integration/test owner**, not the product designer.

Read first:

1. `docs/FROZEN_PRODUCT_BASELINE.md`
2. `docs/STAFF_ACCESS_CUTOVER.md`

Do not redesign Buyer / Seller / Staff / Acquisition Core.  Fix only real compile, migration, API-contract, browser, accessibility, regression and deployment-environment defects.

## Required sequence

1. Update local `main` and inspect drift from the baseline above.
2. Check out this feature branch.
3. Install repository dependencies using the repository's pinned package manager / Node requirements.
4. Apply every migration to a fresh scratch database, including `0044`, `0045`, `0046`.
5. Apply the migrations to a copy of realistic pre-0044 data and verify invariants/backfills.
6. Run TypeScript/typecheck for every workspace.
7. Run unit/integration tests.
8. Run Buyer browser tests.
9. Run Seller browser tests.
10. Run Staff browser tests, including all five roles and Marketplace isolation.
11. Run build.
12. Run the repository's full `npm run check` / equivalent final gate.

## Mandatory acceptance cases

### Buyer

- Primary nav is only 产品 / 任务 / 我的.
- `/buyer` enters 产品.
- Product page shows 6 local rows/page and does not invent a thumbnail backend field.
- Task center separates actionable tasks from system-processing items.
- System-processing items do not count as buyer actionable N.
- Existing reservation → instruction → order evidence → formal order → review → refund flow still works.

### Seller

- Existing Seller business flows still pass.
- V1 professional Seller layout remains desktop-first and green.
- Order business-completion still contains 评论 / 买家返款 / 卖家本金 / 卖家服务费.

### Staff authentication

- Active Staff composition does not expose the Feishu login/workbench routes.
- Access bootstrap rejects missing/invalid `Cf-Access-Jwt-Assertion`.
- Access bootstrap rejects wrong issuer/AUD/expired JWT.
- Access bootstrap accepts a correctly signed JWT for an ACTIVE bound email.
- DISABLED Staff cannot establish a Moonwhite Staff session even if Cloudflare Access accepted the email.
- Email/role/Marketplace/status changes revoke old Staff sessions.
- Last active Owner cannot be disabled/demoted.

### Marketplace authorization

Test at least two Staff records:

- `pre_sales + AMAZON_JP`
- `pre_sales + AMAZON_US`

The US employee must not receive JP Buyer/customer/work-item facts, including direct URL/API access.  Repeat equivalent coverage for Seller Ops and Buyer Refund where practical.

One active primary Staff per `Role × Marketplace` must be enforced.

### Staff role/navigation

- owner: queue / acquisition / buyer customers / seller customers / products / dashboard / principal rate / staff management
- acquisition: acquisition only
- pre_sales: queue / buyer customers / products
- seller_ops: queue / seller customers / products / principal rate
- buyer_refund: queue only

No task-reassign / availability / Team / raw-permission UI should be reintroduced.

### Acquisition Core

- Owner can configure channels.
- Acquisition role can record daily consultation counts and work with Prospects.
- Pre-sales cannot create Seller Lead.
- Seller Ops cannot create Buyer Lead.
- Lead must explicitly have Marketplace and source Channel.
- Prospect handoff → formal Lead inherits source Channel, source URL and HUMAN/CODEX origin mode.
- Customer attribution is first-touch and not duplicated.
- Per-channel stats return channel-specific facts, not repeated global totals.

### Codex machine boundary

- machine secret is required.
- machine API can create Prospect/add Signal/update allowed research status.
- machine API cannot obtain a Staff session.
- machine routes cannot execute order/refund/staff/financial mutations.

## Known integration areas to inspect carefully

The feature branch deliberately preserves some old Feishu source files and old assignment infrastructure as **inactive compatibility code**.  The active API composition no longer registers them.  Remove dead compatibility files only if doing so is proven safe by the full test suite; do not restore them to active production behavior.

Marketplace was historically JP-only in many older flows.  Audit every Staff read/write API touched by catalog/order/review/refund/business dashboard to confirm out-of-scope Marketplace data cannot leak.  Where a route already resolves `StaffDataScope`, prefer extending that server-side enforcement rather than adding frontend-only hiding.

Several legacy tests were written for four roles, Feishu binding, Team UI, and old Buyer navigation.  Update those tests to the frozen product baseline; do not change the product back to satisfy obsolete expectations.

## Stop conditions

Do not merge to `main` and do not deploy production automatically.

Stop and report if any fix would require changing a frozen product rule rather than correcting implementation drift.

Before any production deployment, complete `docs/STAFF_ACCESS_CUTOVER.md` so the Owner is not locked out after the authentication cutover.
