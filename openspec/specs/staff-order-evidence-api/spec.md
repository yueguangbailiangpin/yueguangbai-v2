# Capability Specification

## Purpose

Defines the scoped Staff review API for Order Evidence, including atomic approval and privacy-preserving file access.

## Requirements

### Requirement: Staff can list pending Order Evidence within current data scope

The system SHALL expose `GET /api/staff/order-evidence` for an authenticated Staff Session with effective `ORDER_VIEW`. The route SHALL apply Personal DENY and current D1 Data Scope in SQL, SHALL support strict `limit`, `cursor` and allowed status filters, and SHALL return only Staff-safe review queue fields including work-item assignment, buyer/order summary, evidence status, deadline, reference amount, final paid amount, price difference, mismatch facts and version.

#### Scenario: In-scope pending list

- **WHEN** Staff has `ORDER_VIEW` and one or more Order Evidence work items are within the Staff's global, assigned-buyer or team scope
- **THEN** the route returns a bounded cursor page containing only those evidence records and safe file references.

#### Scenario: No permission or out-of-scope rows

- **WHEN** Personal DENY removes `ORDER_VIEW`, the Permission is absent, or records belong outside current scope
- **THEN** the route returns 403 for missing operation Permission or omits out-of-scope rows without revealing their count or identifiers.

### Requirement: Staff can read one Order Evidence detail with concealed scope enforcement

The system SHALL expose `GET /api/staff/order-evidence/:id`, SHALL require effective `ORDER_VIEW`, SHALL resolve the current assignment/work item and buyer scope, and SHALL return evidence, instruction, reservation, `reference_order_amount_jpy`, `final_paid_jpy`, `price_difference_jpy`, one safe file reference, version history and buyer-visible modification projection without exposing R2 object keys or unrelated customer data.

#### Scenario: In-scope detail

- **WHEN** Staff has `ORDER_VIEW` and the evidence is within current Data Scope
- **THEN** the route returns the current detail and exact current version with `Cache-Control: no-store`.

#### Scenario: Existing but out-of-scope detail

- **WHEN** Staff has `ORDER_VIEW` but the evidence is outside current assignment or Data Scope
- **THEN** the route returns 404 and does not reveal whether the evidence exists.

### Requirement: Request changes uses the existing fixed two-hour workflow

The system SHALL expose `POST /api/staff/order-evidence/:id/request-changes`, SHALL require effective `ORDER_CONFIRM`, current evidence/work-item scope, Idempotency-Key and an exact body containing `expected_version`, `public_reason` and optional `internal_note`. It SHALL reuse the existing request-changes service, set the buyer modification deadline to exactly two hours from the accepted command time, and SHALL not accept a client-selected next state or deadline. If the screenshot disagrees with the Buyer-entered `final_paid_jpy`, is unclear, or cannot prove the final amount, Staff SHALL use this command and SHALL NOT approve.

#### Scenario: Valid request changes

- **WHEN** authorized Staff submits a current version and valid public reason for a reviewable evidence record, including a screenshot/final-amount inconsistency or unclear screenshot
- **THEN** the service transitions to the existing modification state, records the fixed two-hour deadline, updates the buyer-safe projection, Audit, Outbox, work item and idempotency result.

#### Scenario: Stale or unauthorized request changes

- **WHEN** expected version is stale, the evidence is not reviewable, Staff is out of scope, or the body contains authority/next-state/deadline fields
- **THEN** the command returns the stable version/state/validation/concealed error and makes no partial change.

### Requirement: Approve atomically verifies evidence and forms the Formal Order

The system SHALL expose `POST /api/staff/order-evidence/:id/approve`, SHALL require effective `ORDER_CONFIRM`, the existing role policy, current assignment/scope, Idempotency-Key and an exact body containing required `expected_version` and optional `internal_note`, `price_mismatch_acknowledged` and `price_mismatch_reason`. One application command SHALL prepare and commit, in one D1 atomic batch, the evidence verification event, Amazon order-number claim/finalization, Formal Order, unique evidence association, financial snapshot, seller principal payable, instruction completion, evidence consumption, work-item completion, Audit, Formal Order Event, Outbox, idempotency completion and transaction assertions. The Formal Order and financial snapshot SHALL use the screenshot-proven `final_paid_jpy`, never `reference_order_amount_jpy`.

#### Scenario: Successful atomic approval

- **WHEN** evidence is reviewable and current, contains exactly one eligible verified screenshot that clearly proves the Buyer-entered final amount, and either has no price mismatch with no meaningless acknowledgment or has a price mismatch with explicit `price_mismatch_acknowledged=true` and a non-empty internal reason
- **THEN** the response returns the Formal Order and consumed evidence projection and every required fact exists in one committed batch using `final_paid_jpy`.

#### Scenario: Any formal-order step fails

- **WHEN** screenshot proof, mismatch acknowledgment, order number claim, snapshot, payable, instruction, evidence or assertion validation fails
- **THEN** the entire approval rolls back, no partial VERIFIED evidence or orphan Formal Order remains, and the stable validation, mismatch, conflict or dependency error is returned.

