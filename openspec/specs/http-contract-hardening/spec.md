# Capability Specification

## Purpose

Defines stable, bounded, and privacy-preserving HTTP contracts required for reliable frontend integration across Wave 13 route families.

## Requirements

### Requirement: Critical JSON bodies are bounded objects with exact keys

Every Wave 13 JSON mutation SHALL require a JSON object within a route-specific byte limit, exact required and optional keys, bounded normalized strings, explicit array limits and safe numeric representation. Unknown fields and all client-supplied authority fields, including Staff/Customer IDs, roles, permissions, owner, organization authority, scope, audience, object key, permanent URL and authoritative next state, SHALL be rejected. Order Evidence approve SHALL allow only `expected_version`, optional `internal_note`, optional `price_mismatch_acknowledged` and optional `price_mismatch_reason`, with conditional validation based on server-computed mismatch facts.

#### Scenario: Exact valid body

- **WHEN** a mutation body contains exactly its required and allowed optional fields with valid types, bounds and conditional mismatch semantics
- **THEN** the route may construct a server-derived command and continue to authorization/domain validation.

#### Scenario: Unknown, authority or meaningless mismatch field

- **WHEN** a body contains an unknown key, missing required key, array outside bounds, unsafe integer, invalid empty string, client authority field, or mismatch acknowledgment/reason that is invalid for the stored mismatch state
- **THEN** the route returns 400 `VALIDATION_ERROR` before committing the application command, except missing/false acknowledgment for an actual mismatch returns the frozen 409 `PRICE_MISMATCH`.

### Requirement: Critical query strings use strict single-value parsing

Wave 13 list and callback routes SHALL reject unknown query parameters and repeated parameters, parse `limit` only as a canonical decimal integer within 1–100, bound cursor length and structure, define empty-string handling, and validate date ranges. List date `from` and `to` SHALL be inclusive China business dates unless an existing route Contract explicitly documents another basis.

#### Scenario: Valid bounded list query

- **WHEN** a caller supplies allowed single-value filters, a canonical limit and a valid cursor/date range
- **THEN** the route applies the documented inclusive semantics and returns a bounded page.

#### Scenario: Duplicate or malformed query

- **WHEN** a parameter is unknown/repeated, limit has signs/decimals/leading ambiguity, cursor is malformed/oversized, or `from` is after `to`
- **THEN** the route returns 400 without executing the list or callback operation.

### Requirement: Error codes and HTTP statuses are stable at the frontend boundary

The implementation SHALL map real domain errors to the formal public error catalog and SHALL freeze at least: 401 `UNAUTHENTICATED`/`SESSION_INVALID`; 403 `FORBIDDEN`; 404 `NOT_FOUND` or domain not-found; 400 `VALIDATION_ERROR`; 409 `STATE_CONFLICT`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `REQUEST_IN_PROGRESS`; 429 `RATE_LIMITED`; and 503 `DEPENDENCY_UNAVAILABLE`. Existing file-specific 410 expiry, 422 validation and 503 `FILE_COMPENSATION_REQUIRED` SHALL remain stable. Because the current public catalog does not contain `PRICE_MISMATCH`, Wave 13 SHALL add it as a minimal Contract extension mapped to HTTP 409 for actual price mismatch without required acknowledgment. Public messages SHALL be fixed and sanitized.

#### Scenario: Known domain failure

- **WHEN** a service returns a known validation, auth, mismatch, state, version, idempotency, rate-limit, file or dependency failure
- **THEN** the route returns its frozen HTTP status, public code, request ID and no internal exception details, including 409 `PRICE_MISMATCH` and existing 503 `FILE_COMPENSATION_REQUIRED`.

#### Scenario: Unexpected failure

- **WHEN** an unclassified exception reaches the route boundary
- **THEN** the route returns sanitized 503 `DEPENDENCY_UNAVAILABLE` or the repository's established internal mapping and does not expose stack, SQL, Provider response or storage key.

### Requirement: Resource concealment distinguishes permission from data scope

Buyer and Seller cross-tenant resources SHALL return 404. Staff without the global operation Permission MAY receive 403. Staff with the operation Permission whose target is outside current assignment, organization, Team or Data Scope SHALL receive 404. List endpoints SHALL filter scope in SQL and SHALL NOT reveal hidden row counts.

#### Scenario: Missing Staff operation permission

- **WHEN** an authenticated Staff lacks the required effective Permission after Personal DENY
- **THEN** the route returns 403 without querying or disclosing target-specific facts beyond what is required for the decision.

#### Scenario: Permission present but resource outside scope

- **WHEN** Staff has the operation Permission but the resource is outside current Data Scope, or a Customer crosses tenant boundaries
- **THEN** the route returns 404 or omits the row so resource existence is concealed.

