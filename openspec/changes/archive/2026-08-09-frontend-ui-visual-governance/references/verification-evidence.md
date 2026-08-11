# Verification Evidence: Frontend UI Visual Governance and Buyer Pilot

## Current Visual Decision

Iteration 1 was rejected by the product owner as visually insufficient. It remains valid evidence for the security, responsive, accessibility, and route-isolation skeleton, but it is not an accepted visual pilot. The rejected iteration used a small brand treatment, list-like product cards, insufficient primary/next-step emphasis, and a compressed navigation. The Change was mistakenly archived while wholly uncommitted; the generated archive move and top-level spec were verified against Git and reversed, so the Change is active again.

Iteration 2 reopened visual acceptance at the 390x844 Buyer home checkpoint. Its deterministic screenshot is `openspec/changes/frontend-ui-visual-governance/references/visuals/iteration-2/buyer-home-390x844.png` (390x844, 55,312 bytes). The controller approved its visual direction after comparison with the owner-approved reference, then authorized completing the full Change without additional screenshot pauses. This approval was directional, not authorization to archive, commit, push, open a PR, integrate, or deploy. The completed final matrix remains active for controller differential review.

Side-by-side self-review against the approved direction:

- PASS: large 月光白 brand region and deliberate top breathing room.
- PASS: visible four-step 产品→订单资料→评论→完成 explanation with only 产品 marked current.
- PASS: 当前开放产品 is the primary heading; the first server-returned product uses a large card, large title, real store/deadline/remaining facts, and a dominant action without implying an existing reservation or order.
- PASS: 下一步 is visually distinct, fully visible above the fixed navigation, and links to the real product detail using only the same returned safe facts.
- PASS: all five real navigation routes remain visible in a taller, more relaxed navigation.
- INTENTIONAL DIFFERENCE: no inert hamburger, product photo, expected order date, ranking, schedule, completion claim, or order status was copied from the direction image because repository behavior and DTOs do not authorize them.

## 1. Reproducible Baseline

- Worktree: `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/frontend-ui-visual-governance`
- Branch: `feature/frontend-ui-visual-governance`
- Baseline and `origin/main`: `323bf87bce542e5482cdbf248809cf8a22621af0`
- Node: `v24.18.1`
- npm: `11.16.0`
- `package-lock.json` SHA-256: `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`
- Dependency restoration used the committed lockfile and an ignored task-local npm cache. No dependency manifest or lockfile changed.

## 2. Scope and Authority Review

- `apps/web/src/styles/tokens.css` remains the only design-token truth and is unchanged.
- The implementation adds no design-system package, UI framework, runtime dependency, external Chinese font, global blur, or global glass treatment.
- Buyer changes are limited to the shared customer login's Buyer-only class, Buyer shell, Buyer home/product list/detail presentation, Buyer-visible review-type labels, pilot CSS, and pilot tests.
- Seller and Staff rules are documented only. `git diff --name-only origin/main -- apps/web/src/seller apps/web/src/staff` is empty.
- Contract, Domain, API, Migration, schema, endpoint, request, response, authorization, identity route, session, forced-password, Personal DENY, cache-isolation, and file/storage code are unchanged.
- Existing server-returned Buyer demand fields remain authoritative. Product eligibility is not computed in the browser.
- Existing detail mutation body, version binding, idempotency behavior, invalidation, and conflict recovery are unchanged.

## 3. Deterministic Screenshot Evidence

The following paths and counts record the original acceptance matrix. The current tree retains two representative final-state images; the other historical binaries remain recoverable from Git commit `8cb39ed870df1fc5c6874dd4e5b86e12e22c39d2`. See `openspec/changes/archive/VISUAL_EVIDENCE_RETENTION.md`.

Original screenshot matrix:

- Before: `openspec/changes/frontend-ui-visual-governance/references/visuals/before/`
- Rejected iteration 1: `openspec/changes/frontend-ui-visual-governance/references/visuals/iteration-1/`
- Iteration 2 visual checkpoint: `openspec/changes/frontend-ui-visual-governance/references/visuals/iteration-2/buyer-home-390x844.png`
- Final after: `openspec/changes/frontend-ui-visual-governance/references/visuals/after/`

