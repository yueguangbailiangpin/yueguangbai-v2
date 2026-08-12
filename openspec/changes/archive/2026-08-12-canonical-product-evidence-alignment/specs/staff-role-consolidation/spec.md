# Staff role consolidation alignment

## REMOVED Requirements

### Requirement: Active Staff roles are four canonical roles

The four-role wording is historical and is removed as the current canonical role requirement. It remains preserved in archived Change and historical Migration evidence.

## MODIFIED Requirements

### Requirement: Role display is Chinese and login is role-free

Staff UI SHALL display 总管理员, 获客, 售前, 卖家对接, and 买家返款 from backend authorization and SHALL NOT ask the employee to choose a role at login.

#### Scenario: Staff signs in

- **WHEN** an ACTIVE Staff account with one current canonical role signs in
- **THEN** one trusted Session receives that role's effective authorization and the workbench renders permitted areas without a role selector, including the acquisition workbench for `acquisition`.

#### Scenario: Multiple active roles are encountered

- **WHEN** an ACTIVE Staff account has zero or more than one ACTIVE role assignment
- **THEN** authorization fails closed and no Staff Session is issued until the assignment is corrected and audited.

### Requirement: Legacy mapping is explicit and auditable

The historical four-role consolidation and its approval/permission-diff rules SHALL remain auditable and SHALL NOT rewrite Migration 0035 or D-024. The current formal role set SHALL be exactly `owner`, `acquisition`, `pre_sales`, `seller_ops`, and `buyer_refund`; Migration 0044's introduction of `acquisition` is the current fifth-role boundary.

#### Scenario: Historical and current role facts are inspected

- **WHEN** historical Migration/Decision evidence and current role contracts are queried
- **THEN** the four-role stage remains historical while current ACTIVE role validation accepts exactly the five current role codes.

#### Scenario: An unknown or historical-only role is presented as current

- **WHEN** authorization receives a role outside the five current role codes
- **THEN** it fails closed without rewriting the historical row or granting current permissions.

#### Scenario: Unapproved support mapping is encountered

- **WHEN** a historical support-only Staff has no approved unique target mapping
- **THEN** no new active role or newly writable capability is granted and the unresolved mapping remains reported for owner review.

## ADDED Requirements

### Requirement: Current Staff role set is exactly five roles

The current formal Staff role model SHALL contain exactly `owner`, `acquisition`, `pre_sales`, `seller_ops`, and `buyer_refund`. Each ACTIVE Staff SHALL have exactly one ACTIVE assignment from that set. Historical four-role Migration 0035 evidence SHALL remain retained and non-authoritative; no historical Migration or Decision is rewritten.

#### Scenario: Current role contract is inspected

- **WHEN** the current Staff contract and authorization boundary are inspected
- **THEN** the five codes are present exactly once, including `acquisition`, and historical four-role records remain distinguishable from current assignments.

#### Scenario: Current assignment is ambiguous

- **WHEN** an ACTIVE Staff has zero or more than one ACTIVE current assignment
- **THEN** authorization fails closed and no current Staff Session is issued.