### Requirement: Date, time and money representations are explicit and exact

D1 time points SHALL remain UTC millisecond integers and China business dates SHALL remain `YYYY-MM-DD` derived for `Asia/Shanghai`. JPY SHALL remain integer yen and CNY SHALL remain integer fen. HTTP financial input SHALL use canonical decimal strings when precision could cross JSON number boundaries, SHALL parse through safe-integer/BigInt validation, and JSON financial output SHALL use decimal strings. `reference_order_amount_jpy`, `final_paid_jpy` and `price_difference_jpy` SHALL remain integer JPY facts. Formal Order and financial snapshot SHALL use `final_paid_jpy`, not the reference amount. No Wave 13 Contract SHALL use floating-point money or ambiguous `rate` fields.

#### Scenario: Exact money and date input

- **WHEN** a refund mutation supplies a canonical positive fen string or Order Evidence approval reads stored integer JPY comparison facts
- **THEN** the adapter/service preserves exact integer semantics and Formal Order uses the actual final paid amount.

#### Scenario: Ambiguous or unsafe value

- **WHEN** a money field is floating point, exponent notation, outside safe bounds, or a date/time is invalid or inconsistent with its Contract
- **THEN** the route returns 400 and no financial fact is appended or overwritten.

### Requirement: Mutations freeze idempotency and concurrency semantics

Every critical Wave 13 business mutation SHALL require a valid 8–128 character `Idempotency-Key`, canonical request hash and `expected_version` or documented equivalent condition. Order Evidence approve request hash SHALL include `price_mismatch_acknowledged` and normalized `price_mismatch_reason`. Same Actor/key/hash replay SHALL return the committed response, including the original mismatch reason; same key/different hash SHALL return `IDEMPOTENCY_CONFLICT`; active processing SHALL return `REQUEST_IN_PROGRESS`; stale version SHALL return `VERSION_CONFLICT`. Final transaction assertions, Audit and Outbox SHALL be part of the committed business boundary.

#### Scenario: Committed replay

- **WHEN** the same Actor repeats an identical committed request with the same Idempotency-Key
- **THEN** the response is replayed without duplicating session-wide revocation, file facts, Formal Order, Payment, Reversal, Audit or Outbox and without changing mismatch acknowledgment facts.

#### Scenario: Conflict or stale aggregate

- **WHEN** key/hash, mismatch reason or expected version differs from committed/current state
- **THEN** the route returns the stable 409 result and preserves current facts.

### Requirement: Frontend-critical route families and paths are explicitly frozen

Wave 13 SHALL modify or add only Staff Auth, File HTTP, Staff Order Evidence, Staff Buyer Refund, default Staff middleware registration and directly required shared Contract helpers. Every Wave 13 route SHALL use the current production `/api/*` route family. The implementation SHALL correct old contract/document references that say `/api/v2/*`, but SHALL NOT register `/api/v2/*` aliases, dual routes or a second Contract version. API-wide version migration is out of Wave 13 scope. Customer Auth, Buyer Portal, Seller Portal and Internal Finance SHALL be reviewed/hardened only where they participate in these file/session boundaries.

#### Scenario: In-scope route family and canonical path

- **WHEN** a route is required to close P1-01 or P1-02 or is a direct file/auth dependency
- **THEN** it is registered exactly once under `/api/*`, receives the frozen Contract/authorization/tests, and old path documentation is corrected during implementation.

#### Scenario: Alias, second version or unrelated route family

- **WHEN** an implementation proposes `/api/v2/*`, a dual alias, a second Contract version, or a rewrite unrelated to Staff Auth/File/Evidence/Refund
- **THEN** Wave 13 rejects it and leaves API-wide version migration or unrelated hardening to a separate Change.

### Requirement: DTO and parser limitations are documented and verified

Buyer, Seller and Staff responses SHALL use identity-specific allowlist projections and recursive leakage tests. Buyer/Seller DTOs SHALL not expose internal profit, Buyer Refund cost to Seller, Staff internal notes, `price_mismatch_reason`, session/provider secrets, R2 object keys or permanent URLs. If the platform JSON parser cannot reliably identify duplicate JSON keys after parsing, the design and tests SHALL state that limitation and SHALL NOT claim complete duplicate-key prevention; duplicate query parameters SHALL still be fully rejected.

#### Scenario: Safe identity projection

- **WHEN** a route serializes a Buyer, Seller or Staff response
- **THEN** only the documented fields for that identity domain appear and recursive DTO isolation verifiers pass.

#### Scenario: Parser limitation or leakage

- **WHEN** duplicate JSON keys cannot be reliably observed at the platform layer or a forbidden field appears in any nested DTO
- **THEN** the limitation is accurately documented, the leakage fails validation, and the route is not marked frontend-ready until corrected.
