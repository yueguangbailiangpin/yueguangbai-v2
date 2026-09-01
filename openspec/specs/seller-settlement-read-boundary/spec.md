# seller-settlement-read-boundary Specification

## Purpose

TBD: Define the Seller settlement read authorization boundary and preserve safe, organization-scoped financial and batch projections.

## Requirements

### Requirement: Legacy Seller financial reads are OWNER/FINANCE-only

The Seller summary, payable list, payable detail, payment list, and payment detail endpoints MUST allow active Seller members with role `OWNER` or `FINANCE`. Active `OPERATIONS` and `VIEWER` members MUST receive a concealed 404 and no legacy financial response body. The existing financial DTO fields and strict runtime schemas MUST remain unchanged.

#### Scenario: Owner and finance read all legacy financial endpoints

- **WHEN** an active `OWNER` or `FINANCE` Seller member calls each of summary, payables, payable detail, payments, and payment detail within the member's organization
- **THEN** each authorized endpoint returns 200 with its existing response envelope and existing DTO fields.

#### Scenario: Operations and viewer cannot read legacy financial endpoints

- **WHEN** an active `OPERATIONS` or `VIEWER` Seller member calls any of the five legacy financial endpoints
- **THEN** the endpoint returns concealed 404 and the response does not expose an amount, payment ID, allocation ID, payable ID, or financial payload.

### Requirement: Seller financial reads remain organization-scoped

All five legacy financial endpoints MUST derive the Seller organization from the authenticated active membership. Detail queries MUST constrain the target by that organization and return concealed 404 for foreign or unknown IDs. List queries MUST NOT return another organization's financial rows. Existing active-store and disabled-store-history semantics MUST remain unchanged.

#### Scenario: Foreign payment detail is concealed

- **WHEN** an authorized Seller member requests a payment ID belonging to a different Seller organization
- **THEN** the response is 404 and contains no payment or allocation data.

#### Scenario: Invalid Seller session remains fail-closed

- **WHEN** a request has no customer session, an invalid session, or an active login with no active Seller membership
- **THEN** the response remains the existing 401 authentication/session result and no settlement read model is entered.

### Requirement: Payables and payments preserve cursor compatibility

The payables and payments list endpoints MUST preserve their existing page envelope, encoded cursor token, limit validation, keyset ordering, and malformed-cursor 400 behavior. Traversing multiple pages MUST neither repeat nor omit a row.

#### Scenario: Payables traverse two pages

- **WHEN** an authorized OWNER or FINANCE member requests payables with a limit smaller than the seeded result set and follows `next_cursor`
- **THEN** the combined pages contain every expected payable exactly once in `due_at DESC, payable_id DESC` order and the final cursor is null.

#### Scenario: Payments traverse two pages

- **WHEN** an authorized OWNER or FINANCE member requests payments with a limit smaller than the seeded result set and follows `next_cursor`
- **THEN** the combined pages contain every expected payment exactly once in `paid_at DESC, payment_id DESC` order and the final cursor is null.

#### Scenario: Malformed settlement cursor is rejected

- **WHEN** an authorized Seller member sends a malformed payables or payments cursor
- **THEN** the endpoint returns the existing validation error with status 400 and no financial page is returned.

### Requirement: Seller batch reads preserve the four-role safe projection

The Seller batch list and detail endpoints MUST allow all four active Seller member roles to read their own organization's non-draft, non-cancelled batches. They MUST continue using the dedicated strict Seller-safe DTO and MUST NOT expose internal profit, Buyer refund data, Staff IDs, internal notes, object storage keys, organization metadata, or employee batch fields.

#### Scenario: All active Seller roles read a visible batch

- **WHEN** an active `OWNER`, `OPERATIONS`, `FINANCE`, or `VIEWER` Seller member requests a visible batch list and detail in its own organization
- **THEN** both endpoints return 200 with only the existing Seller-safe batch and member fields.

#### Scenario: Draft, cancelled, and foreign batches remain concealed

- **WHEN** a Seller member requests a DRAFT, CANCELLED, or foreign batch detail
- **THEN** the response is concealed 404; a list contains no such batch.

#### Scenario: Buyer cannot access Seller batches

- **WHEN** an authenticated Buyer calls the Seller batch list or detail route
- **THEN** the response is 404 and no batch data is exposed.

### Requirement: Frontend and backend settlement gates agree

The Seller frontend MUST continue rendering the full legacy financial page only for `OWNER` and `FINANCE`, and the batch-only page for `OPERATIONS` and `VIEWER`. The backend payment list/detail boundary MUST match this existing presentation gate. No CSS or visual contract changes are included.

#### Scenario: Operations and viewer receive the batch-only surface

- **WHEN** an active `OPERATIONS` or `VIEWER` member opens Seller settlements
- **THEN** the frontend requests and renders Seller-safe batches without requesting the legacy summary, payable, or payment financial sections.

### Requirement: This Change does not alter financial facts or writes

The implementation MUST NOT add a migration, change database schema, mutate payment/payable/allocation facts, change batch state transitions, add Seller batch writes, alter shared cursor code, or change automatic reservation review.

#### Scenario: Existing financial and batch write behavior is preserved

- **WHEN** the focused and full local test suites run after this Change
- **THEN** existing financial ledger behavior, batch state-machine behavior, and unrelated Seller/Buyer authorization behavior remain passing.
