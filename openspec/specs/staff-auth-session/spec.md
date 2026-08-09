# Capability Specification

## Purpose

Defines the trusted Staff authentication and session lifecycle, including current D1 authorization enforcement and safe session management.
## Requirements
### Requirement: Staff login start creates a bounded single-use authorization state

The system SHALL expose `POST /api/staff-auth/login/start` under the sole formal `/api/*` route family with an exact-key JSON object containing only optional `return_to`, SHALL validate the request Origin and redirect allowlist, SHALL generate a cryptographically random state, SHALL store only its hash with Provider, tenant, callback purpose and expiry, and SHALL NOT place an authoritative `staff_id` in client state. The login state TTL SHALL be ten minutes.

#### Scenario: Valid login start

- **WHEN** a request from an allowed Staff origin supplies an allowlisted relative `return_to`
- **THEN** the Worker returns a Feishu authorization URL and expiry while D1 stores one ISSUED hashed state bound to FEISHU and the configured callback.

#### Scenario: Invalid origin or redirect

- **WHEN** the Origin is not allowed or `return_to` is absolute, cross-origin, malformed or not allowlisted
- **THEN** the request is rejected without creating a login state or disclosing Provider configuration.

### Requirement: Feishu callback validates state and Provider identity server-side

The system SHALL expose only `GET /api/staff-auth/feishu/callback` with exactly one `code` and one `state`, SHALL atomically consume an unexpired ISSUED state before accepting the callback, SHALL exchange and verify Provider identity server-side, SHALL validate configured Provider and tenant, and SHALL NOT return a Provider Access Token to the browser. Endpoint, app ID, secret, scope, tenant and redirect URI SHALL be environment-configured from an approved Feishu application and verified against implementation-time official Feishu documentation. The Provider Adapter SHALL support a test substitute, and missing configuration SHALL fail closed. No `/api/v2/*` alias SHALL be registered.

#### Scenario: Valid callback

- **WHEN** a callback presents a valid unconsumed state and the configured Provider Adapter returns a verified identity for the approved tenant
- **THEN** the Worker consumes the state, resolves the identity mapping and continues to internal session issuance without persisting or returning Provider tokens.

#### Scenario: Invalid, expired, replayed or unconfigured callback

- **WHEN** state is unknown, expired, already consumed, bound to another Provider/callback, repeated, or required Provider configuration is absent/inconsistent
- **THEN** authentication fails closed, no Staff Session is issued and a sanitized security event is recorded.

### Requirement: Staff identity mapping uses the existing D1 binding as authority bridge

The system SHALL map the stable Feishu subject by `(tenant_key, open_id)` to exactly one ACTIVE `feishu_staff_identities` row and exactly one ACTIVE `staff_users` row. Optional `user_id` SHALL only corroborate identity or detect conflict. Unknown identities SHALL be rejected, conflicts SHALL fail closed, and login SHALL NOT auto-create Staff or modify roles, permissions, teams or scope.

#### Scenario: Active unique mapping

- **WHEN** the verified Provider subject matches one ACTIVE binding owned by one ACTIVE Staff user
- **THEN** the Worker derives that Staff ID solely from D1 and may issue an internal session.

#### Scenario: Missing, inactive or conflicting mapping

- **WHEN** no binding exists, the binding or Staff is inactive, or Provider identifiers resolve inconsistently
- **THEN** login is rejected with a fixed public authentication error and no candidate Staff identity is disclosed.

### Requirement: Worker issues an opaque internal Staff Session

After successful mapping, the Worker SHALL generate a new opaque session token with at least 256 bits of entropy, store only its hash in D1, bind it to the Staff ID and issued `session_version` and `authorization_version`, and set `__Host-ygb_staff_session` as `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` with a twelve-hour absolute TTL. First release SHALL have no independent idle timeout and SHALL NOT require a per-request `last_seen` write. This is an explicit write-amplification and complexity decision, not an omitted security rule. The Cookie and session record SHALL NOT contain roles, permissions, data scope or Provider tokens as authority.

#### Scenario: Session issuance

- **WHEN** Provider verification and D1 identity mapping succeed
- **THEN** a new ACTIVE Staff Session with a twelve-hour absolute expiry is persisted, a lifecycle audit/security event is recorded and the browser receives only the opaque HttpOnly Cookie before an allowlisted redirect.

#### Scenario: Session fixation and idle behavior

- **WHEN** the browser already holds an arbitrary or old Staff Cookie or remains inactive during the valid absolute lifetime
- **THEN** successful callback replaces the Cookie with a new token, and inactivity alone does not extend, shorten or refresh the fixed twelve-hour expiry.

### Requirement: Staff Session Middleware authenticates every Staff request