The complete evidence chain contains 46 PNG files totaling 2,313,692 bytes: 15 before images totaling 645,239 bytes, 15 rejected iteration-1 images totaling 728,470 bytes, one iteration-2 checkpoint totaling 55,312 bytes, and 15 final after images totaling 884,671 bytes. Every file retains its deterministic source filename; the before and rejected iteration-1 files are byte-for-byte identical to their reviewed captures.

The fixture fixes the locale to `zh-CN`, timezone to `Asia/Shanghai`, light color scheme, reduced motion, timestamps, API data, viewport, and output filename. Each of the following 15 before/iteration-1 pairs was opened and technically reviewed; the product owner subsequently rejected the overall visual hierarchy:

| Surface | Viewport | Result | Review |
| --- | --- | --- | --- |
| Buyer login | 320x800 | PASS | Core copy only; labels/action fit; no identity selector, clipping, or overflow. |
| Buyer login | 390x844 | PASS | Core copy only; centered hierarchy and safe mobile spacing. |
| Buyer login | 768x1024 | PASS | Bounded form width; no duplicate heading or disclosure. |
| Buyer login | 1440x900 | PASS | Bounded centered card; clear primary action and no marketing copy. |
| Buyer login | 1600x1000 | PASS | Bounded centered card; no stretched controls or extra identity UI. |
| Buyer products | 320x800 | PASS | Single-column product hierarchy; wrapped dates; fixed navigation does not cause horizontal overflow. |
| Buyer products | 390x844 | PASS | Single-column cards; product/store/deadline/remaining/action remain legible. |
| Buyer products | 768x1024 | PASS | Single-column tablet layout avoids compressed fact columns. |
| Buyer products | 1440x900 | PASS | Bounded two-column product grid; consistent hierarchy and spacing. |
| Buyer products | 1600x1000 | PASS | Bounded two-column product grid; no over-wide text or overflow. |
| Buyer product detail | 320x800 | PASS | Single-column facts and confirmation; no clipped action or forbidden internal fact. |
| Buyer product detail | 390x844 | PASS | Buyer-visible note and facts wrap cleanly; confirmation remains explicit. |
| Buyer product detail | 768x1024 | PASS | Single-column tablet grouping avoids cramped facts. |
| Buyer product detail | 1440x900 | PASS | Bounded summary/action columns; returned financial facts remain visible. |
| Buyer product detail | 1600x1000 | PASS | Bounded summary/action columns; hierarchy and whitespace remain stable. |

Independent browser assertions cover exact login core, product-only scope, forbidden disclosures, keyboard focus and fixed-navigation occlusion, 200% root-text reflow, reduced motion, token contrast, and document-level horizontal overflow. At every 320/390/768/1440/1600 viewport, both the product list and product detail assert that each of 首页、产品、订单资料、评论、我的 is visible, has a target of at least 44x44 CSS pixels, and has a bounding box fully inside the viewport.

Each final after image was opened and reviewed individually:

| Surface | Viewports | Result | Final review |
| --- | --- | --- | --- |
| Buyer login | 320x800, 390x844, 768x1024, 1440x900, 1600x1000 | PASS (5/5) | Only 月光白、账号、密码、登录 and necessary recovery/error UI; mobile and desktop spacing, labels, action, wrapping, and overflow are stable. |
| Buyer open products | 320x800, 390x844, 768x1024, 1440x900, 1600x1000 | PASS (5/5) | Four-step guidance is explanatory only; 当前开放产品, the first safe product, its real detail action, safe 下一步 guidance, Chinese wrapping, and five-item navigation remain clear without fabricated state. |
| Buyer product detail | 320x800, 390x844, 768x1024, 1440x900, 1600x1000 | PASS (5/5) | Product/store/facts/confirmation hierarchy, primary action, returned financial facts, Chinese wrapping, and five-item navigation remain visible without internal disclosure or horizontal overflow. |

