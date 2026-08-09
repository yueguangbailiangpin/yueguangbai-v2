# Staff Auth Session Delta

## ADDED Requirements

### Requirement: Production Staff Auth activation is explicit and fail closed

Checked-in staging and production templates SHALL keep `STAFF_AUTH_ENABLED=false`. A separately reviewed external release configuration MAY enable Staff Auth only when the Worker receives the exact FEISHU provider, current official HTTPS authorization/token/identity endpoints, `contact:user.base:readonly`, safe non-placeholder application and tenant identifiers, the exact same-origin callback, the exact `/staff` return path, the exact application origin allowlist, and present managed App Secret and hash Secret bindings. The production runtime SHALL remove any test Provider Adapter. Missing, placeholder, mismatched or unsafe activation configuration SHALL make the release runtime fail closed with a sanitized dependency response.

The Web login client SHALL accept redirects only to the exact current official Feishu authorization origin `https://accounts.feishu.cn` and SHALL reject every other origin.

#### Scenario: Complete approved production activation

- **WHEN** an operator-authorized external configuration enables Staff Auth with every exact field and managed Secret binding present
- **THEN** the runtime retains only the real Feishu provider configuration and the existing Staff login routes may issue bounded state and authenticate a pre-existing D1 identity.

#### Scenario: Partial or drifting production activation

- **WHEN** Staff Auth is enabled with a missing Secret, placeholder identifier, wrong Provider endpoint/scope/origin/callback/return path, or a test Provider Adapter
- **THEN** the runtime rejects or strips that authority, returns a sanitized dependency failure and issues no Staff state or session.

#### Scenario: Web receives an unexpected authorization origin

- **WHEN** the login-start response contains a structurally valid HTTPS authorization URL whose origin is not `https://accounts.feishu.cn`
- **THEN** the Web client rejects the redirect and does not navigate away from the application.

### Requirement: Feishu production login does not change D1 authorization authority

Production activation SHALL NOT auto-provision Staff, import Feishu roles, trust Feishu headers or make Feishu the business/permission database. A successful Provider subject SHALL still resolve to exactly one pre-existing ACTIVE D1 identity and Staff user, and every protected request SHALL still recompute current D1 roles, permissions, Scope and Personal DENY.

#### Scenario: Known owner logs in

- **WHEN** Feishu verifies the configured subject and D1 contains exactly one ACTIVE identity and owner role mapping
- **THEN** the Worker issues the existing opaque internal Staff session and D1 remains the sole role and permission authority.

#### Scenario: Unknown or conflicting subject logs in

- **WHEN** Feishu verifies a subject that is absent, inactive or conflicts with the D1 identity mapping
- **THEN** login fails closed without creating Staff, roles, permissions or business facts.
