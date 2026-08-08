# Design: Frontend UI Visual Governance and Buyer Pilot

## 1. Authority and Baseline

Business truth continues to come from the decision register, product rules, contracts, backend authorization, and returned DTOs. Visual truth comes only from `apps/web/src/styles/tokens.css`; `global.css` composes those variables and SHALL NOT introduce a parallel palette, spacing scale, typography system, shadow system, or identity theme. The supplied images provide density and hierarchy direction only.

The implementation baseline is `323bf87bce542e5482cdbf248809cf8a22621af0`. In Node `v24.18.1` / npm `11.16.0` with lockfile SHA-256 `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`, the production entry is 245,562 raw bytes / 74,271 gzip bytes and the Buyer route chunk is 15,185 raw / 4,210 gzip. These historical values are retained even if later output hashes change.

## 2. Persona Governance

- Buyer: mobile-first, low cognitive load, one dominant next action, persistent five-item bottom navigation, clear product/deadline/availability hierarchy, and no internal operational facts.
- Seller: high-density business surfaces with organization and store context always clear. This Change records the rule only and changes no Seller source.
- Staff: maximum operational efficiency while preserving queue → detail → controlled action DOM order and the established three-column desktop model. This Change records the rule only and changes no Staff source.

The three persona rules are constraints on future work, not permission to merge identities, caches, routes, DTOs, or components.

## 3. Buyer Login Pilot

`CustomerLoginPage` keeps its route-bound target and exact form fields. The Buyer visual treatment uses the existing Card, FormField, TextInput, Button, Alert, and RequestIdDisplay semantics. Core steady-state visible copy is only 月光白、账号、密码、登录. Necessary validation, loading, mismatch, dependency, cleanup recovery, and request-ID feedback remain available because removing them would weaken security and recovery.

The form is centered at wide widths, fills the safe mobile content width, uses visible labels, has a single full-width primary action, and introduces no identity selector, registration link, Seller/Staff handoff, marketing copy, blur, or external font.

## 4. Buyer Shell and Product Pilot

The Buyer shell retains exact navigation ownership and route structure. Its presentation uses a large brand region with generous top breathing room and a tall, relaxed fixed five-item bottom navigation. Safe-area padding and focus offsets prevent the navigation from obscuring content or keyboard focus.

`/buyer` and `/buyer/products` render the same server-returned reservable-product collection. `/buyer/demands` remains a supported alias/list route and `/buyer/demands/:demandId` remains the authoritative detail/acceptance route. The list may improve hierarchy for product name, store, deadline, remaining quantity, and navigation affordance only when the field already exists in the returned Buyer DTO. It SHALL NOT synthesize progress stages, expected order dates, internal ranking, internal notes, product photos, counts, or workflow facts from the direction image.

The detail preserves every existing financial fact and the initially unchecked self-pay confirmation. Visual grouping may distinguish product summary, returned facts, Buyer-visible note, and confirmation action without changing version binding, mutation body, idempotency handling, invalidation, or conflict recovery.

### 4.1 Approved 390x844 Visual Hierarchy

The approved Buyer direction is authoritative for relative hierarchy, scale, spacing, and mobile completion, but not for its depicted facts or controls. At 390x844 the page order is large 月光白 brand space → four-step 产品/订单资料/评论/完成 explanation → 当前开放产品 heading → dominant product card with large title and action → distinct 下一步 area → tall five-route navigation. This order and relative emphasis must be apparent in a side-by-side review; a uniformly weighted administrative list is a visual failure even when technically responsive. 当前开放产品 intentionally replaces the direction image's 进行中的产品 so an available product is not misrepresented as reserved or ordered.

The four steps explain the real business journey and mark only the current product step; they do not claim that later stages are complete. The primary and next-step cards use only returned product name, store, reservation deadline, remaining quantity, and the existing product-detail route. No expected date, ranking, schedule, reservation/order status, or decorative menu control is invented. All sizes, colors, radii, shadows, and spacing compose `tokens.css` variables.

## 5. Responsive and Accessibility Model

The pilot is reviewed at exact viewport widths 320, 390, 768, 1440, and 1600. Mobile widths prioritize single-column content and 44px targets. Wider widths increase whitespace and may use bounded two-column fact layout without turning the Buyer portal into a Seller dashboard. At 200% root text size, content reflows without document-level horizontal overflow or clipped primary actions.

Keyboard focus uses the existing visible tokenized focus treatment. Fixed navigation does not cover the focused element. State and availability are never color-only. `prefers-reduced-motion: reduce` collapses loading/transition duration through the existing global rule. Contrast checks cover text, muted text, focus, primary controls, borders, and status surfaces against their actual backgrounds.

## 6. Deterministic Visual Evidence

A dedicated Playwright pilot fixture intercepts only the existing session and Buyer demand endpoints with contract-valid deterministic data and fixed UTC timestamps. It captures login, product list/home, and product detail at the five required viewport widths before and after source changes. Browser locale/timezone, animations, data, viewport, and output names are fixed. Screenshots are stored outside tracked application assets and are reviewed one by one for hierarchy, wrapping, overflow, focus, copy, and forbidden-field absence.

Visual comparison is evidence, not the only oracle. DOM assertions independently verify core login copy, server-returned products, forbidden copy/fields, keyboard focus, reduced motion, 200% reflow, and no horizontal overflow.

## 7. Performance and Import Boundary

No new runtime dependency is added. The existing `CustomerSessionBoundary` remains outside the lazy Buyer portal. `/buyer/products` must not request `BuyerOrderRouteModule` or `BuyerAfterSalesRouteModule`; product source must not import order, review, refund, or Seller/Staff modules. Before/after production builds use the same Node/npm/lockfile and record raw/gzip entry, CSS, Buyer route, and any new chunk. The initial entry remains below 500 kB.

## 8. Rejected Alternatives

- A new design-system package or token file: rejected because `tokens.css` is the frozen design truth.
- A UI framework or component kit: rejected because existing primitives and CSS cover this bounded pilot.
- External Chinese web fonts: rejected for availability, privacy, and loading risk.
- Glass/blur/gradient decoration: rejected because it conflicts with the restrained direction and adds no business clarity.
- Client-side product eligibility or invented workflow stages: rejected because server facts and permissions are authoritative.
- Simultaneous Seller/Staff redesign: rejected because sequencing and sole-writer scope require Buyer pilot evidence first.

## 9. Verification and Rollback

Verification runs target and repository strict OpenSpec, Web/unit/MSW tests, full `npm run check`, `test:wave14a:browser`, the Buyer pilot Playwright/screenshot suite, production build size comparison, static import checks, screenshot review, `git diff --check`, and Git scope review. Rollback removes only the opt-in Buyer pilot markup/classes/tests and restores prior CSS; no Migration, API, session, permission, data, or external rollback exists.
