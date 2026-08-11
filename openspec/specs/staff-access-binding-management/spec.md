# staff-access-binding-management Specification

## Purpose

Let the total administrator manage Moonwhite Staff email accounts, one canonical role and explicit Marketplace responsibility without a Feishu binding or invitation workflow.

## Requirements

### Requirement: Only the total administrator manages Staff accounts

The system SHALL expose Staff account management only to a current ACTIVE owner whose effective authorization contains `STAFF_MANAGE` and `PERMISSION_MANAGE`. Personal DENY SHALL remain final and UI visibility SHALL never replace backend authorization.

#### Scenario: Unauthorized direct request

- **WHEN** a non-owner, missing-permission or personally denied Staff calls any account-management endpoint
- **THEN** the backend returns a generic forbidden response without returning employee data.

### Requirement: Owner creates explicit email-based Staff accounts

The system SHALL let an authorized owner create an employee with a display name, normalized unique login email, exactly one canonical role and explicit ACTIVE Marketplace codes. It SHALL NOT create a Feishu binding, invitation token, Team selection, arbitrary permission grant or Provider identity.

#### Scenario: New employee is created

- **WHEN** a valid exact request supplies one role and allowed Marketplace codes
- **THEN** one Staff account, one ACTIVE role, one ACTIVE email identity and the requested Marketplace scopes are created atomically, with prior sessions absent.

### Requirement: Marketplace responsibility uses PRIMARY and SUPPORT

For each non-owner `role × Marketplace`, the first ACTIVE employee SHALL be PRIMARY and later ACTIVE employees SHALL be SUPPORT. Disabling a PRIMARY SHALL atomically promote a deterministic eligible SUPPORT when one exists. PRIMARY changes SHALL affect queue ownership only; SUPPORT visibility SHALL remain identical for the same role and Marketplace.

#### Scenario: Primary employee is disabled

- **WHEN** an authorized owner disables a PRIMARY account
- **THEN** its sessions are revoked and one eligible SUPPORT is promoted without expanding any role or Marketplace visibility.

### Requirement: Account changes invalidate authority predictably

Role, email, Marketplace and status mutations SHALL require `expected_version`, preserve exactly one ACTIVE role, reject self-disable or unsafe final-owner removal and advance authorization/session versions so previous Sessions fail closed.

#### Scenario: Stale account update

- **WHEN** the supplied version does not match the current account
- **THEN** the mutation is rejected without partial identity, role, scope, Session, audit or outbox changes.

### Requirement: Management projections minimize identity data

The account list SHALL return only Staff ID, display name, normalized login email, status, version, canonical role, Marketplace codes/scopes, last login time and update time with `Cache-Control: no-store`. It SHALL NOT return Provider subjects, tokens, hashes, Cookie values, Feishu identifiers or arbitrary permission internals.

#### Scenario: Owner reads the employee list

- **WHEN** an authorized owner loads the workspace
- **THEN** the Web displays employee, email, role, Marketplace PRIMARY/SUPPORT and status without exposing identity secrets or a Feishu workflow.
