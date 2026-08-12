## ADDED Requirements

### Requirement: Canonical Staff composition solely owns Seller Settlement frontend behavior

The production `StaffRouteModule` → `FrozenStaffWorkbenchV2` → `FrozenStaffWorkbench` composition SHALL be the sole frontend owner of Seller Settlement summary, payable, payment, allocation, reversal and protected-proof behavior. It SHALL mount the settlement panel only for a selected work item with authoritative Seller Organization context and a current Staff Session whose role is `owner` or `seller_ops` and whose effective permissions include `SELLER_SETTLEMENT_VIEW`. The frontend SHALL issue no Seller Settlement request for `acquisition`, `pre_sales`, `buyer_refund`, a missing Seller Organization context, or a session without view permission. The backend SHALL remain the authoritative source for ACTIVE status, Personal DENY, permission, Marketplace/Seller Organization scope, concealed not-found, idempotency, expected-version, transaction, audit and proof authorization.

#### Scenario: Authorized Staff views canonical settlement facts

- **WHEN** an `owner` or `seller_ops` Staff with `SELLER_SETTLEMENT_VIEW` selects a scoped work item with Seller Organization context
- **THEN** the canonical workbench loads the existing summary, payable and payment contracts, displays Seller principal and Seller service fee independently, and opens proof only through the existing protected-file adapter.

#### Scenario: Wrong role or effective permission cannot probe settlement

- **WHEN** the selected work item contains Seller Organization context but the Staff role is `acquisition`, `pre_sales` or `buyer_refund`, or effective `SELLER_SETTLEMENT_VIEW` is absent
- **THEN** the canonical settlement panel and controls are absent and no Seller Settlement endpoint is requested.

#### Scenario: Financial controls mirror current permissions without replacing backend authorization

- **WHEN** an authorized viewer has `SELLER_SETTLEMENT_RECORD`
- **THEN** recording and allocation controls use the existing request paths, bodies, idempotency and payment-version facts; whole-payment reversal is additionally shown only with `FINANCIAL_CORRECT`, while every submitted request is independently reauthorized by the backend.

#### Scenario: Proof or financial command fails closed

- **WHEN** proof verification, authorization, scope, state, version or a financial mutation fails
- **THEN** the UI does not display optimistic success, retains independent still-valid panels, surfaces sanitized Chinese recovery text and a request ID when available, and permits only exact ambiguous-request retry or a fresh server refetch.

#### Scenario: Canonical evidence permits legacy retirement

- **WHEN** canonical component, role/scope and workbench integration tests prove the still-current behavior and repository evidence points to the production composition
- **THEN** `StaffWorkbench.tsx` and its MSW test are removed without leaving a second Seller Settlement implementation, runtime import, verifier marker or test dependency.

#### Scenario: Takeover does not redesign the domain

- **WHEN** this canonical takeover is released or rolled back
- **THEN** Seller Settlement APIs, financial calculations, state machines, database schema, Migrations, backend authorization, audit and outbox behavior remain unchanged, while the proof chooser offers only the JPEG/PNG/WebP MIME types accepted by the existing payment command.
