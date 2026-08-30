# Seller OWNER/OPERATIONS write authorization Specification

## ADDED Requirements

### Requirement: Seller member capabilities have one authoritative matrix

The domain authorization policy MUST define the canonical capability result for
each of the four active Seller member roles: `OWNER`, `OPERATIONS`, `FINANCE`,
and `VIEWER`. The policy MUST distinguish general operational writes from
store creation, settlement-account writes, member management, and settlement
financial reads. Unknown runtime role values MUST fail closed.

#### Scenario: General operational-write matrix

- **WHEN** the policy is queried for `OWNER`, `OPERATIONS`, `FINANCE`, and
  `VIEWER` against general Seller operational writes
- **THEN** it returns `true`, `true`, `false`, and `false`, respectively.

#### Scenario: Explicit exception matrix

- **WHEN** the policy is queried for the exception capabilities
- **THEN** all four roles may create an authorized store; `OWNER`,
  `OPERATIONS`, and `FINANCE` may write the settlement account; only `OWNER`
  may manage members; and only `OWNER` and `FINANCE` may read the existing
  settlement financial summary/payables projection.

#### Scenario: Unknown role fails closed

- **WHEN** a runtime value outside the four canonical Seller member roles is
  queried
- **THEN** it has no capabilities and cannot authorize a Seller command.

### Requirement: Equivalent Seller operational-write call sites use the shared policy

Seller product-application submit/withdraw, demand-batch submit/withdraw, and
product-application image upload intent/content/complete commands MUST use the
shared general operational-write policy in addition to their existing active
membership, organization/store scope, state, idempotency, version, file, and
audit checks. `OWNER` and `OPERATIONS` behavior MUST remain allowed, while
`FINANCE` and `VIEWER` behavior MUST remain forbidden with the existing status
and error envelope.

#### Scenario: Owner and operations retain operational writes

- **WHEN** an active `OWNER` or `OPERATIONS` member executes an existing
  product-application, demand-batch, or product-image-upload command in the
  member's authorized organization
- **THEN** the command reaches its existing validation/state/transaction path
  and retains its existing success response.

#### Scenario: Finance and viewer remain read-only for operational writes

- **WHEN** an active `FINANCE` or `VIEWER` member executes one of those
  operational-write commands
- **THEN** it is rejected with the existing `403` behavior and no business
  write, audit event, or idempotency completion is created.

### Requirement: Seller write exceptions remain explicit

Store creation MUST continue to allow every active Seller member role after
organization and marketplace checks. Settlement-account update MUST continue
to allow `OWNER`, `OPERATIONS`, and `FINANCE`, but not `VIEWER`. Member listing,
invitation issue, and invitation revoke MUST remain Owner-only. These exception
rules MUST NOT be inferred from or broadened by the general operational-write
capability.

#### Scenario: Store creation is broader than operational writes

- **WHEN** each of the four active Seller roles creates a valid authorized
  store
- **THEN** each receives the existing successful create response and replay
  semantics.

#### Scenario: Settlement-account and member rules stay separate

- **WHEN** `FINANCE` updates the settlement account or `OPERATIONS` manages a
  member
- **THEN** the first retains its existing allowed behavior and the second
  retains its existing Owner-only `403` behavior.

### Requirement: Authentication, scope, concealment, and command invariants stay unchanged

The refactor MUST preserve middleware authentication and password-change
handling, active Seller membership resolution, organization/store scope,
cross-organization concealed `404`, Origin Guard, idempotency replay and
request-hash behavior, audit/event behavior, expected-version conflicts, and
state-machine validation. It MUST NOT alter API DTOs, HTTP statuses, database
schema/migrations, ledgers, audit records, idempotency keys, or frontend/CSS.

#### Scenario: Authentication and membership failures remain bounded

- **WHEN** a Seller route is called without a session or with an active login
  account that has no active Seller membership
- **THEN** it returns the existing `401 UNAUTHENTICATED` or `401
  SESSION_INVALID` result and does not enter a Seller command.

#### Scenario: Cross-organization access remains concealed

- **WHEN** an authenticated Seller member requests a product, application, or
  file outside the member's organization
- **THEN** the existing concealed `404` boundary and non-leakage assertions
  remain unchanged.

#### Scenario: Replay and version conflict remain command-owned

- **WHEN** a valid operational write is replayed with the same idempotency key
  and body, or is submitted with a stale expected version
- **THEN** the existing replay result or `409 VERSION_CONFLICT` is returned,
  with no duplicate business transition or audit event.

### Requirement: Unrelated Seller read and Staff authorization rules remain unchanged

Seller read-intent POST routes, public member registration, Seller
settlement-batch read-only routes, file-read authorization, and Seller payment
list/detail reads MUST NOT be changed by this refactor. Staff lower-case role
and permission rules MUST remain in their current Staff authorization modules.

#### Scenario: Existing payment-read boundary is preserved

- **WHEN** an active Seller member reads the existing settlement payment list or
  detail route
- **THEN** the current route behavior remains unchanged, including its current
  lack of the summary/payables financial-role gate.

## Compatibility note

The payment-read scenario above records the historical scope of this
write-authorization Change. The later `seller-settlement-read-boundary` Change
supersedes only that payment list/detail read behavior by applying the existing
`OWNER`/`FINANCE` financial-read gate; it does not alter any write
authorization requirement in this spec.