The default production app SHALL install Staff Session Middleware for every `/api/staff/**` and Internal Finance route before the route handler. The middleware SHALL read the internal Cookie, verify token integrity through its hash, require an ACTIVE unexpired session, require matching `session_version`, require an ACTIVE Staff user, and SHALL stop route execution on failure.

#### Scenario: Valid middleware resolution

- **WHEN** an unexpired ACTIVE session matches the current Staff and session versions
- **THEN** the middleware proceeds to authorization recalculation and the protected route may execute.

#### Scenario: Missing or invalid session

- **WHEN** the Cookie is absent, oversized, tampered, unknown, expired, revoked or version-invalid
- **THEN** the middleware clears the Cookie where appropriate, returns 401 and does not invoke the Staff route.

### Requirement: Middleware recalculates current D1 authorization and data scope

For each authenticated request, the middleware SHALL call the existing D1 authorization resolver to recompute ACTIVE roles, role defaults, personal GRANT, Personal DENY, active Team and Department membership, leader packages and Data Scope. Personal DENY and system hard prohibitions SHALL remain final. The result SHALL be assigned with `context.set('staffAuthorization', authorization)` and no Feishu header or client authority field SHALL influence it.

#### Scenario: Current authorization is installed

- **WHEN** the Staff Session is valid and D1 authorization resolves successfully
- **THEN** the route receives a fresh `staffAuthorization` containing only current D1-derived authority.

#### Scenario: Authorization cannot be resolved

- **WHEN** the Staff has no valid roles, a required team/department is inactive, Personal DENY removes the operation, or D1 authorization is inconsistent
- **THEN** the request fails closed and no fallback Feishu or client role is accepted.

### Requirement: Session APIs expose only the current safe Staff projection and revocation actions

The system SHALL expose `GET /api/staff-auth/session`, `POST /api/staff-auth/logout` and `POST /api/staff-auth/logout-all`. Current session response SHALL include a safe Staff projection, current effective roles/permissions/scope summary and absolute expiry but SHALL exclude Cookie/token hashes and Provider secrets. Logout SHALL revoke the current session and clear the Cookie. Logout-all SHALL increment `staff_users.session_version`, revoke all active sessions for that Staff and clear the Cookie.

#### Scenario: Current session read

- **WHEN** an authenticated Staff requests the current session
- **THEN** the Worker returns the current safe D1-derived session/authorization projection with `Cache-Control: no-store`.

#### Scenario: Logout and logout-all

- **WHEN** an authenticated Staff logs out or logs out from all devices
- **THEN** the required session records are revoked, the Cookie is cleared and repeated logout does not restore or duplicate a session.

### Requirement: Staff and authorization changes invalidate sessions predictably

The middleware SHALL reject sessions when Staff status is not ACTIVE, `session_version` differs, or the session's issued `authorization_version` differs from the current Staff row. Permission, role, DENY, Team or Department changes that increment `authorization_version` SHALL therefore take effect immediately by invalidating existing sessions and requiring reauthentication.

#### Scenario: Staff is disabled or all sessions are revoked

- **WHEN** Staff status changes to inactive or `session_version` is incremented
- **THEN** every prior session is rejected with 401 on its next request and cannot be revived by replaying its Cookie.

#### Scenario: Authorization changes

- **WHEN** an authorized change increments `authorization_version`
- **THEN** sessions issued under the previous version are rejected with 401 and no stale permission snapshot is used.

### Requirement: Staff authentication applies origin, redirect, rate-limit and replay security controls

Login start and session-changing POST requests SHALL enforce allowed Origin. Redirects SHALL use an explicit allowlist. Staff authentication SHALL apply bounded rate limits to login starts and failed callbacks using hashed network/subject keys, fixed public errors, sanitized security events and a bounded Provider timeout. Login start before state creation and callback before state consumption or Provider exchange SHALL run authentication-traffic-triggered cleanup limited to 100 rows per table, deleting only login states whose expiry and update are both older than 24 hours and rate-limit rows whose window ended more than 24 hours ago and whose block is absent or also older than 24 hours. The cleanup SHALL never delete Staff sessions, security events, audit events, idempotency records or business/financial facts, SHALL introduce no Cron or Scheduled Handler, and SHALL fail closed with `DEPENDENCY_UNAVAILABLE` before new state/session facts or Provider authentication when cleanup SQL fails. Provider failure SHALL fail closed.

#### Scenario: Rate limit or Provider outage

- **WHEN** a caller exceeds the configured authentication window, bounded cleanup SQL fails, or the Provider times out/unavailable
- **THEN** the Worker returns `RATE_LIMITED` or `DEPENDENCY_UNAVAILABLE`, issues no session and records no Provider token or sensitive claim.

