# Capability Specification

## Purpose

Defines the scoped Staff API and immutable ledger behavior for Buyer Refund processing without exposing refund costs to Seller identities.
## Requirements
### Requirement: Staff can list Buyer Refund obligations within current scope

The system SHALL expose `GET /api/staff/buyer-refunds` for an authenticated Staff Session with effective `BUYER_REFUND_VIEW`. The route SHALL apply Personal DENY and current D1 assignment/team/global Data Scope in SQL, SHALL support strict bounded cursor pagination and allowed status/date filters, and SHALL project obligation amount, paid, reversed, outstanding, overpaid, status, buyer/order summary, assignment, version and timestamps as safe fields.

#### Scenario: In-scope refund list

- **WHEN** Staff has `BUYER_REFUND_VIEW` and refund obligations are within the Staff's current assignment, team or global scope
- **THEN** the route returns a bounded page containing only those obligations with money serialized as decimal strings.

#### Scenario: Permission denied or cross-scope rows

- **WHEN** Personal DENY removes `BUYER_REFUND_VIEW`, the Permission is absent, or obligations are outside current scope
- **THEN** the route returns 403 for missing operation Permission or excludes cross-scope rows without exposing their existence or totals.

### Requirement: Staff can read one Buyer Refund ledger detail with concealed scope enforcement

The system SHALL expose `GET /api/staff/buyer-refunds/:id`, SHALL require effective `BUYER_REFUND_VIEW`, SHALL enforce the current Buyer Refund owner/work-item/buyer scope, and SHALL reuse the existing ledger projection to return obligation facts, immutable Payment and Reversal entries, balances, status, version, safe proof references and Staff-only notes. It SHALL NOT expose Seller Settlement facts or grant Seller visibility.

#### Scenario: In-scope refund detail

- **WHEN** Staff has `BUYER_REFUND_VIEW` and the obligation is within current Data Scope
- **THEN** the route returns the append-only ledger detail and current aggregate version with `Cache-Control: no-store`.

#### Scenario: Existing but out-of-scope refund

- **WHEN** Staff has the view Permission but the obligation is outside assignment or Data Scope
- **THEN** the route returns 404 and does not reveal buyer, order, amount or proof metadata.

### Requirement: Record payment appends an immutable PAYMENT fact

The system SHALL expose `POST /api/staff/buyer-refunds/:id/payments`, SHALL require effective `BUYER_REFUND_RECORD`, Personal DENY clearance and the current `BUYER_REFUND_PROCESSING` assignment/scope, and SHALL require Idempotency-Key plus an exact body containing `expected_version`, positive `amount_cny_fen` decimal string, `paid_at`, `china_business_date`, `payment_channel`, bounded proof file references and optional public/internal notes. Actor and authoritative refund status SHALL be server-derived.

#### Scenario: Valid full or split payment

- **WHEN** authorized Staff submits a current version, positive safe integer amount and eligible verified proof files
- **THEN** the existing service appends one PAYMENT entry, creates authorized proof links, recalculates the ledger and records event, Audit, Outbox, idempotency and transaction assertion in one batch.

#### Scenario: Invalid payment command

- **WHEN** amount is zero/negative/unsafe, date/channel/proof is invalid, expected version is stale, Staff is not assigned/in scope, or body supplies Staff Actor or authoritative status
- **THEN** the command fails without updating or deleting any prior Payment or changing a Seller ledger.

### Requirement: Reverse payment appends an immutable REVERSAL fact

The system SHALL expose `POST /api/staff/buyer-refunds/:id/payments/:paymentEntryId/reversals`, SHALL require effective `BUYER_REFUND_RECORD`, current scope, Idempotency-Key and exact reversal facts, and SHALL reuse the existing reversal service. A Reversal SHALL reference the path Payment, SHALL be a new immutable entry and SHALL not exceed the original Payment's unreversed amount.

#### Scenario: Valid partial or full reversal

- **WHEN** authorized Staff submits a current refund version and reversal amount within the Payment's remaining reversible amount
- **THEN** the service appends one REVERSAL entry, recalculates balances/status and records Audit, Outbox, idempotency and transaction assertion.

#### Scenario: Invalid or cross-scope reversal

- **WHEN** the Payment does not belong to the path obligation, is outside current scope, has no reversible balance, or the requested reversal exceeds it
- **THEN** the command returns the concealed not-found or stable reversal conflict and leaves all prior facts unchanged.

### Requirement: Buyer Refund ledger remains append-only and separate from Seller Settlement

Buyer Refund Payment and Reversal facts SHALL never be updated in place or deleted. Aggregate status and balances SHALL be projections from immutable facts. Buyer Refund routes SHALL use `BUYER_REFUND_VIEW` and `BUYER_REFUND_RECORD`, SHALL NOT reuse Seller Settlement permissions, tables, DTOs or routes, and SHALL NOT expose Buyer Refund cost to any Seller identity.

