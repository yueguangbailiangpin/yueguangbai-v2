# Change Proposal: Seller Portal Visual Refresh

## Why

The Seller portal already exposes the complete server-authorized catalog, submission, order, review, settlement, account, and forced-password journeys, but its presentation is still a mobile card stack with a seven-item bottom navigation at every width. It does not provide the high-density desktop workspace, persistent organization/store context, clear primary submission entry, or efficient record hierarchy frozen by the visual-governance baseline. A Seller-only visual Change is required to unify every real page without changing any business authority.

## What Changes

- Unify `/seller/login`, the protected Seller shell, dashboard, products/applications, demand batches, formal orders, reviews, settlements, account, submission forms, application detail, and `/seller/change-password` using one dense Seller visual grammar.
- Use a desktop sidebar and persistent organization/store/Marketplace context for efficient wide-screen work while retaining a compact, overflow-safe mobile navigation and logical DOM order.
- Make the existing permission-projected `提交产品申请` and `提交需求` actions visually clear, with `提交需求` the dominant Seller business entry where the existing access projection authorizes it.
- Remove duplicate/internal-facing Seller copy while retaining required business names including 卖家本金 and 卖家服务费.
- Improve list, summary, status, money, time, and form hierarchy using only fields already returned by the Seller runtime contracts and actions already projected by the backend.
- Add deterministic before/after responsive screenshots and browser assertions for Chinese copy, Beijing time, integer-safe money, identity/session/permission boundaries, forced password, Personal DENY regression coverage, cache/file isolation, keyboard access, 200% text, reduced motion, target size, and horizontal overflow.
- Record comparable entry/CSS/Seller-route raw and gzip sizes and preserve identity/page lazy-loading boundaries.

## Scope

Implementation is limited to Seller presentation and Seller-specific tests/evidence for:

- `/seller/login` and `/seller/change-password` Seller-only presentation branches.
- `/seller`, `/seller/products`, `/seller/products/new`, `/seller/products/:applicationId`, `/seller/demands`, `/seller/demands/new`, `/seller/orders`, `/seller/reviews`, `/seller/settlements`, and `/seller/settings`.
- Seller shell/context/navigation, Seller-only display helpers/classes, and deterministic Seller visual fixtures.
- This single OpenSpec Change and its evidence.

## Out of Scope

- Any Buyer or Staff page, shell, component behavior, copy, route, test authority, or visual change.
- Any API, Contract, Domain, Migration, schema, DTO, request body, response field, state machine, permission, Personal DENY, session, cache namespace, idempotency, Audit, Outbox, file authorization, upload/read flow, production configuration, or dependency-manifest change.
- New Seller action, field, filter, export, financial control, payment confirmation, Korea capability, schedule/rank projection, or client-derived status.
- A new UI framework, state/form library, runtime dependency, external Chinese font, dark theme, site-wide glass/blur, or second design-token system.
- Commit, staging, push, PR, OpenSpec sync/archive, Integration, deployment, external activation, production resource access, or real secrets.

## Migration and Contract Impact

`NO_SCHEMA_CHANGE`. Existing Seller runtime schemas, routes, mutations, version/idempotency rules, Customer Session boundary, Seller-rooted Query keys, and protected-file controllers remain the exact authorities. No Contract, Domain, API, Migration, dependency manifest, or production configuration change is authorized.

## Security and Privacy Impact

Buyer/Seller/Staff identity separation, the shared Customer-cookie invalidation group, forced-password flow, concealed 404, Personal DENY, organization/store scope, Seller-rooted Query keys, route-level chunks, verified uploads, and dynamic file authorization remain unchanged. The UI renders only fields/actions already returned by Seller DTOs. Buyer identity/refund amounts/proofs, Staff data, internal profit, internal notes, storage identifiers, tokens, and cross-organization facts remain absent.

## Risk and Rollback

Risks are context loss on narrow screens, accidental fact relabeling, duplicated primary actions, mobile overflow, focus being hidden by navigation, dense tables becoming inaccessible, raw enum/internal copy leakage, and unintended chunk coupling. Rollback is source-only: revert Seller JSX/CSS/tests and this Change's evidence. No schema, API, data, permission, session, cache, file, financial, or external rollback exists.
