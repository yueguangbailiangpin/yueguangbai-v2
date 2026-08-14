# customer-identity-access Specification

## Purpose
TBD - created by archiving change customer-multipersona-invitation-recovery. Update Purpose after archive.
## Requirements
### Requirement: One Customer account can resolve isolated Buyer and Seller personas

The system SHALL bind one normalized WeChat identity to one Customer login account and credential set, SHALL allow that account to own both one Buyer Profile and one Seller Organization Member Profile, and SHALL resolve Buyer and Seller authority independently at their respective controlled route boundaries.

#### Scenario: Dual-persona Customer

- **WHEN** an authenticated Customer with both Personas enters the Buyer or Seller portal
- **THEN** the server resolves only the requested Persona and returns only that Persona's permitted projection.

#### Scenario: Missing Persona

- **WHEN** an authenticated Customer enters a portal for a Persona they do not own
- **THEN** access fails without creating the Persona or disclosing another Customer's data.

### Requirement: A Customer can belong to at most one Seller Organization

The system SHALL enforce at the database and command boundaries that one Customer Identity Subject has at most one effective Seller Organization Membership, including pending/active lifecycle states defined by the implementation.

#### Scenario: First Seller membership

- **WHEN** an authorized command creates the only allowed Seller Membership for a Customer
- **THEN** it succeeds without affecting an existing Buyer Profile.

#### Scenario: Second Seller organization

- **WHEN** any command attempts to bind the same Customer to another Seller Organization
- **THEN** it fails atomically and preserves the original Membership.

### Requirement: Buyer registration requires a Staff-issued single-use invitation

The system SHALL require a cryptographically random invitation bound to normalized WeChat, Marketplace, issuing ACTIVE Staff and a seven-day expiry, SHALL store only the token hash, SHALL allow revocation before use, SHALL treat issuance as approval for an ordinary conflict-free Buyer, and SHALL atomically activate the Buyer/Account, issue the Customer Session and consume the invitation only when registration succeeds. High-risk identity conflicts SHALL remain owner-only and fail closed before activation.

#### Scenario: Valid invited registration

- **WHEN** the matching Customer submits valid registration data with an unexpired unrevoked invitation
- **THEN** ACTIVE Identity, Account and Buyer Persona facts are created or linked, one Customer Session is issued and the invitation is consumed exactly once.

#### Scenario: Invalid or replayed invitation

- **WHEN** an invitation is missing, expired, revoked, consumed, bound to another WeChat/Marketplace or concurrently won by another request
- **THEN** registration fails without creating partial identity facts or exposing invitation details.

#### Scenario: High-risk identity conflict

- **WHEN** a valid invitation matches an identity with a high-risk claim, merge, correction or prior-release conflict
- **THEN** registration fails before activation and only the owner-governed conflict workflow may resolve it.

### Requirement: All active Staff can issue auditable password reset links

The system SHALL allow every ACTIVE Staff user with a valid Staff Session to issue a bounded single-use Customer password reset link after manual identity verification, SHALL prevent Staff from reading or choosing the new password, and SHALL revoke all Customer Sessions after successful reset.

#### Scenario: Successful reset

- **WHEN** the Customer submits an unexpired unconsumed reset token and a policy-compliant new password
- **THEN** the credential changes, the token is consumed, all prior Customer Sessions become invalid and an immutable Audit event is appended.

#### Scenario: Staff attempts to set password

- **WHEN** a Staff request includes a Customer new password or requests existing credential material
- **THEN** the request is rejected and no password or hash is returned.

### Requirement: Invitation and recovery boundaries resist abuse and replay

The system SHALL apply exact-input validation, allowed Origin, bounded operation-isolated rate limits, hashed network/device/token/account keys where applicable, idempotency, version conditions, final Personal DENY for permission-governed Staff commands, fixed public errors and sanitized security events to invitation, recovery and authenticated password-change operations.

#### Scenario: Repeated abusive requests

- **WHEN** a network, device, identity, account or token exceeds its configured operation window
- **THEN** the operation returns a stable rate-limit response without revealing whether an account or invitation exists or exposing raw rate-limit dimensions.

#### Scenario: Idempotent Staff issuance replay

- **WHEN** an authorized Staff repeats the same issuance command with the same idempotency key and body
- **THEN** the same safe issuance result is replayed and no second active token is created.

### Requirement: Customer-security Staff commands honor final Personal DENY

Customer login-identifier change SHALL require an ACTIVE owner whose effective permissions contain `BUYER_IDENTITY_HIGH_RISK_MANAGE`. Seller registration invitation issue, Staff read and revoke SHALL require an ACTIVE owner or seller operator whose effective permissions contain `SELLER_MANAGE`. The effective permission check SHALL consume current D1 authorization after Personal DENY and SHALL fail before protected Customer-security reads or writes.

#### Scenario: Owner is personally denied high-risk identity management

- **WHEN** an ACTIVE owner whose Personal DENY removes `BUYER_IDENTITY_HIGH_RISK_MANAGE` requests a Customer login-identifier change
- **THEN** the server returns the generic forbidden response and creates no identity claim, account, event, Audit or Session-version change.

#### Scenario: Seller duty role is personally denied Seller management

- **WHEN** an ACTIVE owner or seller operator whose Personal DENY removes `SELLER_MANAGE` issues, reads or revokes a Seller registration invitation
- **THEN** the server returns the generic forbidden response before reading or mutating the protected invitation facts.

### Requirement: Authenticated password change has an independent abuse boundary

Customer password change SHALL consume a fixed-window rate limit keyed independently by the server-derived authenticated account, normalized network source and bounded device identifier before current-password verification and before idempotency acquisition. Stored dimensions SHALL be irreversible keyed hashes. Exceeding any dimension SHALL return a stable `RATE_LIMITED` response with `Retry-After`, append only a sanitized blocked security event and create no credential, Session-version, idempotency or business mutation.

#### Scenario: Repeated current-password guesses are blocked

- **WHEN** an authenticated Customer exceeds the password-change threshold for the account, network or device window
- **THEN** the next request is blocked before password verification with no password or account-existence disclosure.

#### Scenario: Password-change counters are isolated

- **WHEN** login, invitation, password-reset and password-change requests use the same network or device
- **THEN** each operation consumes only its own configured counter and cannot exhaust another operation's allowance.
