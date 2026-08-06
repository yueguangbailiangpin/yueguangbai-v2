# Design: Seller Complete Business Loop

## Existing Authority

D1 remains authoritative. Existing product application, demand batch, formal order, review, Seller payable, Seller payment/allocation/reversal, Buyer refund and file-audience tables are reused. The frontend formats returned facts and never derives authorization, finance confirmation or completion by optimistic local assumptions.

## Context and Authorization

`GET /api/seller-portal/me` returns the global Seller Organization plus authorized Stores. The route shell owns an organization/store/Marketplace context selector. Query keys include the selected Store or explicit all-authorized-store scope. The API always re-resolves the active Seller Persona and intersects Organization ownership with current member Store grants. Cross-organization, unassigned Store and cross-Persona access fail closed.

## Contract Compatibility

Seller DTOs add platform-neutral `marketplace_code`, `transaction_currency_code`, `platform_product_identifier`, `platform_order_identifier`, `final_paid_amount_minor` and generic rate snapshot fields. Existing `asin`, `amazon_order_number`, `final_paid_jpy` and `cny_per_jpy_e8` remain populated for JP rows and nullable/absent according to the explicit compatibility contract for non-JP rows. No existing Buyer or Staff field is renamed.

## Business Completion Projection

For each formal order the read model derives four independent components:

- Review: approved is complete; an explicitly inapplicable source is not applicable; all other/missing states are pending.
- Buyer refund: fully paid is complete; zero/no-due according to authoritative refund facts is not applicable; partial, due, overpaid/conflicted or missing-required facts are pending.
- Seller principal: zero/no-payable is not applicable; net outstanding zero with an unreversed authoritative payable is complete; otherwise pending.
- Seller service fee: same rule, independently evaluated from its own payable.

The aggregate is complete only if all four components are terminal complete/not-applicable. Reversals immediately affect the derived projection because it reads net ledger balances. No mutable completion flag or duplicated money is introduced.

## Files

Settlement proof association remains immutable and auditable. Existing file facts are `INTERNAL_ONLY` with a Staff audience, so Seller DTOs do not include proof metadata, object keys or read tokens. Authorized Staff reads continue through the existing fixed payment-proof read-intent route with dynamic responsibility and Personal DENY checks.

## Mutations, Concurrency and Idempotency

The only Seller business mutations remain application/batch submission and withdrawal. They retain Idempotency-Key, request hash, expected version for state changes, state-machine validation, final transaction assertions and audit events. Ambiguous transport failures reuse the exact key and body; changed body or deterministic completion rotates the operation authority. Finance/rate/completion fields have no Seller mutation route.

## UI and Accessibility

The protected Seller tree uses Chinese labels, `Asia/Shanghai` display, a mobile-first 390px layout with 320px minimum, keyboard-visible focus, semantic landmarks, 44px targets, non-color status, request-ID recovery, reduced motion and 200% reflow. Store/Marketplace context remains visible on every business page. Korea is labeled unavailable and cannot be selected for commands.

## Rejected Alternatives

- A new completion column was rejected because it would duplicate four mutable workflows and become stale after reversals.
- Combining principal and service fee was rejected because they are separate business facts, states and evidence.
- Client-computed completion was rejected because partial pages and concealed facts cannot be authoritative.
- Reusing internal finance/export APIs was rejected because they expose a different permission and DTO domain.
- A speculative migration was rejected because current generic schema and immutable ledgers already hold the needed facts.
