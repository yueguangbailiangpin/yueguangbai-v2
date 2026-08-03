# Frontend Security Boundaries

## Trust Model

The browser is untrusted. D1-backed Worker Sessions, permissions, assignments, data scopes, resource ownership, state machines, versions, and file authorization remain server authority. Client-side routing and controls improve experience but never grant access.

## Identity Separation

- Buyer, Seller, and Staff use separate frontend Session state machines, providers/boundaries, query-key roots, route guards, and logout cache teardown.
- Buyer and Seller consume the real shared Customer Auth Cookie. The frontend validates `account_type` for the requested domain and never converts a Buyer session into Seller authority or vice versa.
- Staff uses the separate Staff Auth Cookie and Staff Auth routes.
- A 401 affects only the request's identity state. 403 and 404 never cause logout.
- Session data is not rendered before successful resolution, and previous-identity cached data is not shown during loading.

## Credential and Secret Boundary

Every API request is origin-relative under `/api/*` with `credentials: include`. The frontend never reads HttpOnly cookies, accepts a session token in JavaScript, embeds a Provider/client secret, hard-codes a production domain, or sends client-supplied Staff/role/permission/team/scope authority headers. No auth or sensitive cache data is written to localStorage or sessionStorage.

## Response and Error Boundary

All responses pass envelope and endpoint Zod validation. A normalized frontend error contains only `code`, `httpStatus`, `requestId`, `safeDetails`, `retryAfter`, and `category`. `safeDetails` is a code-specific allowlist, not a copy of arbitrary server details. Stack traces, SQL, object keys, Provider tokens, cookies, secrets, authorization headers, internal exceptions, and raw response bodies never enter user messages or telemetry.

`request_id` is shown in recoverable error UI and may be copied for support. It is not treated as a credential. Unknown/malformed responses become a sanitized contract/dependency error with a locally generated correlation marker only if the server request ID is unavailable.

## HTTP Semantics and Retry

- GET/HEAD-like queries may retry a small bounded number of network/transient failures with cancellation support and backoff.
- 401, 403, 404, 409, and 422 are never auto-retried.
- Mutations are never auto-retried by TanStack Query. A safe explicit network retry stays inside one logical operation and reuses its key only when the endpoint semantics allow it.
- 503 is not generally retried. Code-specific UI handles `DEPENDENCY_UNAVAILABLE` and `FILE_COMPENSATION_REQUIRED`; user action is required before a new attempt unless the exact operation defines safe retry.
- `Retry-After` is bounded and displayed/used only for supported codes such as rate limiting; malformed values are ignored.

## Idempotency and Version Boundary

One logical mutation creates one cryptographically random `Idempotency-Key` in operation-scoped memory. Safe transport retry of the identical canonical body reuses the key. A changed body or new user operation receives a new key. Re-render never creates extra keys, and completion/cancel/unmount releases operation state. Keys are not persisted.

`expected_version` comes only from the latest validated server DTO. `VERSION_CONFLICT` requires refresh and re-review; no stale automatic resubmission or silent overwrite is permitted. UI treats `IDEMPOTENCY_CONFLICT`, `REQUEST_IN_PROGRESS`, `STATE_CONFLICT`, `PRICE_MISMATCH`, `FILE_COMPENSATION_REQUIRED`, and `DEPENDENCY_UNAVAILABLE` as distinct actions/messages.

## Query Cache Boundary

Query keys begin with an identity discriminator and then resource/domain identifiers. They do not rely on display names. Logout cancels in-flight queries and removes only the matching identity root. Sensitive caches are memory-only, have conservative stale/gc behavior, and never hydrate across identity roots. Mutation responses invalidate only documented identity-domain resources.

## File Boundary

- Upload purpose and visibility are fixed by the selected route, never client-configured authority.
- Upload/read tokens stay inside the active in-memory transfer state and are removed after consume, cancel, expiry, or terminal failure.
- Multipart includes exactly one `file` part; no additional authority metadata is sent.
- The client never receives or derives `object_key`, stores a permanent URL, or calls a generic Link/Audience Grant route.
- Business commands consume verified File IDs/versions; they alone create entity links and audiences.
- Expired intent or token replay restarts from a new purpose-bound intent. Cancellation aborts transport but does not claim server rollback.
- `FILE_COMPENSATION_REQUIRED` shows a safe support/retry state and request ID; it never invents cleanup success.
- The internal-communication upload intent remains absent until Wave 15.

## Return Paths and Browser Data

Return paths are allowlisted relative application paths within the same identity domain. Absolute URLs, protocol-relative URLs, encoded cross-origin paths, and cross-identity targets are rejected. Callback query values are removed from history after handling. Search params are parsed against exact keys and bounds before becoming route state.

## Risk Register

| Risk | Required control |
|---|---|
| Shared Customer Cookie causes Buyer/Seller confusion | Validate `account_type`, separate state/query roots, never render stale opposite-domain data. |
| Cached private data survives logout | Cancel and remove matching identity queries synchronously before navigation. |
| Malformed server payload reaches components | Zod-validate envelope and DTO at the client boundary; sanitized contract error. |
| Mutation duplicate on retry | Operation-owned idempotency key, immutable body hash assumption, mutation retry off. |
| Stale version overwrites current state | Latest server DTO only; conflict refresh and explicit user re-review. |
| File token leaks or is replayed | Memory-only token, short lifecycle, no logs/storage, restart after expiry/replay. |
| Staff URL/ID is mistaken for permission | Backend remains authority; route guards are UX only; handle 403/404 distinctly. |
| Error details leak internals | Code-specific allowlist and normalized error fields only. |
| Dependency outage causes retry storm | Bounded query policy; no mutation/503 loops; honor valid Retry-After. |
| Hidden Staff entry is mistaken for security | Documentation and tests assert direct route exists and server auth remains mandatory. |
