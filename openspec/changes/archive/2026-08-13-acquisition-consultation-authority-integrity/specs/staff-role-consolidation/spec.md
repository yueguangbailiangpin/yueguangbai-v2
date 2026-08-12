# Staff authorization legacy-input alignment

## MODIFIED Requirements

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
