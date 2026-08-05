# Frontend API Client Capability

## ADDED Requirements

### Requirement: Transport is restricted to credentialed same-origin API requests

The frontend API transport SHALL accept only origin-relative paths under `/api/*`, SHALL use `credentials: include` for every request, SHALL support an external `AbortSignal`, and SHALL NOT accept `/api/v2/*`, a hard-coded production host, client secret, Cookie value, or client-supplied authority header. Endpoint adapters SHALL own method/path/body construction.

#### Scenario: Valid endpoint call

- **WHEN** an endpoint adapter calls a registered `/api/*` route
- **THEN** native fetch sends the exact method/path with included credentials, bounded headers/body, and caller cancellation.

#### Scenario: Unsafe route or authority input

- **WHEN** a caller supplies an absolute origin, non-API path, `/api/v2/*`, Cookie, secret, Staff ID, role, permission, organization scope, or file owner authority
- **THEN** the client rejects the request before transport and security validation fails.

### Requirement: Success and error envelopes are runtime validated

The client SHALL parse the published `{data,meta.request_id}` success envelope and `{error:{code,message,details},meta.request_id}` failure envelope with Zod before returning data. Endpoint DTO schemas SHALL align with `@ygb/contracts`; status alone or TypeScript assertions SHALL NOT make an unvalidated payload trusted.

#### Scenario: Valid success envelope

- **WHEN** a 2xx response contains the expected envelope and endpoint DTO
- **THEN** the client returns validated data and request ID without exposing transport internals to the component.

#### Scenario: Malformed or mismatched payload

- **WHEN** JSON is invalid, the envelope/request ID is missing, or endpoint fields violate the runtime schema
- **THEN** the client returns a sanitized contract-category error and never renders/persists the raw payload.

### Requirement: Normalized errors preserve safe actionable metadata

Every client error SHALL contain `code`, `httpStatus`, `requestId`, `safeDetails`, `retryAfter`, and `category`. `safeDetails` SHALL be constructed through a code-specific allowlist. Error objects/user output SHALL NOT contain stack, SQL, `object_key`, Provider token, Cookie, secret, Authorization header, or raw internal exception/response.

#### Scenario: Known API failure

- **WHEN** a valid error envelope is received
- **THEN** the client preserves its published code/status/request ID, safe allowed details, bounded Retry-After, and a deterministic category for UI handling.

#### Scenario: Internal or unknown failure data

- **WHEN** error details contain unknown/internal fields or the failure is an unclassified exception
- **THEN** forbidden fields are discarded and the UI receives a generic safe category/message with available request correlation only.

### Requirement: HTTP status and authentication semantics are strict

The client SHALL distinguish 401 authentication loss, 403 permission denial, 404 concealed/missing resource, 409 conflict, 422 validation, 429 rate limit, and 503 dependency/file compensation behavior. A validated Customer 401 from Customer Session or any Buyer/Seller protected API SHALL notify `CUSTOMER_TRANSPORT_INVALIDATION_GROUP` to cancel and clear both Customer domains. A validated Staff 401 SHALL notify only Staff. 403 and 404 SHALL NOT log out or clear any Session domain.

#### Scenario: Customer or Staff 401

- **WHEN** a Buyer/Seller request receives a validated 401 or a Staff request receives a validated 401
- **THEN** Customer failure cancels/clears Buyer and Seller and leaves Staff unchanged, while Staff failure clears only Staff and leaves both Customer domains unchanged.

#### Scenario: Non-auth denial or failure

- **WHEN** a request receives 403, 404, 409, 422, 429, or 503
- **THEN** 403/404 change no Session/cache state and other statuses select their code-specific UI action without rewriting the error as logout.

### Requirement: Query and mutation retry policies are distinct and bounded

GET-like queries MAY retry only bounded network/transient failures with abort-aware backoff. 401, 403, 404, 409, and 422 SHALL never auto-retry. Mutations SHALL default to no automatic retry. 503 SHALL retry only when a specific published code and explicit user action define it; no infinite loop is allowed.

#### Scenario: Transient query network failure

- **WHEN** a GET-like query fails from a retryable network condition and remains active
- **THEN** it retries within the fixed attempt/time budget and stops immediately on cancellation or a non-retryable response.

#### Scenario: Mutation or semantic failure

- **WHEN** a mutation fails or any request returns 401/403/404/409/422 or non-approved 503
- **THEN** automatic retry count is zero and the user receives the mapped recovery action.

### Requirement: Cancellation propagates through fetch and Query lifecycle

Every query and file/network operation SHALL propagate `AbortSignal`, distinguish cancellation from dependency failure, and avoid committing canceled results to active UI state. Route changes, identity logout, component disposal, and explicit user cancel SHALL abort owned in-flight work.

#### Scenario: Active request completes

- **WHEN** the request remains current and returns a valid response before abort
- **THEN** validated data may enter the matching query/operation state.

#### Scenario: Request is canceled or becomes stale

- **WHEN** navigation, logout, superseding input, or user action aborts the signal
- **THEN** transport stops where supported, no error toast mislabels cancellation, and late data is not shown in the new identity/route context.

### Requirement: Idempotency keys belong to one logical mutation

The mutation layer SHALL create a cryptographically random Idempotency-Key once when a logical user operation begins, SHALL reuse it only for a safe retry of the identical body, SHALL allocate a new key for a new operation or changed body, SHALL not allocate keys during render, and SHALL release them from memory at terminal completion/cancel/abandonment. Keys SHALL NOT be persisted.

#### Scenario: Lost-response safe retry

- **WHEN** the exact same logical request has an explicitly safe transport retry after an ambiguous network failure
- **THEN** the retry reuses the original body and Idempotency-Key and surfaces the server's replay/result semantics.

#### Scenario: New body, render, or persisted reuse

- **WHEN** a body changes, the user starts again, a component re-renders, or code attempts to load a prior key from storage
- **THEN** no old key is reused across bodies/operations and persistence/security tests reject the attempt.

### Requirement: Versions, Retry-After, conflicts, and query keys remain explicit

`expected_version` SHALL originate only from the latest validated server DTO. `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `REQUEST_IN_PROGRESS`, `STATE_CONFLICT`, `PRICE_MISMATCH`, `FILE_COMPENSATION_REQUIRED`, and `DEPENDENCY_UNAVAILABLE` SHALL remain distinct. Retry-After SHALL accept only bounded valid header values. Query keys SHALL start with Buyer, Seller, or Staff and canonical resource parameters.

#### Scenario: Current version and identity query

- **WHEN** a mutation is prepared from current server data and a valid Retry-After/query filter is used
- **THEN** the exact version is submitted, header value is bounded, and cache operations address only the matching identity key.

#### Scenario: Stale version, malformed delay, or cross-domain key

- **WHEN** a conflict occurs, Retry-After is malformed/unbounded, or a cache key lacks/mixes identity roots
- **THEN** the client requires refresh/user review, ignores the unsafe delay, and tests prevent silent overwrite, stale resubmit, or cache reuse.
