# Verification Evidence: Staff Portal Visual Refresh

## 1. Reproducible Baseline

- Worktree: `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/staff-portal-visual-refresh`
- Branch: `feature/staff-portal-visual-refresh`
- Starting `HEAD` and `origin/main`: `3f94b0ce5fd96be0ff5e5be548ace694226e1eda`
- Starting state: clean
- Node: `v24.18.1`; npm: `11.16.0`
- Lockfile SHA-256: `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`
- Approved direction: `/Users/yueguangbai/.codex/generated_images/019fdc86-c749-7d53-9b82-e77dad8bd8a7/exec-61e0d009-8640-4afe-be1b-b297903d944e.png`
- `NO_SCHEMA_CHANGE`; no API/Contract/Domain/Migration/Schema/dependency/permission/session/cache/file/Buyer/Seller/production/external change is authorized.

Initial baseline build history:

1. `npm run build --workspace @ygb/web` failed before dependency restoration because `tsc` was unavailable.
2. `npm ci --cache .task-cache/npm` restored 225 packages from the committed lockfile with 0 vulnerabilities and no manifest/lockfile change. The temporary 102 MB cache was removed before handoff.
3. The repeated production build passed.

Exact `gzip -9` baseline:

| Asset boundary | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Initial entry | 245,731 | 74,341 |
| CSS | 66,191 | 11,556 |
| Staff route | 76,844 | 19,425 |
| Staff admin route | 12,527 | 4,111 |
| Staff scheduling route | 19,768 | 5,980 |

## 2. Frozen Scope and Authority

- Staff login, protected shell, queue/detail/actions, customer-security tools, acquisition, product/version/reservation scheduling, and owner dashboard presentation only.
- Existing trusted Staff Session, four canonical roles, effective permission projection, backend Scope, Personal DENY, leader package, versions, idempotency, query keys, cache cleanup, protected files, integer money, audit and archive boundaries remain the only authority.
- `/staff/acquisition` remains bookmarkable; owner/pre_sales/seller_ops see it only with the matching returned permission, and buyer_refund never receives its navigation entry.
- The owner dashboard entry remains owner plus `FINANCIAL_VIEW`; projected and completed profit remain separate returned facts.
- `tokens.css` is unchanged and remains the only design truth. No dependency, framework, font, manifest, lockfile, Buyer/Seller runtime, API, Contract, Domain, Migration, Schema, permission, production, or external-resource change was made.

## 3. Screenshot Matrix and Per-image Review

The Contract-valid deterministic fixture in `apps/web/e2e/staff-visual-refresh.spec.ts` fixes locale `zh-CN`, timezone `Asia/Shanghai`, light mode, reduced motion, clock, four Staff Sessions, permissions, scoped IDs, queue/detail, acquisition, product/schedule and dashboard endpoint responses. It makes no production or external request.

- Before: `references/visuals/before`, 26 PNGs, 4,166,040 bytes, aggregate manifest SHA-256 `cfe07f2a6355b5540418060cda385c100d3a2d6a0190c41603c010f764a10e51`.
- After: `references/visuals/after`, 26 PNGs, 3,854,209 bytes, aggregate manifest SHA-256 `a6aaa547e8d04520127f620050a6935b796573f13aad40e7057dc2bf45b92510`.
- Login, workbench, acquisition, products, product detail, reservation schedule, and dashboard are compared at 390x844 and 1440x900. Workbench, acquisition, reservation schedule and dashboard additionally cover 320x800, 768x1024 and 1600x1000.
- All 26 after images were reviewed in viewport contact sheets; every 390, 768 and representative 1440/1600 original was also opened at full resolution. Each image passed hierarchy, Chinese wrapping, fact/action truthfulness, primary-action visibility, no forbidden identifiers/secrets, and no document-level horizontal overflow.
- The first before capture truthfully failed at 390px with an existing approximately 700px product-detail document width. Before evidence capture then skipped only the overflow assertion. The first after capture reproduced 696px product-detail width; the single implicit grid track was made shrinkable, and the repeated 26-image after run passed.
- The before set shows repeated full page headers, a horizontal desktop navigation and sparse independent cards. The after set shows the approved desktop rail, compact role/Beijing-time context, dense queue → detail → controlled-action hierarchy, compact acquisition/scheduling/dashboard work areas, and the same semantic order on narrow screens.
- Controller review required removal of the Staff dashboard's 36px Button override. The deterministic fixture confirmed pixel changes only on the five dashboard after images at 320/390/768/1440/1600; only those five evidence files were replaced and individually reviewed. The other 21 after images were not changed.

## 4. Roles, Security, Accessibility, and Isolation

