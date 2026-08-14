# customer-identity-access Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Invitation and recovery boundaries resist abuse and replay

The system SHALL apply exact-input validation, allowed Origin, bounded operation-isolated rate limits, hashed network/device/token/account keys where applicable, idempotency, version conditions, final Personal DENY for permission-governed Staff commands, fixed public errors and sanitized security events to invitation, recovery and authenticated password-change operations.

#### Scenario: Repeated abusive requests

- **WHEN** a network, device, identity, account or token exceeds its configured operation window
- **THEN** the operation returns a stable rate-limit response without revealing whether an account or invitation exists or exposing raw rate-limit dimensions.

#### Scenario: Idempotent Staff issuance replay

- **WHEN** an authorized Staff repeats the same issuance command with the same idempotency key and body
- **THEN** the same safe issuance result is replayed and no second active token is created.
