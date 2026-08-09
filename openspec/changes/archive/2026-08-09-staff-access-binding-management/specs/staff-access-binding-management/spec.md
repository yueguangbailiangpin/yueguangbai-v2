# staff-access-binding-management Specification

## ADDED Requirements

### Requirement: Only the total administrator manages Staff access

The system SHALL expose Staff access management only to a current Staff Session whose sole role is `owner` and whose effective authorization includes both `STAFF_MANAGE` and `PERMISSION_MANAGE`. Personal DENY SHALL remain final, and UI visibility SHALL never replace backend authorization.

#### Scenario: Authorized owner opens the module

- **WHEN** the current unique owner retains both required permissions
- **THEN** the system returns the minimal employee and pending-invitation projection and renders the management workspace

#### Scenario: Hidden route is called directly

- **WHEN** any non-owner, multi-role, missing-permission or personally denied Staff calls a management API
- **THEN** the backend rejects the request without returning Staff or Feishu binding data

### Requirement: Employee provisioning uses a single-use verified Feishu invitation

The system SHALL let an owner issue a 24-hour invitation containing only a display name, one canonical role and, for a non-owner, exactly one explicitly selected ACTIVE Team. It SHALL NOT default an invited employee into every Team. It SHALL return the opaque invitation token once, SHALL store only its hash, and SHALL require the invited employee to complete Provider verification through the existing single Feishu application before reusing the existing provision command. Normal unknown-identity login SHALL continue to be rejected.

#### Scenario: Invited employee binds successfully

- **WHEN** an unexpired ISSUED invitation starts a single-use OAuth state and the configured Feishu Provider verifies a unique subject
- **THEN** exactly one ACTIVE Staff, one canonical ACTIVE role, the invited Team membership for a non-owner, and one ACTIVE Feishu identity are created, the invitation becomes CONSUMED, and an internal Staff Session is issued

#### Scenario: Unknown employee attempts ordinary login

- **WHEN** a verified Feishu subject has no D1 binding and no valid binding invitation state
- **THEN** login remains rejected and no Staff, role, permission, identity or Session is created

#### Scenario: Invite or callback is replayed

- **WHEN** a cancelled, expired, consumed or repeated invitation/state is presented
- **THEN** the request fails closed and deterministic idempotency prevents duplicate Staff creation

### Requirement: Staff lifecycle preserves one role and owner continuity

The system SHALL require `expected_version` and Idempotency-Key for role and status mutations, SHALL keep each ACTIVE Staff on exactly one canonical ACTIVE role, SHALL invalidate prior sessions after authority/status changes, and SHALL prohibit self-disable, self-role-change and removal of the last ACTIVE owner.

#### Scenario: Owner changes another employee role

- **WHEN** the target version matches and owner continuity remains valid
- **THEN** the old role becomes historical, exactly one target role becomes ACTIVE, authorization/session versions advance and prior sessions are revoked

#### Scenario: Owner disables or enables another employee

- **WHEN** the target version matches and all enable/disable preconditions hold
- **THEN** Staff status, versions, sessions, authorization event, audit and outbox change atomically

#### Scenario: Unsafe owner continuity change is attempted

- **WHEN** an owner targets themselves or would disable/demote the final ACTIVE owner
- **THEN** the command is rejected without partial role, status, identity or Session changes

### Requirement: Management projections minimize identity data

The system SHALL return only Staff ID, display name, status, version, canonical role, Feishu binding status, verification time, active Team options and safe invitation lifecycle fields. It SHALL NOT return Feishu `open_id`, `user_id`, tenant key, token/state hashes, Provider tokens, full claims, Cookie/session hashes or arbitrary permission internals.

#### Scenario: Owner reads the employee list

- **WHEN** an authorized owner loads or refreshes the module
- **THEN** the response contains only the bounded safe projection with `Cache-Control: no-store`

### Requirement: Employee management remains an access module, not an HR system

The Web workspace SHALL reuse `tokens.css`, preserve the employee high-density visual direction, work responsively, and expose only invitation, role, binding status and enable/disable controls. It SHALL NOT add a new UI framework, external font, arbitrary permission builder, employee phone/department directory, payroll or attendance facts.

#### Scenario: Owner uses desktop or mobile management

- **WHEN** the module is rendered at supported responsive widths
- **THEN** the same authoritative fields and guarded actions remain usable without inventing HR or Provider data