#### Scenario: Header bypass attempt

- **WHEN** a request supplies Feishu identity, Staff ID, role or permission headers without a valid internal Staff Session
- **THEN** the default app ignores those headers and returns 401.

### Requirement: Authentication lifecycle is auditable without leaking secrets

Successful known-Staff session creation, current-session revoke and logout-all SHALL create immutable audit evidence. Unknown identity, invalid state, callback replay, identity conflict, Provider failure, Cookie rejection and rate-limit decisions SHALL create immutable `staff_auth_security_events` with structured event type/outcome, request ID, nullable trusted references and minimized or hashed context. Raw codes, tokens, Cookie values, R2 keys and full Provider claims SHALL never be persisted in audit, security event or outbox payloads. Wave 13 SHALL persist these events but SHALL NOT implement Feishu real-time alerts, security message delivery, duty notifications or operational reminders; those consumers belong to Wave 16.

#### Scenario: Successful lifecycle audit

- **WHEN** a Staff Session is created or revoked
- **THEN** the system records the known Staff, session reference, result, versions, request ID and timestamp without recording secrets.

#### Scenario: Failed authentication security event

- **WHEN** authentication fails before a trusted Staff Actor is known
- **THEN** a sanitized immutable security event is appended with nullable Staff reference, no fabricated Actor and no Wave 13 alert delivery side effect.

### Requirement: Production Staff Auth activation is explicit and fail closed

Checked-in staging and production templates SHALL keep `STAFF_AUTH_ENABLED=false`. A separately reviewed external release configuration MAY enable Staff Auth only when the Worker receives the exact FEISHU provider, current official HTTPS authorization/token/identity endpoints, `contact:user.base:readonly`, safe non-placeholder application and tenant identifiers, the exact same-origin callback, the exact `/staff` return path, the exact application origin allowlist, and present managed App Secret and hash Secret bindings. The production runtime SHALL remove any test Provider Adapter. Missing, placeholder, mismatched or unsafe activation configuration SHALL make the release runtime fail closed with a sanitized dependency response.

The Web login client SHALL accept redirects only to the exact current official Feishu authorization origin `https://accounts.feishu.cn` and SHALL reject every other origin.

The production release perimeter SHALL preserve its default cross-site API deny while allowing an origin-less `GET` top-level document navigation to the exact Staff Auth Feishu callback path. It SHALL continue to reject cross-site writes, fetch/CORS modes, sibling API paths and requests carrying a foreign `Origin`. The callback SHALL gain no session authority until the existing exact query, single-use state, Provider and D1 identity checks pass.

#### Scenario: Complete approved production activation

- **WHEN** an operator-authorized external configuration enables Staff Auth with every exact field and managed Secret binding present
- **THEN** the runtime retains only the real Feishu provider configuration and the existing Staff login routes may issue bounded state and authenticate a pre-existing D1 identity.

#### Scenario: Partial or drifting production activation

- **WHEN** Staff Auth is enabled with a missing Secret, placeholder identifier, wrong Provider endpoint/scope/origin/callback/return path, or a test Provider Adapter
- **THEN** the runtime rejects or strips that authority, returns a sanitized dependency failure and issues no Staff state or session.

#### Scenario: Web receives an unexpected authorization origin

- **WHEN** the login-start response contains a structurally valid HTTPS authorization URL whose origin is not `https://accounts.feishu.cn`
- **THEN** the Web client rejects the redirect and does not navigate away from the application.

#### Scenario: Feishu returns through a top-level OAuth navigation

- **WHEN** the browser follows a cross-site `GET` document navigation without an `Origin` header to the exact configured Staff Auth Feishu callback path
- **THEN** the release perimeter passes the request to Staff Auth while all callback state, Provider and D1 identity checks remain mandatory.

### Requirement: Feishu production login does not change D1 authorization authority

Production activation SHALL NOT auto-provision Staff, import Feishu roles, trust Feishu headers or make Feishu the business/permission database. A successful Provider subject SHALL still resolve to exactly one pre-existing ACTIVE D1 identity and Staff user, and every protected request SHALL still recompute current D1 roles, permissions, Scope and Personal DENY.

#### Scenario: Known owner logs in

- **WHEN** Feishu verifies the configured subject and D1 contains exactly one ACTIVE identity and owner role mapping
- **THEN** the Worker issues the existing opaque internal Staff session and D1 remains the sole role and permission authority.

#### Scenario: Unknown or conflicting subject logs in

- **WHEN** Feishu verifies a subject that is absent, inactive or conflicts with the D1 identity mapping
- **THEN** login fails closed without creating Staff, roles, permissions or business facts.
