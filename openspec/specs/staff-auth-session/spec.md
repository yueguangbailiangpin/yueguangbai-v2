# staff-auth-session Specification

## Purpose

Provide fail-closed Staff authentication through Cloudflare Access while keeping Moonwhite D1 as the only Staff account, role, Marketplace scope and permission authority.

## Requirements

### Requirement: Cloudflare Access proves email identity only

The system SHALL accept Staff bootstrap only from a valid Cloudflare Access RS256 assertion whose issuer exactly matches the configured HTTPS team domain, whose audience contains the configured application audience, whose time claims are valid and whose signing key is present in the bounded team JWKS. Access claims SHALL prove only a normalized email and SHALL NOT grant a Moonwhite role, permission or Marketplace scope.

#### Scenario: Known active Staff email authenticates

- **WHEN** Access proves an email mapped to exactly one ACTIVE `staff_email_identities` row and ACTIVE Staff account
- **THEN** the Worker creates an opaque internal Staff Session and derives current role, permissions, Marketplace scope and Personal DENY from D1.

#### Scenario: Unknown, conflicting or invalid Access identity

- **WHEN** the assertion is missing, invalid, expired, signed by an unknown key, uses the wrong issuer/audience, or the email does not resolve to exactly one ACTIVE Staff identity
- **THEN** authentication fails with a generic response, creates no account or Session and reveals no email-mapping fact.

### Requirement: Staff requests use the internal revocable Session

Protected Staff APIs SHALL trust only the HttpOnly secure Staff Cookie, SHALL re-resolve the current D1 authorization on every request and SHALL reject inactive Staff, revoked/expired sessions, `session_version` drift or `authorization_version` drift. Client-supplied Staff, role, scope, Marketplace or Provider headers SHALL have no authority.

#### Scenario: Authorization changes after login

- **WHEN** an account, role, Marketplace scope or Personal DENY change increments the Staff authorization or session version
- **THEN** the previous Session is rejected on its next request and stale authority is never used.

### Requirement: Bootstrap and logout are origin-bound and non-cacheable

Staff bootstrap, logout and logout-all SHALL require an allowed exact Origin before Cookie or Session side effects. Session responses SHALL use `Cache-Control: no-store`; logout-all SHALL preserve idempotent replay semantics and both logout paths SHALL clear the Staff Cookie without clearing Buyer or Seller sessions.

#### Scenario: Cross-site bootstrap or logout

- **WHEN** a request has a missing or foreign Origin
- **THEN** the request is rejected before Access verification, Session creation, revocation or Cookie mutation.

### Requirement: Production Staff authentication has no Feishu runtime dependency

Checked-in release templates and active runtime composition SHALL require only `STAFF_ACCESS_TEAM_DOMAIN`, `STAFF_ACCESS_AUD` and same-origin `STAFF_AUTH_ALLOWED_ORIGINS` for Staff authentication. They SHALL NOT contain Feishu application identifiers, Provider endpoints, callback routes, sync switches, alert switches or Staff authentication Secrets. Local preflight SHALL report external Access application, policy, known-email and owner-approval evidence as unverified and SHALL make no external call.

#### Scenario: Retired configuration is supplied

- **WHEN** a release configuration includes `FEISHU_*`, `STAFF_AUTH_FEISHU_*`, `STAFF_AUTH_PROVIDER`, `STAFF_AUTH_ENABLED` or `STAFF_AUTH_HASH_SECRET`
- **THEN** validation fails closed and no deployment authority is inferred.
