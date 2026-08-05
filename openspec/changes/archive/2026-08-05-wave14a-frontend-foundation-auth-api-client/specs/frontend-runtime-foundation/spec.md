# Frontend Runtime Foundation Capability

## ADDED Requirements

### Requirement: Web bootstrap is deterministic and fail-safe

The frontend SHALL mount the application under React StrictMode, SHALL validate the root element and public runtime configuration, SHALL install a root error boundary before route content, and SHALL render a safe recovery state rather than leaking an exception. Browser configuration SHALL contain no secret or hard-coded production API origin.

#### Scenario: Valid bootstrap

- **WHEN** the root element and approved public configuration are present
- **THEN** the application mounts once through the provider architecture and renders the current route.

#### Scenario: Bootstrap or render failure

- **WHEN** the root element, configuration, lazy route, or render path fails
- **THEN** no protected content is rendered and the user receives a sanitized recovery state without stack, secret, or raw exception data.

### Requirement: Provider ownership is explicit and identity-safe

The frontend SHALL compose StrictMode, Root Error Boundary, Router, Query Client, identity-specific Session Boundary, and Route Shell with explicit ownership. Buyer and Seller MAY share only a transport invalidation coordinator that cancels/clears both Customer roots and resets their independent states when the shared Cookie changes; it SHALL own no authenticated identity or business data. The frontend SHALL NOT create a universal Buyer/Seller/Staff Auth Context or general-purpose global store.

#### Scenario: Matching identity route

- **WHEN** a route under one identity tree renders
- **THEN** it consumes only that identity's Session boundary and the shared query runtime through identity-rooted keys.

#### Scenario: Cross-identity provider access

- **WHEN** Buyer code attempts to consume Seller/Staff Session authority, the invalidation coordinator carries combined auth data, or any route lacks its required identity boundary
- **THEN** the architecture/test fails closed while still allowing group-wide Customer cache cancellation, and no opposite-domain cached data is rendered.

### Requirement: Runtime configuration is minimal and origin-relative

The frontend SHALL send business requests only to origin-relative `/api/*`, SHALL use `credentials: include`, and SHALL restrict browser configuration to non-sensitive presentation/runtime flags. It SHALL NOT expose client secrets, Provider secrets, storage credentials, or production resource identifiers.

#### Scenario: Approved API request

- **WHEN** an endpoint adapter issues a request
- **THEN** the resolved path remains under `/api/*` on the current origin and includes browser credentials.

#### Scenario: Unsafe configuration or path

- **WHEN** code/config supplies an absolute API origin, `/api/v2/*`, traversal, secret, or non-API business path
- **THEN** startup/build/security validation rejects it before a network request is sent.

### Requirement: Server state uses one controlled TanStack Query runtime

The frontend SHALL use TanStack Query for server state, cancellation, invalidation, and cache lifetime, including atomic cancellation/removal of both Customer roots by `CUSTOMER_TRANSPORT_INVALIDATION_GROUP`. It SHALL use React state or narrow Context for local UI state and SHALL NOT add Redux, MobX, or a universal store. Sensitive Query state SHALL remain memory-only.

#### Scenario: Server query lifecycle

- **WHEN** a component requests validated server data
- **THEN** TanStack Query supplies cancellation, status, and identity-scoped caching without duplicating data in another store.

#### Scenario: Persistence or duplicate authority

- **WHEN** code attempts to persist sensitive Query/session data to browser storage or mirror server authority in a general store
- **THEN** security tests/review reject the implementation.

### Requirement: Styling consumes semantic light-theme tokens

The frontend SHALL implement Tailwind CSS mapped to CSS custom property tokens for color, shadow, radius, spacing, typography, line height, and z-index. Components SHALL consume semantic tokens rather than scattering raw palette values. Wave 14A SHALL implement only the light token set and no theme switch.

#### Scenario: Component styling

- **WHEN** a shared component renders in any identity shell
- **THEN** it uses shared semantic brand/status/surface tokens with only the approved identity accent override.

#### Scenario: Raw palette or dark-mode feature

- **WHEN** a component introduces unapproved raw colors, a dark palette, or a persisted theme toggle
- **THEN** style/static validation fails and the feature is not accepted.

### Requirement: Simplified Chinese copy is structured for later extension

The first frontend release SHALL present Simplified Chinese and display the product only as `月光白`. Visible copy SHALL be organized outside transport and DTO authority so future language extraction remains possible, but Wave 14A SHALL NOT require a full i18n framework.

#### Scenario: Visible foundation route

- **WHEN** a user opens any public, login, shell, loading, or error route
- **THEN** essential controls and status text are available in Simplified Chinese and the displayed brand is `月光白`.

#### Scenario: Forbidden customer branding or speculative i18n

- **WHEN** customer-visible copy includes an English product name or `V2`, or implementation adds a full language framework/switch without approved scope
- **THEN** the branding/dependency gate fails.
