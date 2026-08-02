# Staff Order Evidence API Capability

## ADDED Requirements

### Requirement: Staff can list pending Order Evidence within current data scope

The system SHALL expose `GET /api/staff/order-evidence` for an authenticated Staff Session with effective `ORDER_VIEW`. The route SHALL apply Personal DENY and current D1 Data Scope in SQL, SHALL support strict `limit`, `cursor` and allowed status filters, and SHALL return only Staff-safe review queue fields including work-item assignment, buyer/order summary, evidence status, deadline, mismatch facts and version.

#### Scenario: In-scope pending list

- **WHEN** Staff has `ORDER_VIEW` and one or more Order Evidence work items are within the Staff's global, assigned-buyer or team scope
- **THEN** the route returns a bounded cursor page containing only those evidence records and safe file references.

#### Scenario: No permission or out-of-scope rows

- **WHEN** Personal DENY removes `ORDER_VIEW`, the Permission is absent, or records belong outside current scope
- **THEN** the route returns 403 for missing operation Permission or omits out-of-scope rows without revealing their count or identifiers.

### Requirement: Staff can read one Order Evidence detail with concealed scope enforcement

The system SHALL expose `GET /api/staff/order-evidence/:id`, SHALL require effective `ORDER_VIEW`, SHALL resolve the current assignment/work item and buyer scope, and SHALL return evidence, instruction, reservation, current financial comparison, one safe file reference, version history and buyer-visible modification projection without exposing R2 object keys or unrelated customer data.

#### Scenario: In-scope detail

- **WHEN** Staff has `ORDER_VIEW` and the evidence is within current Data Scope
- **THEN** the route returns the current detail and exact current version with `Cache-Control: no-store`.

#### Scenario: Existing but out-of-scope detail

- **WHEN** Staff has `ORDER_VIEW` but the evidence is outside current assignment or Data Scope
- **THEN** the route returns 404 and does not reveal whether the evidence exists.

### Requirement: Request changes uses the existing fixed two-hour workflow

The system SHALL expose `POST /api/staff/order-evidence/:id/request-changes`, SHALL require effective `ORDER_CONFIRM`, current evidence/work-item scope, Idempotency-Key and an exact body containing `expected_version`, `public_reason` and optional `internal_note`. It SHALL reuse the existing request-changes service, set the buyer modification deadline to exactly two hours from the accepted command time, and SHALL not accept a client-selected next state or deadline.

#### Scenario: Valid request changes

- **WHEN** authorized Staff submits a current version and valid public reason for a reviewable evidence record
- **THEN** the service transitions to the existing modification state, records the fixed two-hour deadline, updates the buyer-safe projection, Audit, Outbox, work item and idempotency result.

#### Scenario: Stale or unauthorized request changes

- **WHEN** expected version is stale, the evidence is not reviewable, Staff is out of scope, or the body contains authority/next-state/deadline fields
- **THEN** the command returns the stable version/state/validation/concealed error and makes no partial change.

### Requirement: Approve atomically verifies evidence and forms the Formal Order

The system SHALL expose `POST /api/staff/order-evidence/:id/approve`, SHALL require effective `ORDER_CONFIRM`, the existing role policy, current assignment/scope, Idempotency-Key and exact body `expected_version` plus optional `internal_note`. One application command SHALL prepare and commit, in one D1 atomic batch, the evidence verification event, Amazon order-number claim/finalization, Formal Order, unique evidence association, financial snapshot, seller principal payable, instruction completion, evidence consumption, work-item completion, Audit, Outbox, idempotency completion and transaction assertions.

#### Scenario: Successful atomic approval

- **WHEN** evidence is reviewable, current, contains exactly one eligible verified screenshot, has no unresolved mismatch and every formal-order precondition succeeds
- **THEN** the response returns the Formal Order and consumed evidence projection and every required fact exists in one committed batch.

#### Scenario: Any formal-order step fails

