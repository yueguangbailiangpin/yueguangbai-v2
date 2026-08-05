# Buyer Testing and Quality Capability

## ADDED Requirements

### Requirement: Buyer contracts have runtime and unit coverage
Every Buyer API adapter SHALL runtime-validate its success DTO and cover parsers/formatters/query keys/status/action mapping with focused unit tests, including malformed network values and decimal-string money formatting.

#### Scenario: Valid DTO and formatter are tested
- **WHEN** representative Contract fixtures are parsed and displayed
- **THEN** the adapter returns the exact safe shape and integer-safe presentation.

#### Scenario: Malformed status, action, money, cursor, or path is tested
- **WHEN** an unapproved value is supplied
- **THEN** tests prove fail-closed contract behavior and no network request for an unapproved path.

### Requirement: Buyer components cover normal and boundary states
Component tests SHALL cover loading, empty, populated, error/request ID, 403, 404, conflict, terminal state, action absence, accessible form validation, keyboard operation, and unmount cleanup for each major journey.

#### Scenario: Normal component journey renders
- **WHEN** a component receives a valid returned DTO
- **THEN** status, facts, links, and only allowed actions are asserted.

#### Scenario: Boundary component journey renders
- **WHEN** the DTO has no action, a deadline boundary, partial source failure, or accessibility condition
- **THEN** tests assert the safe state, focus behavior, and absence of forbidden controls.

### Requirement: MSW covers real Buyer transports and cache effects
MSW tests SHALL use the exact 38 Buyer-relevant endpoints, real envelopes, credentials, idempotency headers, origin-relative paths, mutation replay/conflict, 401 shared Customer invalidation, 403/404 session retention, precise Query invalidation, file tokens, and explicit retry behavior.

#### Scenario: Real transport sequence succeeds
- **WHEN** registration, reservation, file upload, evidence, review, read intent, or logout completes through MSW
- **THEN** the exact request shape, response validation, cache effect, and token lifecycle are asserted.

#### Scenario: Network, conflict, or disclosure failure occurs
- **WHEN** MSW returns 401, 403, 404, 409, 429, 503, malformed envelope, lost response, or unsafe details
- **THEN** tests prove the documented no-auto-mutation-retry, session, request-ID, and disclosure behavior.

### Requirement: Playwright covers complete Buyer browser journeys
Production-build Playwright SHALL cover direct registration availability/unavailability, login/password change, dashboard partial data, demand acceptance/reservation/cancel, instruction/images, initial evidence and mismatch, resubmit/withdraw, formal orders, review submit/resubmit/withdraw/read, refunds, Me, and logout at 390px, plus 320px and 200%/reduced-motion gates.

#### Scenario: Complete happy and change-request journeys run
- **WHEN** deterministic Buyer fixtures drive the browser
- **THEN** each route, form, file, status transition, deep link, and final logout is verified without claiming backend state the fixture did not return.

#### Scenario: Security and accessibility journeys run
- **WHEN** cross-resource 404, 403, 401, conflict, dependency, keyboard, zoom, minimum width, or reduced motion is exercised
- **THEN** no protected/stale data leaks and the safe recovery/navigation behavior passes.

### Requirement: Module gates preserve the formal baseline
Acceptance SHALL require OpenSpec target/all strict, structure counts, security/static checks, Web typecheck/build, scoped and repository Vitest, Wave14A browser regression, database invariant verification, Git scope, and clean Worktree. Formal Verify, Ponytail, Integration, main advancement, and deployment SHALL remain separate controller-authorized stages.

#### Scenario: Authorized implementation later reaches acceptance
- **WHEN** all planned implementation and verification commands pass with recorded evidence
- **THEN** the module may be reported ready for controller review without claiming production verification.

#### Scenario: Any gate fails or unauthorized stage is pending
- **WHEN** a test, count, security, database, browser, scope, or governance gate fails
- **THEN** advancement stops, exact evidence is reported, and no PR, Integration, main, or deployment claim is made.