### Requirement: HTTP and Domain both enforce exactly one Order Evidence screenshot

Order Evidence submission, Staff detail and Staff approval SHALL treat one screenshot as an invariant. The HTTP submission Contract SHALL require `file_object_ids.length === 1`, and Domain/Application validation SHALL independently require one VERIFIED `ORDER_EVIDENCE` file owned by the correct Buyer and linked to the correct submission. The previous generic 1–10 HTTP allowance SHALL not remain for this business route.

#### Scenario: Exactly one eligible screenshot

- **WHEN** the request references exactly one verified file satisfying Purpose, owner, version and link rules
- **THEN** the business command may proceed and the detail projection contains one safe file reference.

#### Scenario: Zero, multiple or ineligible screenshots

- **WHEN** the request contains zero or two or more file IDs, duplicates, a wrong Purpose/owner, an unverified file or an already-conflicting link
- **THEN** HTTP or Domain rejects the command before Order Evidence approval and no Formal Order is created.

### Requirement: PRICE_MISMATCH requires explicit, auditable acknowledgment

The server SHALL calculate `price_difference_jpy = final_paid_jpy - reference_order_amount_jpy` from stored instruction and evidence facts. A non-zero difference SHALL NOT by itself mean the evidence is wrong. If the screenshot clearly proves the entered `final_paid_jpy`, Staff with effective `ORDER_CONFIRM` MAY approve the difference only by submitting `price_mismatch_acknowledged=true` and a non-empty normalized `price_mismatch_reason`. This uses the existing Permission, Personal DENY, Assignment, Data Scope, expected-version and idempotency rules and introduces no new Permission. The public error code `PRICE_MISMATCH` is a required minimal Contract extension because it is not present in the current error catalog.

#### Scenario: Mismatch acknowledgment validation

- **WHEN** stored facts show a non-zero mismatch and acknowledgment is missing or false
- **THEN** approval returns HTTP 409 `PRICE_MISMATCH`; when acknowledgment is true but reason is absent or empty, approval returns 400 `VALIDATION_ERROR`; no Formal Order is formed in either case.

#### Scenario: Acknowledged mismatch or meaningless acknowledgment

- **WHEN** stored facts show a non-zero mismatch, the screenshot clearly proves `final_paid_jpy`, and authorized Staff supplies true acknowledgment plus a non-empty reason
- **THEN** approval may succeed and Audit/Formal Order Event record `reference_order_amount_jpy`, `final_paid_jpy`, `price_difference_jpy`, acknowledgment, reason and `confirmed_by_staff_id`; when no mismatch exists, true acknowledgment or a non-empty reason returns 400 `VALIDATION_ERROR`.

### Requirement: Order Evidence mutations preserve concurrency, idempotency and immutable evidence

Request-changes and approve SHALL use the existing request hash, command idempotency, expected-version condition, state-machine check, Audit, Outbox and transaction assertion foundations. The approve request hash SHALL include `price_mismatch_acknowledged` and normalized `price_mismatch_reason`. Same-key/same-hash replay SHALL return the original committed approval result and original mismatch reason; same-key/different-hash SHALL return `IDEMPOTENCY_CONFLICT`; stale version SHALL return `VERSION_CONFLICT`; an in-progress lease SHALL return `REQUEST_IN_PROGRESS`.

#### Scenario: Safe replay

- **WHEN** the same Staff Actor repeats a committed request with the same Idempotency-Key and canonical body
- **THEN** the route returns the original result and mismatch acknowledgment facts without creating another deadline, event, order claim, Formal Order or snapshot and without changing the reason.

#### Scenario: Conflicting replay or stale version

- **WHEN** the key is reused with different input, including a different mismatch reason, or expected version no longer matches
- **THEN** the command returns the stable 409 error and preserves the previously committed facts.

### Requirement: Order Evidence files and DTOs use current authorization and privacy projection

Staff evidence responses SHALL expose only opaque `file_object_id`, link ID, expected/current file version and Purpose/status needed to create a short read intent. File reads SHALL use the shared Staff File HTTP read-intent flow and recalculate `ORDER_VIEW`, Personal DENY and evidence scope at both create and consume time. Buyer projections SHALL include only public reason/deadline/status; `price_mismatch_reason`, internal note, Staff identity internals, financial internals, object key and permanent URL SHALL remain excluded.

#### Scenario: Authorized proof read

- **WHEN** in-scope Staff with current `ORDER_VIEW` creates and consumes a read intent for the evidence screenshot
- **THEN** verified bytes are returned once without exposing storage location or granting broader file authority.

#### Scenario: DTO or scope isolation

- **WHEN** a Buyer requests its projection, Staff loses permission/scope, or a verifier scans the response
- **THEN** mismatch internal reason, internal note, unrelated customer data, R2 keys, permanent URLs and out-of-scope files are absent or concealed.
