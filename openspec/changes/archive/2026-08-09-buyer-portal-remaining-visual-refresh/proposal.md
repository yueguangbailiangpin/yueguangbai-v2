# Change Proposal: Buyer Portal Remaining Visual Refresh

## Why

The approved Buyer pilot established the visual hierarchy for login and the open-product journey, but the remaining authenticated Buyer pages still read as uniformly weighted operational cards and forms. This Change applies the same calm, mobile-first hierarchy to the rest of the real Buyer journey without changing any business fact, action authority, security boundary, route ownership, or adjacent persona.

## What Changes

- Unify reservation list/detail and order-instruction presentation.
- Unify order-material list/new/detail and formal-order list/detail presentation.
- Unify review list/new/detail and refund list/detail presentation.
- Unify Buyer Me, Buyer change-password, and invitation-registration presentation where needed.
- Keep the approved four-step 产品 → 订单资料 → 评论 → 完成 journey visible as explanatory context while marking only the current real section.
- Preserve one dominant next action, generous Buyer whitespace, concise Chinese labels, explicit status/deadline/amount hierarchy, and the existing five-item navigation ownership.
- Add deterministic before/after evidence at 320, 390, 768, 1440, and 1600 CSS-pixel widths plus 200% text, keyboard, reduced-motion, contrast, and overflow checks.
- Record comparable production build raw/gzip sizes and prove route-level lazy-loading remains intact.

## Scope

Implementation is limited to Buyer presentation and Buyer visual acceptance evidence for:

- `/buyer/reservations`, `/buyer/reservations/:reservationId`, and `/buyer/reservations/:reservationId/instruction`.
- `/buyer/order-materials`, `/buyer/order-materials/new`, `/buyer/order-materials/:submissionId`, `/buyer/orders`, and `/buyer/orders/:formalOrderId`.
- `/buyer/reviews`, `/buyer/reviews/new`, `/buyer/reviews/:reviewCaseId`, `/buyer/refunds`, and `/buyer/refunds/:refundId`.
- `/buyer/me`, `/buyer/change-password`, and `/buyer/register`.
- Shared Buyer-only presentation classes/components and deterministic Buyer visual tests.

## Out of Scope

- Buyer login, home, open-product list/detail business redesign, except reuse of their already-approved presentation primitives.
- Any Seller or Staff page, shell, copy, route, component, or behavior.
- Any API, Contract, Domain, Migration, schema, DTO, request body, response field, state machine, permission, Personal DENY, session, cache namespace, idempotency, Audit, Outbox, file authorization, upload/read flow, or production configuration change.
- New UI framework, state/form library, runtime dependency, external Chinese font, dark theme, global glass/blur, or second design-token system.
- Any invented product image, schedule, rank, status, amount, time, action, or permission from the direction image.
- Commit, staging, push, PR, OpenSpec sync/archive, Integration, deployment, external activation, or production resource access.

## Migration and Contract Impact

`NO_SCHEMA_CHANGE`. Existing Buyer DTOs, routes, mutations, idempotency/version rules, Customer Session boundary, query keys, and protected-file controllers remain exact authorities. No Contract, Domain, API, Migration, or dependency manifest changes are authorized.

## Security and Privacy Impact

Buyer/Seller/Staff identity separation, the shared Customer-cookie invalidation group, forced password change, concealed 404, Personal DENY, Buyer-rooted Query keys, route-level chunks, and dynamic file authorization remain unchanged. The UI renders only fields and actions already returned by the real Buyer DTOs. Storage identifiers, private tokens, internal notes, internal finance, Seller/Staff facts, internal scheduling, and cross-customer data remain absent.

## Risk and Rollback

Risks are accidental fact relabeling, hidden or competing primary actions, mobile overflow, focus being covered by fixed navigation, raw enum leakage, duplicated route chunks, and screenshot fixtures drifting from Contract-valid shapes. Rollback is source-only: revert Buyer JSX/CSS/tests and evidence from this Change. No schema, API, data, permission, session, cache, file, or external rollback exists.
