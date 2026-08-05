# Frontend Testing and Quality Capability

## Purpose

TBD: Define this capability's long-term purpose after the Wave 14A archive is complete.

## Requirements

> Controller amendment coverage includes dedicated-link root, real `{ session: ... }` fixtures, mismatch logout, and Customer/Staff invalidation isolation.

### Requirement: Web unit tests cover deterministic foundation policy

Vitest unit tests SHALL cover runtime configuration, route/return-path parsing, query-key factories, envelope/Zod parsing, error/status/retry mapping, Retry-After bounds, idempotency lifecycle, Session reducers, Customer transport invalidation, and file transfer reducers. Tests SHALL include normal and security/edge cases and SHALL not weaken existing Node test configuration.

#### Scenario: Foundation unit suite

- **WHEN** pure frontend policies are executed with valid inputs
- **THEN** exact identity/path/data/error/operation transitions match the specifications.

#### Scenario: Malformed, cross-domain, or stale input

- **WHEN** inputs are unsafe, canceled, stale, malformed, cross-identity, persistence-seeking, or attempt to preserve one Customer root during shared-Cookie replacement/loss
- **THEN** tests prove fail-closed behavior, two-root Customer cleanup, Staff isolation, and no network/protected-data leakage.

### Requirement: Component tests exercise user behavior and accessibility

Testing Library, user-event, and jsdom SHALL test public/login/protected routing, three shells, forms, state components, keyboard/focus, overlay restoration, announcements, 320px structure, and 200% zoom-compatible semantics through user-visible roles/names rather than private implementation details. Customer password-route tests SHALL use a real QueryClient and adapter stub to prove unauthenticated same-domain return, matching Session entry for both `password_change_required` values, mismatch logout/two-root cleanup, Staff preservation, dependency retry, cleanup-failure recovery, and rerender loop prevention.

#### Scenario: User completes foundation interaction

- **WHEN** a keyboard or pointer user navigates entries, login states, shell navigation, and overlays
- **THEN** focus, names, landmarks, state feedback, and navigation outcomes are correct.

#### Scenario: Loading, denied, missing, or dependency state

- **WHEN** components receive unresolved, 403, 404, 503, contract, or canceled results
- **THEN** protected content stays hidden and the appropriate accessible state/request ID/recovery action is rendered.

### Requirement: MSW tests validate the real network boundary

MSW SHALL intercept the actual formal `/api/*` paths and assert credentials, methods, headers, exact envelopes, identity account types, AbortSignal effects, retry policy, idempotency-key reuse, expected_version, file multipart/token flow, and safe error fields. It SHALL prove Buyer logout and Seller logout each clear Buyer+Seller; Customer 401 clears Buyer+Seller; Staff 401 clears Staff only; new Customer login/account-type replacement clears Buyer+Seller; mismatch does not enter the opposite shell; and 403/404 clear no Session. It SHALL reject any phantom internal-communication route as absent. Tests SHALL NOT depend only on mocking hook/client return values.

#### Scenario: Valid mocked API flow

- **WHEN** MSW returns contract-valid auth, session, query, mutation, or file responses
- **THEN** the full adapter/query/component boundary validates and presents the intended state.

#### Scenario: Network/contract/security failure

- **WHEN** MSW returns malformed envelopes, forbidden fields, Customer/Staff 401, 403/404/409/422/429/503, mismatch, delay/cancel, replay, token expiry, or a request targets a non-formal internal-communication route
- **THEN** Customer two-root invalidation, Staff-only invalidation, mismatch non-navigation, 403/404 retention, route rejection, retry/error/cache/file rules remain exact and no unsafe data reaches UI.

### Requirement: Build, security, regression, and browser smoke gates remain mandatory

The feature SHALL pass Web typecheck/build, repository security scan, complete `npm run check`, migration/Wave11/Wave12/Wave13/Wrangler gates, OpenSpec target/all strict validation, and a minimal Playwright production-build smoke for public/login/shell/responsive/keyboard/error paths. Wave 14A SHALL NOT claim formal business browser acceptance.

#### Scenario: All foundation gates pass

- **WHEN** implementation is ready for controller review
- **THEN** exact commands/counts/results are recorded, existing backend gates stay green, and smoke covers one safe route/state per identity.

#### Scenario: Gate failure or overstated evidence

- **WHEN** any gate fails, was not run, uses production resources, or is described as broader business acceptance
- **THEN** advancement stops and the report records the real failure/unverified boundary.