The full-page captures preserve the fixed navigation at the first viewport boundary while recording scrollable content below it. Browser assertions independently prove that focused controls are not obscured, the page remains scrollable, and every navigation target is fully contained in the live viewport.

## 4. Performance and Route Isolation

Both production builds used the same Node/npm/lockfile environment. Exact gzip values use the same `gzip -9 -c` measurement for both builds.

| Asset | Before raw / gzip | After raw / gzip | Delta raw / gzip |
| --- | ---: | ---: | ---: |
| Initial entry | 245,562 / 74,271 B | 245,572 / 74,271 B | +10 / 0 B |
| Global CSS | 44,381 / 8,907 B | 54,644 / 10,182 B | +10,263 / +1,275 B |
| Buyer route | 15,185 / 4,210 B | 18,498 / 4,810 B | +3,313 / +600 B |

- The initial entry is 245,572 bytes, below the 500 kB gate.
- The build emitted no chunk-size warning and all JavaScript chunks remain below 500 kB.
- The `/buyer/products` pilot assertion observed no request for `BuyerOrderRouteModule`, `BuyerAfterSalesRouteModule`, `SellerRouteModule`, or `StaffRouteModule`.
- Static source review found no new adjacent workflow import in the changed Buyer product source.
- No runtime dependency was added.

## 5. Verification Results

Final successful checks:

- Target OpenSpec strict validation: PASS.
- Repository-wide OpenSpec strict validation: PASS, 42/42 changes.
- Web TypeScript typecheck: PASS.
- Web unit/MSW suite: PASS, 36 files and 445 tests.
- Production build: PASS.
- Buyer pilot Playwright and screenshot suite: PASS, 6 passed and 1 environment-only checkpoint skipped after all 15 final screenshots were persisted.
- `npm run test:wave14a:browser`: PASS, 165 passed and 1 environment-only checkpoint skipped out of 166 tests.
- `npm run check`: PASS, including secret scan, dependency risk, schema/integrity, Migration guards, all workspace typechecks/tests/builds, 193 repository test files and 1,271 tests.
- `git diff --check`: PASS.

Process failures retained for audit:

1. The first pre-install baseline build could not find `tsc` because dependencies were absent. The committed lockfile was then restored with an ignored task-local cache; no manifest or lockfile changed.
2. The first default-cache install attempt hit permissions in the user npm cache. Retrying with the ignored task-local cache succeeded.
3. The first pilot assertion run exposed test-harness assumptions around native constraint validation, navigation text, and reduced-motion emulation. The fixture/assertions were corrected without weakening the acceptance criteria; the final pilot run passed 6/6.
4. The first final screenshot run exposed four strict-text ambiguities because the same safe product name appears in both the primary card and 下一步 card. Assertions were scoped to exact headings without weakening content coverage; the final pilot run passed.
5. The first final full browser run passed 158 tests with 7 failures: five foundation expectations still used the retired 产品 heading, and two module-1 selectors treated the safe 下一步 link as a second product or used ambiguous text. Expectations were updated to the new semantic heading and product-card route/heading without weakening business assertions. All 7 affected tests then passed, and the required final complete browser gate passed 165 tests with the single environment-only checkpoint skipped.

## 6. Security, Permission, Migration, and External State

- `NO_SCHEMA_CHANGE`; no Migration exists and no Migration was applied.
- No API or contract change; no new response field or client-side permission decision.
- Backend authorization, path-bound identity entry, session behavior, forced-password handling, Personal DENY, request IDs, safe error recovery, cache isolation, and storage authority remain intact.
- No secrets were read or written. The repository secret scan passed.
- No Cloudflare, D1, R2, Drive, Feishu, MCP, domain, DNS, production, or other external resource was accessed or changed.
- No commit, push, PR, integration, deployment, OpenSpec sync, or retained OpenSpec archive exists. The mistaken wholly local/uncommitted archive output was reversed before iteration 2; this Change remains active.

## 7. Rollback

Rollback is presentation/test-only: remove the Buyer pilot markup/classes/labels/tests and restore the prior Buyer CSS. It requires no schema, API, data, permission, identity, session, cache, storage, or external-resource rollback.
