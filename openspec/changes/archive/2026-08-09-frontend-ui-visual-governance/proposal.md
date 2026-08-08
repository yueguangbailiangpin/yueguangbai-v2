# Change Proposal: Frontend UI Visual Governance and Buyer Pilot

## Why

The formal frontend already enforces identity-separated sessions, server-authoritative Buyer eligibility, route-level code splitting, accessible primitives, and the `tokens.css` semantic palette. Its visual rules are scattered across archived Changes and the Buyer login, home, and product journey still lack one reviewed, deterministic governance baseline. A bounded pilot is needed before the same visual discipline can be applied to the remaining Buyer pages and, later, to Seller and Staff surfaces.

Iteration 1 established the security, responsive, and route-isolation skeleton but was rejected by the product owner because its small brand, list-like cards, weak action hierarchy, and compressed navigation did not reach the approved Buyer direction. The Change therefore remains active until a new visual iteration passes explicit side-by-side review.

## What Changes

- Establish `apps/web/src/styles/tokens.css` as the only design-token truth and document identity-specific density and context rules without creating a second design system.
- Refine `/buyer/login`, `/buyer`, `/buyer/products`, `/buyer/demands`, and `/buyer/demands/:demandId` as one mobile-first Buyer pilot while preserving the existing routes, fields, Chinese business copy, actions, session boundaries, and server DTOs.
- Make the approved Buyer direction's visual hierarchy an acceptance gate at 390x844: generous brand space, a four-step explanatory journey, a dominant active-product card and action, a distinct safe next-step area, and a tall relaxed five-item navigation.
- Keep the Buyer login core content limited to 月光白、账号、密码、登录 plus necessary safe error, request-ID, cleanup-recovery, and loading feedback.
- Present only the products returned by the existing server-authoritative reservable-demand projection; keep order materials, reviews, refunds, and internal scheduling facts out of the product area.
- Add deterministic before/after visual evidence and automated checks at 320, 390, 768, 1440, and 1600 CSS pixels, plus keyboard focus, 200% text zoom, reduced motion, contrast, and horizontal-overflow coverage.
- Preserve the existing lazy-loading boundary and record comparable production-build raw/gzip evidence before and after the pilot.
- Register future direction only: Seller remains high-density with explicit organization/store context; Staff remains maximum-efficiency with the established queue/detail/action three-column model.

## Scope

Implementation is limited to shared visual-governance documentation/tests that do not alter Seller or Staff rendering, Buyer login presentation, Buyer shell presentation, Buyer home/product list presentation, and Buyer product detail presentation. Existing shared primitives may be reused; a shared primitive may be changed only when its observable effect is restricted to opt-in Buyer pilot classes.

## Out of Scope

- Any Seller or Staff page, shell, layout, component, copy, route, or behavior modification.
- Buyer order-material, formal-order, review, refund, registration, password, or account-page redesign.
- New API routes, response fields, request fields, business contracts, identity entry, session behavior, authorization logic, Personal DENY behavior, cache namespace, or file workflow.
- Database Migration, D1/R2/Drive/Feishu/Cloudflare access, deployment, DNS/domain changes, real secrets, or real data.
- New UI framework, new state/form library, external Chinese font, dark theme, all-site glass/blur, or a second token file.
- Treating the supplied Buyer/Seller/Staff direction images as field, permission, workflow, status, date, amount, or copy authority.

## Migration and Contract Impact

`NO_SCHEMA_CHANGE`. The pilot consumes the existing Buyer session and Buyer portal contracts exactly as implemented. It adds no endpoint, DTO field, mutation body, permission, cache authority, transaction, Audit, Outbox, or file rule.

## Security and Privacy Impact

The existing `CustomerSessionBoundary`, shared Customer-cookie invalidation group, forced-password flow, Buyer-rooted Query keys, concealed 404 handling, and server-side eligibility checks remain authoritative. Customer number, session expiry, internal business times, internal notes, seller internals, order/review/refund facts, file authority, and storage identifiers are not added to the pilot views or fixtures.

## Risk and Rollback

Risks are responsive overflow, reduced contrast, focus obscured by fixed navigation, accidental cross-feature imports, visual snapshots that hide a functional regression, and reference-image content being mistaken for system truth. Rollback is source-only: revert this Change's Buyer JSX/CSS/tests and restore the recorded baseline screenshots. No data, API, permission, session, or external resource is affected.
