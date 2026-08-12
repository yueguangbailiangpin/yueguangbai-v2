# staff-role-consolidation Specification

## Purpose
TBD - created by archiving change staff-four-role-consolidation. Update Purpose after archive.
## Requirements
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

#### Scenario: Unapproved support mapping is encountered
- **WHEN** a historical support-only Staff has no approved unique target mapping
- **THEN** no new active role or newly writable capability is granted and the unresolved mapping remains reported for owner review.

### Requirement: Current Staff role set is exactly five roles
The current formal Staff role model SHALL contain exactly `owner`, `acquisition`, `pre_sales`, `seller_ops`, and `buyer_refund`. Each ACTIVE Staff SHALL have exactly one ACTIVE assignment from that set. Historical four-role Migration 0035 evidence SHALL remain retained and non-authoritative; no historical Migration or Decision is rewritten.

#### Scenario: Current role contract is inspected
- **WHEN** the current Staff contract and authorization boundary are inspected
- **THEN** the five codes are present exactly once, including `acquisition`, and historical four-role records remain distinguishable from current assignments.

#### Scenario: Current assignment is ambiguous
- **WHEN** an ACTIVE Staff has zero or more than one ACTIVE current assignment
- **THEN** authorization fails closed and no current Staff Session is issued.

### Requirement: Permission differences are reviewed
Before assignment cutover, the system SHALL calculate old and proposed effective permissions per Staff, including additions, removals, Personal DENY and team scope, and SHALL bind approval to the exact mapping version.

#### Scenario: Mapping changes after approval
- **WHEN** roles, permission defaults, overrides or mapping content differ from the approved hash/version
- **THEN** the cutover is rejected and requires a new review.

### Requirement: Buyer refund role preserves bounded after-sales duties
The buyer_refund role SHALL preserve the approved review and Buyer refund duties of after_sales and SHALL NOT gain internal profit, Seller agreement, Staff management or high-risk identity authority by default.

#### Scenario: Buyer refund Staff accesses protected domains
- **WHEN** the Staff performs review/refund work or requests an excluded internal/Seller/admin resource
- **THEN** approved Buyer after-sales work is allowed within scope and excluded domains remain forbidden or concealed.

### Requirement: Backend authorization remains authoritative
Current effective permissions SHALL be derived from exactly one canonical role's default permissions, then reduced by Personal DENY and system hard prohibitions. Historical Personal GRANT and Team/Leader permission-pack rows SHALL remain auditable but SHALL NOT expand current effective permissions. Marketplace, organization, team, customer, store, resource and field projection SHALL still be enforced after capability authorization.

#### Scenario: Historical authority inputs are present
- **WHEN** an ACTIVE Staff has historical Personal GRANT rows or Team/Leader membership data
- **THEN** those rows remain available for audit but add no current permission, while Personal DENY still removes a role-default permission.

#### Scenario: UI and backend disagree
- **WHEN** a hidden menu is called directly or stale UI/client authority shows an action
- **THEN** the backend recalculates current role authority and denies any action not allowed by the trusted canonical role and current scope.

#### Scenario: Consultation route receives a Staff cookie
- **WHEN** the consultation endpoint receives a missing, revoked or authorization-version-stale Staff cookie, an owner with D1 Personal DENY, or an acquisition actor carrying historical GRANT and Team/Leader rows
- **THEN** the real Staff session middleware resolves the cookie, recomputes current D1 authority, returns 401 for invalid/stale sessions and 403 for valid but unauthorized sessions, and creates no command claim.

### Requirement: Migration is recoverable
The role migration SHALL be consecutive, preserve all rows and authorization history, revoke old Sessions at cutover and provide tested pre-cutover restore and post-cutover forward-recovery evidence.

#### Scenario: Cutover assertion fails
- **WHEN** row counts, mapping approval, permission diff, role constraint or Session revocation does not match
- **THEN** the transaction fails without partial active-role conversion and Staff writes remain frozen.
