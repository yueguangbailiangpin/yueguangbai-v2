# staff-role-consolidation Specification

## Purpose
TBD - created by archiving change staff-four-role-consolidation. Update Purpose after archive.
## Requirements
### Requirement: Active Staff roles are four canonical roles
After cutover, each ACTIVE Staff SHALL have exactly one ACTIVE role assignment using owner, pre_sales, seller_ops or buyer_refund, while historical legacy assignments remain auditable and non-authoritative.

#### Scenario: Role state is inspected after migration
- **WHEN** current assignments and historical assignments are queried
- **THEN** every ACTIVE Staff has exactly one ACTIVE row using one of four codes and every retained legacy row is revoked or historical.

### Requirement: Role display is Chinese and login is role-free
Staff UI SHALL display 总管理员, 售前, 卖家对接 and 买家返款 from backend authorization and SHALL NOT ask the employee to choose a role at login.

#### Scenario: Staff signs in
- **WHEN** an ACTIVE Staff account with one canonical role signs in
- **THEN** one trusted Session receives that role's effective authorization and the workbench renders permitted areas without a role selector.

#### Scenario: Multiple active roles are encountered
- **WHEN** an ACTIVE Staff account has zero or more than one ACTIVE role assignment
- **THEN** authorization fails closed and no Staff Session is issued until the assignment is corrected and audited.

### Requirement: Legacy mapping is explicit and auditable
The migration SHALL map owner, pre_sales, seller_ops and after_sales to their canonical successors and SHALL require an owner-approved, unique-target per-Staff mapping before buyer_support, seller_support or multiple legacy roles become one active role.

#### Scenario: Unapproved support mapping is encountered
- **WHEN** a support-only Staff has no approved target mapping
- **THEN** no new active role or newly writable capability is granted and cutover reports the unresolved Staff.

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
Role consolidation SHALL preserve the effective authorization formula, Personal DENY final precedence, hard prohibitions and organization/team/customer/store/resource projection.

#### Scenario: UI and backend disagree
- **WHEN** a hidden menu is called directly or stale UI shows an action
- **THEN** the backend recalculates authority and denies any action not present in the current trusted context.

### Requirement: Migration is recoverable
The role migration SHALL be consecutive, preserve all rows and authorization history, revoke old Sessions at cutover and provide tested pre-cutover restore and post-cutover forward-recovery evidence.

#### Scenario: Cutover assertion fails
- **WHEN** row counts, mapping approval, permission diff, role constraint or Session revocation does not match
- **THEN** the transaction fails without partial active-role conversion and Staff writes remain frozen.