#### Scenario: Ledger correction

- **WHEN** a previously recorded Buyer Refund payment is wrong
- **THEN** authorized Staff records a Reversal and, if needed, a new Payment rather than editing or deleting the original fact.

#### Scenario: Seller attempts refund-cost access

- **WHEN** a Seller Session queries Seller-safe order, settlement or file APIs
- **THEN** Buyer Refund obligation, Payment, Reversal, cost amount and internal proof fields remain absent even if the Seller owns the related product or order.

### Requirement: Refund balance and OVERPAID projection preserve exact money semantics

All Buyer Refund CNY facts SHALL remain integer fen in D1 and safe-integer/BigInt logic in the application. JSON money fields SHALL be decimal strings. The ledger SHALL preserve split payment, partial reversal, outstanding and `OVERPAID` results without truncating an excess payment or silently changing the obligation amount.

#### Scenario: Split and exact payment

- **WHEN** multiple valid Payments and Reversals sum to less than or exactly the obligation
- **THEN** paid, reversed and outstanding string projections exactly match the immutable facts and status follows the existing ledger rules.

#### Scenario: Overpayment

- **WHEN** net paid amount exceeds the obligation
- **THEN** the ledger exposes the exact overpaid balance and `OVERPAID` status without capping, deleting or rewriting the Payment.

### Requirement: Refund proof files use the existing File authorization model

Payment proof files SHALL be existing VERIFIED `BUYER_REFUND_PROOF` objects with the required Staff ownership/version/Purpose. Recording payment SHALL create the existing entity link and explicit `STAFF_INTERNAL` audience grant for `BUYER_REFUND_VIEW` in the business transaction. Staff reads SHALL use shared short read intents and recheck current Permission, Personal DENY and refund scope at create and consume time.

#### Scenario: Authorized proof binding and read

- **WHEN** authorized in-scope Staff records a Payment with eligible proof files and later creates a read intent
- **THEN** proof links/grants are created exactly once and verified bytes can be consumed through the safe File HTTP flow.

#### Scenario: Invalid proof or lost authority

- **WHEN** a proof is unverified, wrong Purpose/owner, already conflict-bound, out of scope, or Staff loses `BUYER_REFUND_VIEW`
- **THEN** payment binding or proof read fails closed and no object key or permanent URL is disclosed.

### Requirement: Refund mutations enforce version, idempotency, Audit and final assertions

Payment and Reversal routes SHALL use the existing canonical request hash, Idempotency-Key lease, expected aggregate version, state validation, Audit, Outbox and transaction assertion foundations. Same-key/same-hash replay SHALL return the original committed response; same-key/different-hash SHALL return `IDEMPOTENCY_CONFLICT`; stale aggregate version SHALL return `VERSION_CONFLICT`; an active lease SHALL return `REQUEST_IN_PROGRESS`.

#### Scenario: Safe payment or reversal replay

- **WHEN** the same Staff repeats a committed command with the same key and canonical body
- **THEN** the system returns the original response without appending a duplicate ledger or proof fact.

#### Scenario: Conflicting key or stale version

- **WHEN** the key is reused for different input or the refund version has changed
- **THEN** the system returns the stable 409 error and preserves the previously committed ledger.

### Requirement: Refund DTOs enforce Staff, Buyer and Seller privacy boundaries

Staff list/detail DTOs SHALL contain only fields required for refund operations and safe proof references. Buyer portal status DTOs SHALL continue to expose only Buyer-safe status/amount fields. Seller DTOs SHALL exclude all Buyer Refund cost and proof fields. No refund response SHALL expose R2 object keys, permanent URLs, Session/Provider data, other buyers or raw internal errors.

#### Scenario: Staff and Buyer projections

- **WHEN** an authorized Staff or the owning Buyer reads its permitted refund projection
- **THEN** each identity domain receives only its documented allowlist, with internal notes limited to Staff.

#### Scenario: DTO isolation verifier

- **WHEN** dedicated route and recursive DTO verifiers scan Buyer and Seller responses
- **THEN** Buyer Refund internal cost, Staff-only notes, proof storage details and cross-customer identifiers are absent, otherwise Wave 13 cannot pass audit closure.

### Requirement: Staff refund detail exposes bounded reminder observability

The scoped Staff Buyer Refund list/detail projection SHALL include only each obligation's immutable reminder count and last reminder timestamp. It SHALL preserve existing pagination and ordering, SHALL NOT create or reorder a Staff work item, and SHALL NOT expose Buyer idempotency keys, request ids, Audit metadata, external-delivery state, or Seller-visible reminder data.

#### Scenario: Staff reads a refund with reminders

- **WHEN** authorized Staff reads a visible Buyer Refund obligation with two committed Buyer reminders
- **THEN** the detail reports count two and the latest reminder timestamp while existing payment, reversal, scope, and ordering behavior remains unchanged