- Dedicated navigation assertions passed for owner, pre_sales, seller_ops and buyer_refund. Expected entries were respectively 4, 3, 3 and 1; buyer_refund had no acquisition/product/dashboard navigation.
- Existing backend/security suites passed for role consolidation (72/72), acquisition (25/25 plus maintenance dry-run 2/2), product scheduling (73/73), and dashboard (21/21). Their browser suites passed 2/2, 3/3 and 2/2 respectively.
- Focused Staff/Auth Vitest passed 50/50. The new visual/role/accessibility/isolation browser suite passed 4/4.
- Existing foundation and Staff workbench browser coverage passed Session/401/403/concealed 404/503, identity mismatch and cache cleanup, ordinary/logout-all flows, customer invitation/recovery password blindness, queue/detail/action order, exact mutation retry, direct deep links, 200% text, reduced motion and route chunk isolation in the final complete browser run.
- The deterministic matrix verifies 320/390/768/1440/1600, no document overflow, visible keyboard focus, at least 44px interactive targets, reduced motion and 200% acquisition reflow. All returned epoch times are presented as Beijing time; date-only values remain date-only; projected/completed CNY facts remain separate; forbidden object/storage/token/password field names are absent.
- The post-review Staff visual assertion waits for all six dashboard detail controls and verifies each computed height is at least 44px at both 390x844 and 1440x900. The targeted assertion passed 1/1 and the existing owner/non-owner dashboard browser suite passed 2/2.
- A cold `/staff` loaded no Buyer, Seller, Staff admin or Staff scheduling page chunk. Existing route-isolation coverage also confirmed Staff/Buyer/Seller protected chunk separation and deferred Staff dashboard/scheduling chunks.

## 5. Production Build Comparison

Exact comparable `gzip -9` results:

| Asset boundary | Before raw | After raw | Raw delta | Before gzip | After gzip | Gzip delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial entry | 245,731 | 245,680 | -51 (-0.02%) | 74,341 | 74,208 | -133 (-0.18%) |
| CSS | 66,191 | 70,890 | +4,699 (+7.10%) | 11,556 | 12,237 | +681 (+5.89%) |
| Staff route | 76,844 | 79,530 | +2,686 (+3.50%) | 19,425 | 20,203 | +778 (+4.01%) |
| Staff admin route | 12,527 | 12,527 | 0 | 4,111 | 4,108 | -3 (-0.07%) |
| Staff scheduling route | 19,768 | 19,768 | 0 | 5,980 | 6,012 | +32 (+0.54%) |

The final Vite build transformed 2,120 modules. Every emitted JavaScript chunk remains below the frozen 500 kB raw threshold; the largest initial chunk is 245,680 bytes and the isolated Staff route is 79,530 bytes. No eager Buyer/Seller/admin/scheduling import, runtime dependency, font, framework or token file was added.

## 6. Commands and Final Results

- Target strict OpenSpec passed before source implementation and again after evidence completion. Final all strict validation passed 45/45, 0 failed.
- Focused Web typecheck/build passed after one exact-optional-property class/`aria-current` correction.
- Focused Staff/Auth Vitest: 8 files, 50/50 passed.
- Dedicated Staff visual browser suite: 4/4 passed; 26 after screenshots generated.
- Complete Web Vitest: 37 files, 445/445 passed.
- Complete repository Vitest: 194 files, 1,271/1,271 passed.
- Complete workspace build passed, including API dry-run build and all package typechecks.
- First complete browser run: 178 passed, 1 skipped, 2 failed on obsolete Staff copy/combined-identity locators. Only the two Staff assertions were updated; targeted rerun passed 2/2. Final complete Chromium run: 180 passed, 1 skipped, 0 failed.
- After independent static-verifier alignment PR #24 was fast-forwarded, one fresh complete `npm run check` passed on current baseline `29633170` plus the unstaged Staff Change. Wave 14A static verification, 445/445 Web tests, 1,271/1,271 repository tests, every workspace typecheck/build, API dry-run build, DB/migration guards, money/finance/DTO/file/auth checks and module1 Buyer verification all passed.
- After controller P1 review, the single CSS override was deleted and one permanent dashboard Button-height assertion was added to the Staff visual test. Targeted Staff visual accessibility passed 1/1, dashboard browser passed 2/2, the affected screenshot matrix run passed 1/1, and Web typecheck/build passed. The 1,271-test repository suite and 180-test complete browser suite were not repeated because no JavaScript/runtime behavior changed.
- The final complete check's secret scan passed across 1,382 project files. Dependency risk reported 0 vulnerabilities. Customer multi-persona security passed 11/11. Migration integrity reported schema 37, 165 tables, 311 triggers, integrity `ok`, 0 foreign-key errors.
- `git diff --check` passed. Final scope review found only Staff presentation, two Staff-specific existing browser assertions, the new Staff browser fixture, and this Change/evidence. `tokens.css`, Buyer/Seller runtime, API, Contract, Domain, Migration, Schema, permissions, production configuration, manifests and lockfile are unchanged by this Change. Git remains unstaged and uncommitted on `feature/staff-portal-visual-refresh`; `HEAD` and `origin/main` are `29633170fce77ab759089bb5afd6324e23d40698`.

