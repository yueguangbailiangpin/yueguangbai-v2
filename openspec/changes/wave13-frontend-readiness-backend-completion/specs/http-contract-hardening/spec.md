# HTTP Contract Hardening Capability

## ADDED Requirements

### Requirement: Critical JSON bodies are bounded objects with exact keys

Every Wave 13 JSON mutation SHALL require a JSON object within a route-specific byte limit, exact required and optional keys, bounded normalized strings, explicit array limits and safe numeric representation. Unknown fields and all client-supplied authority fields, including Staff/Customer IDs, roles, permissions, owner, organization authority, scope, audience, object key, permanent URL and authoritative next state, SHALL be rejected.

#### Scenario: Exact valid body

- **WHEN** a mutation body contains exactly its required and allowed optional fields with valid types and bounds
- **THEN** the route may construct a server-derived command and continue to authorization/domain validation.

#### Scenario: Unknown or authority field

- **WHEN** a body contains an unknown key, missing required key, array outside bounds, unsafe integer, invalid empty string or client authority field
- **THEN** the route returns 400 `VALIDATION_ERROR` before invoking the application command.

### Requirement: Critical query strings use strict single-value parsing

Wave 13 list and callback routes SHALL reject unknown query parameters and repeated parameters, parse `limit` only as a canonical decimal integer within 1–100, bound cursor length and structure, define empty-string handling, and validate date ranges. List date `from` and `to` SHALL be inclusive China business dates unless an existing route Contract explicitly documents another basis.

#### Scenario: Valid bounded list query

- **WHEN** a caller supplies allowed single-value filters, a canonical limit and a valid cursor/date range
- **THEN** the route applies the documented inclusive semantics and returns a bounded page.

#### Scenario: Duplicate or malformed query

- **WHEN** a parameter is unknown/repeated, limit has signs/decimals/leading ambiguity, cursor is malformed/oversized, or `from` is after `to`
- **THEN** the route returns 400 without executing the list or callback operation.

### Requirement: Error codes and HTTP statuses are stable at the frontend boundary

The implementation SHALL map real domain errors to the existing public error catalog and SHALL freeze at least: 401 `UNAUTHENTICATED`/`SESSION_INVALID`; 403 `FORBIDDEN`; 404 `NOT_FOUND` or domain not-found; 400 `VALIDATION_ERROR`; 409 `STATE_CONFLICT`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `REQUEST_IN_PROGRESS`; 429 `RATE_LIMITED`; and 503 `DEPENDENCY_UNAVAILABLE`. Existing file-specific 410 expiry, 422 validation and 503 compensation codes SHALL remain stable. Public messages SHALL be fixed and sanitized.

#### Scenario: Known domain failure

- **WHEN** a service returns a known validation, auth, state, version, idempotency, rate-limit, file or dependency failure
- **THEN** the route returns its frozen HTTP status, public code, request ID and no internal exception details.

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

D1 time points SHALL remain UTC millisecond integers and China business dates SHALL remain `YYYY-MM-DD` derived for `Asia/Shanghai`. JPY SHALL remain integer yen and CNY SHALL remain integer fen. HTTP financial input SHALL use canonical decimal strings when precision could cross JSON number boundaries, SHALL parse through safe-integer/BigInt validation, and JSON financial output SHALL use decimal strings. No Wave 13 Contract SHALL use floating-point money or ambiguous `rate` fields.

#### Scenario: Exact money and date input

- **WHEN** a refund mutation supplies a canonical positive fen string, valid UTC timestamp and consistent China business date
- **THEN** the adapter converts them without precision loss and the service persists existing integer facts.

#### Scenario: Ambiguous or unsafe value

- **WHEN** a money field is floating point, exponent notation, outside safe bounds, or a date/time is invalid or inconsistent with its Contract
- **THEN** the route returns 400 and no financial fact is appended.

### Requirement: Mutations freeze idempotency and concurrency semantics

Every critical Wave 13 business mutation SHALL require a valid 8–128 character `Idempotency-Key`, canonical request hash and `expected_version` or documented equivalent condition. Same Actor/key/hash replay SHALL return the committed response; same key/different hash SHALL return `IDEMPOTENCY_CONFLICT`; active processing SHALL return `REQUEST_IN_PROGRESS`; stale version SHALL return `VERSION_CONFLICT`. Final transaction assertions, Audit and Outbox SHALL be part of the committed business boundary.

#### Scenario: Committed replay

- **WHEN** the same Actor repeats an identical committed request with the same Idempotency-Key
- **THEN** the response is replayed without duplicating session-wide revocation, file facts, Formal Order, Payment, Reversal, Audit or Outbox.

#### Scenario: Conflict or stale aggregate

- **WHEN** key/hash or expected version differs from committed/current state
- **THEN** the route returns the stable 409 result and preserves current facts.

### Requirement: Frontend-critical route families are explicitly in or out of Wave 13 scope

Wave 13 SHALL modify or add only Staff Auth, File HTTP, Staff Order Evidence, Staff Buyer Refund, default Staff middleware registration and directly required shared Contract helpers. Customer Auth, Buyer Portal, Seller Portal and Internal Finance SHALL be reviewed/hardened only where they participate in these file/session boundaries. Other existing route families SHALL not be rewritten solely for uniformity and SHALL be listed as deferred when not frontend-critical to this Change.

#### Scenario: In-scope route family

- **WHEN** a route is required to close P1-01 or P1-02 or is a direct file/auth dependency
- **THEN** it receives the frozen Contract, authorization and test coverage in Wave 13.

#### Scenario: Unrelated route family

- **WHEN** an existing API is not required by Staff Auth, File HTTP, Order Evidence, Buyer Refund or their production entrypoint
- **THEN** Wave 13 leaves it unchanged and records any separate hardening need as residual scope rather than performing a full-repository rewrite.

### Requirement: DTO and parser limitations are documented and verified

Buyer, Seller and Staff responses SHALL use identity-specific allowlist projections and recursive leakage tests. Buyer/Seller DTOs SHALL not expose internal profit, Buyer Refund cost to Seller, Staff internal notes, session/provider secrets, R2 object keys or permanent URLs. If the platform JSON parser cannot reliably identify duplicate JSON keys after parsing, the design and tests SHALL state that limitation and SHALL NOT claim complete duplicate-key prevention; duplicate query parameters SHALL still be fully rejected.

#### Scenario: Safe identity projection

- **WHEN** a route serializes a Buyer, Seller or Staff response
- **THEN** only the documented fields for that identity domain appear and recursive DTO isolation verifiers pass.

#### Scenario: Parser limitation or leakage

- **WHEN** duplicate JSON keys cannot be reliably observed at the platform layer or a forbidden field appears in any nested DTO
- **THEN** the limitation is accurately documented, the leakage fails validation, and the route is not marked frontend-ready until corrected.
