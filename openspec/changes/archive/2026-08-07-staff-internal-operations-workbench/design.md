# Design: Staff Internal Operations Workbench

## Existing Authority and Gap

D1 and existing application commands remain authoritative. The baseline already enforces Staff authentication, current authorization, Personal DENY, assignments/data scope, immutable financial ledgers, versioned state machines, idempotency, audit and protected-file authorization. The missing layer is a strict Staff web client and a small amount of additive read projection needed to orchestrate those services. The implementation gap matrix is in `references/implementation-gap-matrix.md`.

## Migration Decision

No schema change is needed. Stable work-item pagination uses existing indexed/orderable `created_at` and unique `id`; review evidence uses the existing `file_objects.version`. No new mutable state, financial fact, permission, table, index or trigger is introduced. Empty and upgrade migration chains are still acceptance gates, and rollback is documented in `references/rollback-and-runbook.md`.

## Contracts and API

The work-item response becomes `{ work_items, next_cursor }`. Its opaque cursor encodes the last `(created_at,id)` pair, and the SQL query uses a strict ascending tuple condition plus `limit + 1`. Status and work-type filters are exact allowlists and the cursor is bound to those filters by validation. Existing callers that only read `work_items` remain compatible.

Staff review evidence files add `file_version`, `purpose: REVIEW_EVIDENCE` and `visibility: SELLER_VISIBLE` from existing verified file facts. No object key, storage identifier, permanent URL or read token is added. All other domain contracts remain unchanged.

## Frontend Architecture

The Staff feature is split into runtime contracts, API adapters, query keys, formatting/status helpers, a protected layout and domain panels. The shell owns queue filters and selected work-item routing. Each detail panel reads its current DTO from the existing endpoint and renders server facts; it does not derive permission or financial status. Unsupported work types render honest metadata and a no-action state.

The queue is the navigation spine. Desktop uses three panes; narrow screens preserve queue, detail/action and customer-security tools in source order. Filters are reflected in URL search parameters. Cursor pages are traversed only using `next_cursor`; no total or page count is inferred. Domain-detail failure does not erase the queue, and each failed panel has an independent retry.

## Authorization and Identity

`StaffSessionBoundary` remains the sole entry boundary. Only an authenticated ACTIVE Staff projection can render protected content. Query keys are rooted under Staff and are cleared on Staff 401/logout without crossing Buyer/Seller roots. The UI may explain missing permissions but never treats hidden controls as enforcement. Every API request relies on server middleware for fresh permission/scope resolution; client IDs, roles and scopes are never sent as authority.

## Commands, Concurrency and Recovery

All existing critical commands retain `Idempotency-Key`, canonical request hash, expected version, state-machine validation, final transaction assertions and audit. A UI operation owns one idempotency key while pending or transport-ambiguous. Exact retry reuses it; edited input or a deterministic terminal response rotates it. `VERSION_CONFLICT` and `STATE_CONFLICT` keep user input, refresh current detail and require explicit resubmission. Partial query failure is isolated per panel and displays request ID.

## Files

Order evidence, review evidence, Buyer-refund proofs and Seller-settlement proofs are opened only with fixed Staff adapters. The adapter creates a short read intent using the returned exact file/version/link context and consumes content in memory; tokens and bytes never enter Query cache, URL state or persistent storage. Object URLs are revoked. Current permission, resource ownership, purpose, audience and Personal DENY are checked again at read time.

## Money, Marketplace and Time

All money stays as decimal-string integer minor units. CNY display inserts two decimal places using string/BigInt-safe helpers; JPY/KRW use exponent zero and USD uses exponent two. The browser never calculates authoritative balances or combines Seller principal and service fee. All timestamps display in `Asia/Shanghai`; date-only business facts remain date-only. Marketplace labels are explicit and Korea is unavailable.

## Accessibility and Visual Behavior

The UI is Chinese, desktop-efficient and usable at 390px primary/320px minimum, keyboard-only, touch, 200% zoom and reduced motion. Semantic landmarks/headings, visible focus, 44px targets, non-color statuses, accessible dialogs/drawers, stable loading space and focus return are required. No fake data, fake totals or optimistic sensitive state is shown.

## Alternatives Rejected

- A new aggregate backend service was rejected because existing work items and domain reads are sufficient at this scale.
- Client-side permission filtering was rejected because it can become stale and cannot protect resources.
- A Migration-backed unified operations table was rejected because work items already provide the authoritative queue spine.
- Combining principal and service fee was rejected because contracts require separate CNY facts and states.
- Direct file URLs or generic caller-provided paths were rejected because they bypass purpose/audience authorization.
- A custom Staff password system or required Feishu UI binding was rejected as outside M5 identity scope.
