# Buyer Registration and Profile Capability

## ADDED Requirements

### Requirement: Buyer direct self-registration uses the frozen contract
`/buyer/register` SHALL submit only `wechat_id`, `password`, `password_confirmation`, and optional `human_verification_token` to `POST /api/buyer-auth/register`. A 201 response SHALL establish the shared Customer Session and navigate to the returned `/buyer` next path.

#### Scenario: Registration succeeds
- **WHEN** the server accepts a valid registration and returns `session_established=true`
- **THEN** the Buyer enters `/buyer` without a second login and no registration authority is stored client-side.

#### Scenario: Response or identity is unsafe
- **WHEN** the response is malformed, the next path differs from the contract, or the resulting Customer Session is not BUYER
- **THEN** the flow fails closed, clears Customer transport through the existing mismatch path when needed, and shows a safe request ID.

### Requirement: Feature and human-verification boundaries fail closed
Registration availability SHALL remain controlled by the backend feature flag and human-verification requirement. The frontend MAY collect and pass a verifier token but SHALL NOT create a fake token, bypass a required verifier, or alter runtime configuration.

#### Scenario: Verification boundary is available
- **WHEN** the configured registration experience obtains a real token and the backend accepts it
- **THEN** that token is sent only in the registration request and is not persisted.

#### Scenario: Registration is disabled or verification fails
- **WHEN** the backend returns dependency-unavailable, conflict, or rate-limit for disabled registration, configuration, human verification, or safe registration conflict
- **THEN** the page shows a generic unavailable/contact-support state without revealing the internal reason or offering bypass.

### Requirement: Registration form is safe and accessible
The registration form SHALL label all fields, use appropriate autocomplete, confirm password locally without weakening server validation, disable concurrent submit, and retain no password after success. It SHALL present `Retry-After` only as a bounded wait and SHALL not automatically resubmit.

#### Scenario: Buyer submits a valid form
- **WHEN** required fields match and the user explicitly submits
- **THEN** one request is sent, the submit control exposes a busy state, and credentials are not placed in Query cache or logs.

#### Scenario: Input is invalid or rate limited
- **WHEN** local confirmation fails, the API rejects validation, or the API returns 429
- **THEN** focus moves to an accessible error summary or field, no request is duplicated automatically, and safe retry timing is explained.

### Requirement: Buyer Me is a read-only profile
`/buyer/me` SHALL display only `customer_number`, `display_name`, `marketplace_code`, `identity_review_status`, and Session `expires_at` from `GET /api/buyer-portal/me`. It SHALL provide links to formal orders, refunds, password change, and logout without editable unsupported identity fields.

#### Scenario: Buyer profile loads
- **WHEN** Buyer Me returns a valid DTO
- **THEN** the page displays the server values and the supported account destinations.

#### Scenario: Identity review is required
- **WHEN** `identity_review_status` is `REVIEW_REQUIRED`
- **THEN** a prominent safe limitation notice appears without inventing an approval button or staff workflow.

### Requirement: Password change and logout reuse Customer Auth
Buyer password change SHALL continue through `/buyer/change-password` and the existing `POST /api/customer-auth/change-password` idempotent controller. Logout SHALL call `POST /api/customer-auth/logout`, clear both Customer Query roots, preserve Staff cache, and return to `/buyer/login`.

#### Scenario: Password change or logout succeeds
- **WHEN** the Buyer completes a required password change or confirms logout
- **THEN** the existing Customer Session lifecycle establishes the fresh state or clears Customer transport before navigation.

#### Scenario: Account-type mismatch or cleanup fails
- **WHEN** a Session resolves to SELLER_MEMBER or logout/cleanup fails
- **THEN** Buyer business content stays hidden and an explicit safe cleanup retry is offered without cross-identity navigation.