- **WHEN** order number claim, snapshot, payable, instruction, evidence or assertion validation fails
- **THEN** the entire approval rolls back, no partial VERIFIED evidence or orphan Formal Order remains, and the stable conflict/dependency error is returned.

### Requirement: HTTP and Domain both enforce exactly one Order Evidence screenshot

Order Evidence submission, Staff detail and Staff approval SHALL treat one screenshot as an invariant. The HTTP submission Contract SHALL require `file_object_ids.length === 1`, and Domain/Application validation SHALL independently require one VERIFIED `ORDER_EVIDENCE` file owned by the correct Buyer and linked to the correct submission. The previous generic 1–10 HTTP allowance SHALL not remain for this business route.

#### Scenario: Exactly one eligible screenshot

- **WHEN** the request references exactly one verified file satisfying Purpose, owner, version and link rules
- **THEN** the business command may proceed and the detail projection contains one safe file reference.

#### Scenario: Zero, multiple or ineligible screenshots

- **WHEN** the request contains zero or two or more file IDs, duplicates, a wrong Purpose/owner, an unverified file or an already-conflicting link
- **THEN** HTTP or Domain rejects the command before Order Evidence approval and no Formal Order is created.

### Requirement: PRICE_MISMATCH is a server-computed fail-closed path

The server SHALL calculate and read price difference/mismatch from existing order instruction and evidence facts and SHALL NOT accept a client-supplied authoritative mismatch status or financial amount. Under the default Wave 13 policy, unresolved `PRICE_MISMATCH` SHALL prevent approval and return 409 using the existing Order Evidence state-conflict family with a stable sanitized reason. This Change SHALL NOT alter pricing formulas or silently waive the mismatch.

#### Scenario: No unresolved mismatch

- **WHEN** stored verified evidence facts show no price mismatch and all other preconditions pass
- **THEN** approval may proceed without a client assertion about price equality.

#### Scenario: Unresolved mismatch

- **WHEN** stored facts indicate `PRICE_MISMATCH`
- **THEN** approval fails closed with a stable conflict result, Staff may use request-changes, and no financial snapshot or Formal Order is committed until total-control policy provides another authorized resolution.

### Requirement: Order Evidence mutations preserve concurrency, idempotency and immutable evidence

Request-changes and approve SHALL use the existing request hash, command idempotency, expected-version condition, state-machine check, Audit, Outbox and transaction assertion foundations. Same-key/same-hash replay SHALL return the committed response; same-key/different-hash SHALL return `IDEMPOTENCY_CONFLICT`; stale version SHALL return `VERSION_CONFLICT`; an in-progress lease SHALL return `REQUEST_IN_PROGRESS`.

#### Scenario: Safe replay

- **WHEN** the same Staff Actor repeats a committed request with the same Idempotency-Key and canonical body
- **THEN** the route returns the original result without creating another deadline, event, order claim, Formal Order or snapshot.

#### Scenario: Conflicting replay or stale version

- **WHEN** the key is reused with different input or expected version no longer matches
- **THEN** the command returns the stable 409 error and preserves the previously committed facts.

### Requirement: Order Evidence files and DTOs use current authorization and privacy projection

Staff evidence responses SHALL expose only opaque `file_object_id`, link ID, expected/current file version and Purpose/status needed to create a short read intent. File reads SHALL use the shared Staff File HTTP read-intent flow and recalculate `ORDER_VIEW`, Personal DENY and evidence scope at both create and consume time. Buyer projections SHALL include only public reason/deadline/status; internal note, Staff identity internals, financial internals, object key and permanent URL SHALL remain excluded.

#### Scenario: Authorized proof read

- **WHEN** in-scope Staff with current `ORDER_VIEW` creates and consumes a read intent for the evidence screenshot
- **THEN** verified bytes are returned once without exposing storage location or granting broader file authority.

#### Scenario: DTO or scope isolation

- **WHEN** a Buyer requests its projection, Staff loses permission/scope, or a verifier scans the response
- **THEN** internal note, unrelated customer data, R2 keys, permanent URLs and out-of-scope files are absent or concealed.
