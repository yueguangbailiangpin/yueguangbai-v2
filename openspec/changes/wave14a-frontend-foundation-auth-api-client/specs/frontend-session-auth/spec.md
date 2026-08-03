# Frontend Session and Auth Capability

## ADDED Requirements

### Requirement: Buyer, Seller, and Staff have independent frontend Session domains

The frontend SHALL define separate Buyer, Seller, and Staff Session boundaries, controllers, route guards, query roots, and logout cleanup. Each SHALL use exactly `UNKNOWN`, `LOADING`, `AUTHENTICATED`, `UNAUTHENTICATED`, and `DEPENDENCY_ERROR`. It SHALL NOT expose a mixed-identity Auth Context or borrow another identity's roles/data.

#### Scenario: Matching Session resolution

- **WHEN** one identity route starts Session resolution
- **THEN** only that identity state moves UNKNOWN → LOADING → one terminal state and only matching protected data can render after AUTHENTICATED.

#### Scenario: Cross-domain state reuse

- **WHEN** code attempts to authenticate one shell from another Session state/cache or introduces a universal identity state
- **THEN** architecture tests fail and no protected data is exposed.

### Requirement: Buyer login follows the real Customer Auth Contract

`/buyer/login` SHALL post `login_identifier` and `password` to `POST /api/customer-auth/login`, SHALL validate `CustomerLoginResponse`, and SHALL accept authentication only when `account_type` is `BUYER`. Session refresh SHALL use `GET /api/customer-auth/session`; required password change SHALL remain a distinct workflow and SHALL NOT be treated as logout.

#### Scenario: Buyer account login

- **WHEN** valid credentials return an active BUYER Session
- **THEN** Buyer state becomes AUTHENTICATED and the allowlisted Buyer return route is entered without reading the Cookie.

#### Scenario: Seller account or password-change state

- **WHEN** the Buyer login receives `SELLER_MEMBER` or the server requires a password change
- **THEN** Buyer protected content remains unavailable and the UI shows the correct domain-mismatch or password-change action without inventing authority.

### Requirement: Seller login follows the real Customer Auth Contract

`/seller/login` SHALL use the same real Customer Auth endpoints but SHALL accept authentication only when `account_type` is `SELLER_MEMBER`. It SHALL NOT offer a client-side role/account-type selector that overrides the server response or unify Buyer and Seller Session authority.

#### Scenario: Seller member login

- **WHEN** valid credentials return an active SELLER_MEMBER Session
- **THEN** Seller state becomes AUTHENTICATED and enters only an allowlisted Seller route.

#### Scenario: Buyer account or spoofed type

- **WHEN** the Seller login receives BUYER or client input attempts to select/override account type
- **THEN** Seller protected content remains unavailable and the server-returned account type remains the only accepted discriminator.

### Requirement: Customer Cookie sharing never creates cross-identity authority

The frontend SHALL document that Buyer and Seller use the same HttpOnly `__Host-ygb_customer_session` transport Cookie while maintaining separate UI state/query domains. It SHALL validate account type on every Customer Session resolution, SHALL never read the Cookie, and SHALL not assume simultaneous Buyer and Seller authentication in one browser profile.

#### Scenario: Customer identity changes

- **WHEN** a new Customer login replaces the shared Cookie with the opposite account type
- **THEN** the newly requested domain validates its type and opposite-domain cached data remains inaccessible behind its own keys/guard.

#### Scenario: Stale opposite-domain cache

- **WHEN** old Seller data exists in memory while the active Customer Session is BUYER, or vice versa
- **THEN** route guards never render it and subsequent opposite-domain Session/API resolution fails closed or returns unauthenticated.

### Requirement: Staff auth uses login start, backend callback, and Worker Session

`/staff/login` SHALL call `POST /api/staff-auth/login/start` with an allowlisted relative `return_to`, validate the returned Feishu authorization URL, and navigate the browser. The backend callback SHALL establish the HttpOnly Staff Cookie; the frontend SHALL then call `GET /api/staff-auth/session` before entering Staff Shell. Wave 14A tests SHALL use Fake Provider and SHALL NOT connect real Feishu.

#### Scenario: Valid Fake Provider flow

- **WHEN** local login start, redirect/callback, Cookie establishment, and Session read succeed
- **THEN** Staff state becomes AUTHENTICATED and the allowlisted Staff return route renders.

#### Scenario: Invalid return, callback, or dependency

- **WHEN** return path is unsafe, callback state fails, Provider configuration is unavailable, or Session read returns a dependency failure
- **THEN** no Staff protected data renders, secrets/tokens are not exposed, and state is UNAUTHENTICATED or DEPENDENCY_ERROR according to the real response.

### Requirement: Session status transitions preserve HTTP semantics

A validated 401 SHALL transition only the request identity to UNAUTHENTICATED. 403 and 404 SHALL preserve AUTHENTICATED. Network, 503, and runtime-contract failures during Session resolution SHALL produce DEPENDENCY_ERROR rather than false logout. Session loading SHALL never render prior protected DTOs.

#### Scenario: Session expiry

- **WHEN** the matching Session endpoint or protected request returns 401
- **THEN** that identity's requests are canceled, its protected cache is removed, and its login route is offered.

#### Scenario: Permission, concealment, or outage

- **WHEN** an authenticated request returns 403/404 or Session resolution returns network/503/contract failure
- **THEN** 403/404 retain authentication while outage uses DependencyUnavailable and no stale private content is shown.

### Requirement: Logout is identity-scoped and does not persist sensitive state

Buyer/Seller logout SHALL use `POST /api/customer-auth/logout`; Staff logout SHALL use `POST /api/staff-auth/logout` and optional approved all-device action SHALL use `/api/staff-auth/logout-all` with required idempotency semantics. The frontend SHALL cancel/remove only the initiating identity query root and SHALL store no Session token or sensitive cache in localStorage/sessionStorage.

#### Scenario: Successful identity logout

- **WHEN** an authenticated identity completes logout
- **THEN** its in-flight requests are canceled, its cache is removed, state becomes UNAUTHENTICATED, and navigation returns to its login/public entry.

#### Scenario: Other identity or storage cleanup

- **WHEN** logout runs while other identity roots exist or code attempts token/cache persistence
- **THEN** no unrelated root is used as authority or indiscriminately exposed/cleared, and persistence checks fail for sensitive data.

### Requirement: Session DTO fields are display context, not client authority

The frontend MAY display validated Session fields such as expiry, display name, roles, permissions, scope, Staff ID, Customer subject, or account type, but SHALL NOT use client modification or local copies to authorize network actions. All protected APIs SHALL be allowed to return 401/403/404 based on current backend facts.

#### Scenario: Display current Session context

- **WHEN** a validated Session DTO is rendered in its matching shell
- **THEN** safe identity/expiry context may be shown and navigation may be tailored as a convenience while backend checks remain final.

#### Scenario: Tampered client Session field

- **WHEN** local code/devtools changes a role, permission, Staff ID, organization ID, or scope value
- **THEN** no additional server access is obtained, the client sends no authority field, and a backend denial is handled safely.
