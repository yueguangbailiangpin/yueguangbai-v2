# Frontend Session and Auth Capability

## ADDED Requirements

> Controller amendment: a Customer account-type mismatch calls Customer logout then clears both Customer roots, enters no shell, and displays a neutral message with no cross-identity handoff.

### Requirement: Buyer, Seller, and Staff have independent frontend Session domains

The frontend SHALL define separate Buyer, Seller, and Staff Session boundaries, controllers, route guards, query roots, and shells. Each SHALL use exactly `UNKNOWN`, `LOADING`, `AUTHENTICATED`, `UNAUTHENTICATED`, and `DEPENDENCY_ERROR`. Buyer and Seller MAY share only a narrow `CUSTOMER_TRANSPORT_INVALIDATION_GROUP` coordinator for cancel/reset/cache removal caused by their shared Cookie; it SHALL carry no combined authenticated identity or authority. The frontend SHALL NOT expose a mixed-identity Auth Context or borrow another identity's roles/data.

#### Scenario: Matching Session resolution

- **WHEN** one identity route starts Session resolution
- **THEN** only that identity state moves UNKNOWN → LOADING → one terminal state and only matching protected data can render after AUTHENTICATED.

#### Scenario: Cross-domain state reuse

- **WHEN** code attempts to authenticate one shell from another Session state/cache or introduces a universal identity state
- **THEN** architecture tests fail and no protected data is exposed.

### Requirement: Buyer login follows the real Customer Auth Contract

`/buyer/login` SHALL post `login_identifier` and `password` to `POST /api/customer-auth/login`, SHALL validate `CustomerLoginResponse`, and SHALL accept authentication only when `account_type` is `BUYER`. Because success replaces the shared Cookie, it SHALL first cancel and clear both Customer roots. Session refresh SHALL use `GET /api/customer-auth/session`; required password change SHALL remain a distinct workflow and SHALL NOT be treated as logout.

#### Scenario: Buyer account login

- **WHEN** valid credentials return an active BUYER Session
- **THEN** Buyer and Seller protected requests/caches are first canceled/cleared, Buyer becomes AUTHENTICATED, Seller remains UNAUTHENTICATED/unresolved, and the allowlisted Buyer return route is entered without reading the Cookie.

#### Scenario: Seller account or password-change state

- **WHEN** the Buyer login receives `SELLER_MEMBER` or the server requires a password change
- **THEN** mismatch calls Customer logout and clears both Customer roots, enters neither Customer shell, reveals no returned account type, and shows a neutral safe notice with no cross-identity link; a matching password-change state continues only to the Buyer password workflow.

### Requirement: Seller login follows the real Customer Auth Contract

`/seller/login` SHALL use the same real Customer Auth endpoints but SHALL accept authentication only when `account_type` is `SELLER_MEMBER`. Successful login SHALL first cancel and clear both Customer roots. It SHALL NOT offer a client-side role/account-type selector that overrides the server response or unify Buyer and Seller Session authority.

#### Scenario: Seller member login

- **WHEN** valid credentials return an active SELLER_MEMBER Session
- **THEN** Buyer and Seller protected requests/caches are first canceled/cleared, Seller becomes AUTHENTICATED, Buyer remains UNAUTHENTICATED/unresolved, and only an allowlisted Seller route is entered.

#### Scenario: Buyer account or spoofed type

- **WHEN** the Seller login receives BUYER or client input attempts to select/override account type
- **THEN** mismatch calls Customer logout and clears both Customer roots, enters neither Customer shell, reveals no returned account type, and shows a neutral safe notice with no cross-identity link while server account type remains the only accepted discriminator.

### Requirement: Customer Cookie sharing never creates cross-identity authority

The frontend SHALL document that Buyer and Seller use the same HttpOnly `__Host-ygb_customer_session` transport Cookie while maintaining separate UI state/query namespaces, guards, and shells. It SHALL define `CUSTOMER_TRANSPORT_INVALIDATION_GROUP`: successful Customer login/Cookie replacement, target/account-type mismatch, successful Customer logout, validated Customer Session 401, or any validated Buyer/Seller protected-API 401 SHALL cancel Buyer and Seller requests, clear both Customer query roots, and reset both Customer Session states to UNAUTHENTICATED or fresh resolution. Staff SHALL remain unchanged. The frontend SHALL never read the Cookie or assume simultaneous Buyer and Seller authentication.

#### Scenario: Customer identity changes

- **WHEN** any Customer login replaces the shared Cookie, including one whose account type differs from the target domain
- **THEN** both Customer roots are canceled/cleared before only the matching domain may authenticate; mismatch calls Customer logout, enters neither shell, and provides no cross-identity handoff or account-type disclosure.

#### Scenario: Stale opposite-domain cache