## 7. Resolved Baseline Verifier History

The first complete `npm run check` on starting baseline `3f94b0ce` was correctly **not** reported as passed. It stopped at the Wave 14A static verifier after all preceding secret/dependency/customer/typecheck/database/money/Wave 11/12/13 checks passed.

The following five failures reproduced against unchanged starting-commit files and were recorded as out-of-scope blockers:

1. `verify-wave14a-frontend-security.mjs` expects literal `getByLabel('店铺')`, while `foundation.spec.ts` at the starting commit correctly uses `getByLabel('店铺', { exact: true })` after Seller visual integration.
2. `verify-staff-role-consolidation.mjs` expects migration 0036 to be the repository tail, but the starting commit includes governed migration 0037.
3. `verify-staff-acquisition-funnel.mjs` expects exactly 36 migrations, but the starting commit includes 37.
4. `verify-product-reservation-order-scheduling.mjs` searches route literals in `App.tsx`, while the starting commit moved them into the lazy `StaffRouteModule`/`StaffSchedulingRouteModule` boundary.
5. `verify-admin-business-dashboard.mjs` treated migration 0037 as an admin-dashboard schema violation even though it belongs to the already integrated scheduling Change.

No verifier was weakened by this Staff Change and no false passing result was recorded. The controller resolved the shared ownership problem through independent OpenSpec `post-m16-static-verifier-alignment`, PR #24, and main commit `29633170`; that commit changes only the five verifier scripts and its OpenSpec/archive. After the controller safely fast-forwarded this worktree, the original Staff visual diff remained intact and the fresh complete `npm run check` passed. Task 6.3 is therefore closed.

## 8. Failure History and Residual Risk

- Baseline dependency/build failure and restoration are retained in section 1.
- The first shell typecheck failed because `NavLink` received `string | undefined` under exact optional types; the Staff-only class and conditional `aria-current` projection were corrected, then typecheck/build passed.
- The first before screenshot run exposed the existing 390px overflow; before-only capture retained that failure and generated comparable evidence.
- The first after screenshot run failed at 696px product-detail document width. Diagnostic assertions identified the product workspace implicit grid track; `minmax(0, 1fr)` fixed it and the complete after matrix passed.
- The first complete browser gate failed two obsolete Staff presentation assertions. Only Staff-specific assertions were aligned to the frozen new copy/context structure; targeted 2/2 and final complete 180/180 runnable tests passed, with one pre-existing skipped Buyer visual checkpoint.
- The first post-review height assertion queried before asynchronous dashboard facts rendered and found zero buttons. It was corrected to wait for the first existing “查看明细” control, then asserted all six controls; the targeted rerun passed. No runtime code changed for this test-only readiness correction.
- Residual risk: evidence uses Contract-valid mocked responses and Chromium, not production data or additional browser engines. The CSS/Staff chunk increases are measured and below budget. The five historical static-verifier blockers are resolved on baseline `29633170` and no longer remain open.

## 9. Ponytail Read-only Minimality Review

Ponytail reviewed the current diff only after complete green validation. It made no edits and identified three small deletion candidates for controller disposition:

1. P1 resolved by explicit controller review: `.staff-main .dashboard-metric .button { min-height: 36px; }` was deleted, restoring the global Button primitive's 44px minimum and adding the targeted regression assertion above.
2. P3 intentionally retained by controller: the manual `workQueue` projection keeps “工作队列” active on `/staff` detail/operation routes outside the four top-level branches.
3. P3 intentionally retained by controller: product workspace `width`/`min-width` remain as narrow-screen defense alongside the required shrinkable grid track.

Only the controller-authorized P1 was changed. The two P3 items were not modified and no pure-cleanup expansion was made.

## 10. External State and Rollback

Rollback is Staff presentation/test/evidence-only: revert the Staff login/shell/workbench presentation, Staff-specific assertion updates, `staff-visual-refresh.spec.ts`, and this unarchived Change. There is no Migration, schema, API, financial, data, permission, identity, session, cache, file, archive or external rollback.

No deployment, production Cloudflare/D1/R2, Drive, Feishu, OpenAI/ChatGPT MCP, DNS/domain, real secret, remote Git, PR, Integration or automation was accessed or changed.