- **WHEN** Customer logout/401 occurs or old opposite-domain data exists while the active Cookie identity changes
- **THEN** Buyer and Seller requests/caches are both removed and states reset/re-resolved, no stale opposite-domain data renders, and Staff remains unchanged.

### Requirement: Staff auth uses login start, backend callback, and Worker Session

`/staff/login` SHALL call `POST /api/staff-auth/login/start` with an allowlisted relative `return_to`, validate the returned Feishu authorization URL, and navigate the browser. The backend callback SHALL establish the HttpOnly Staff Cookie; the frontend SHALL then call `GET /api/staff-auth/session` before entering Staff Shell. Wave 14A tests SHALL use Fake Provider and SHALL NOT connect real Feishu.

#### Scenario: Valid Fake Provider flow

- **WHEN** local login start, redirect/callback, Cookie establishment, and Session read succeed
- **THEN** Staff state becomes AUTHENTICATED and the allowlisted Staff return route renders.

#### Scenario: Invalid return, callback, or dependency

- **WHEN** return path is unsafe, callback state fails, Provider configuration is unavailable, or Session read returns a dependency failure
- **THEN** no Staff protected data renders, secrets/tokens are not exposed, and state is UNAUTHENTICATED or DEPENDENCY_ERROR according to the real response.

### Requirement: Session status transitions preserve HTTP semantics

A validated Customer 401 from Customer Session or any Buyer/Seller protected API SHALL invalidate Buyer and Seller through `CUSTOMER_TRANSPORT_INVALIDATION_GROUP`; a validated Staff 401 SHALL invalidate only Staff. 403 and 404 SHALL preserve every Session state. Network, 503, and runtime-contract failures during Session resolution SHALL produce DEPENDENCY_ERROR rather than false logout. Session loading SHALL never render prior protected DTOs.

`/buyer/change-password` and `/seller/change-password` SHALL use a dedicated Customer password route boundary rather than the protected-shell guard. It SHALL read the formal Customer Session, allow only the matching route `account_type`, and permit entry whether `password_change_required` is true or false. A Customer 401 SHALL clear both Customer roots and return to the same-domain login; mismatch SHALL call Customer logout and clear both roots; dependency failure SHALL remain retryable and render no form. A matching Session SHALL render the password form directly without redirecting to the same route.

#### Scenario: Session expiry

- **WHEN** Customer Session/Buyer/Seller protected API returns 401 or Staff Session/protected API returns 401
- **THEN** Customer failure cancels/clears and unauthenticates/re-resolves both Customer domains only, while Staff failure cancels/clears and unauthenticates Staff only.

#### Scenario: Permission, concealment, or outage

- **WHEN** an authenticated request returns 403/404 or Session resolution returns network/503/contract failure
- **THEN** 403/404 change no Session state while outage uses DependencyUnavailable and no stale private content is shown.

### Requirement: Logout follows Cookie transport ownership and does not persist sensitive state

Buyer/Seller logout SHALL use `POST /api/customer-auth/logout`; after success the frontend SHALL cancel/remove both Buyer and Seller protected roots and reset both Customer states because the shared Cookie is cleared. Staff logout SHALL use `POST /api/staff-auth/logout`, optional approved all-device action SHALL use `/api/staff-auth/logout-all` with required idempotency semantics, and success SHALL clear Staff only. No Session token or sensitive cache SHALL enter localStorage/sessionStorage.

#### Scenario: Successful identity logout

- **WHEN** Buyer or Seller completes Customer logout, or Staff completes Staff logout
- **THEN** Customer logout cancels/clears Buyer and Seller and resets both states while preserving Staff; Staff logout cancels/clears only Staff while preserving Buyer and Seller.

#### Scenario: Other identity or storage cleanup

- **WHEN** logout runs while Customer and Staff roots coexist or code attempts token/cache persistence
- **THEN** cleanup follows its Cookie transport group exactly, no stale Customer/opposite-identity data renders, and persistence checks fail for sensitive data.

### Requirement: Session DTO fields are display context, not client authority

The frontend MAY display validated Session fields such as expiry, display name, roles, permissions, scope, Staff ID, Customer subject, or account type, but SHALL NOT use client modification or local copies to authorize network actions. All protected APIs SHALL be allowed to return 401/403/404 based on current backend facts.

#### Scenario: Display current Session context

- **WHEN** a validated Session DTO is rendered in its matching shell
- **THEN** safe identity/expiry context may be shown and navigation may be tailored as a convenience while backend checks remain final.

#### Scenario: Tampered client Session field

- **WHEN** local code/devtools changes a role, permission, Staff ID, organization ID, or scope value
- **THEN** no additional server access is obtained, the client sends no authority field, and a backend denial is handled safely.
