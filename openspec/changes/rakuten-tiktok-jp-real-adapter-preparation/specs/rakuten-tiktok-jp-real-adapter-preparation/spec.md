# Rakuten and TikTok Japan Real Adapter Preparation

## ADDED Requirements

### Requirement: production availability remains truthful

The system MUST keep `RAKUTEN_JP` and `TIKTOK_JP` at `adapter_status=UNAVAILABLE`, MUST register no Provider route or scheduled job, and MUST perform no Provider call when configuration, authorization or current official contract evidence is absent. Local mocks, signature vectors and transport tests MUST NOT be presented as real E2E or production acceptance.

#### Scenario: local preparation passes without activation

- **WHEN** all local contracts, fake providers, signature vectors, parsers and preflight tests pass
- **THEN** both registry adapters remain unavailable, Provider-required runtime operations fail closed, and external/Provider/resource/Secret/deployment write counters remain zero

### Requirement: official facts are gated per platform

Every production-shaped authentication, signing, endpoint, pagination, limit, retry, idempotency, error and webhook rule MUST cite a current official Provider source and version/date. An inaccessible, login-gated, historical-only or unstated rule MUST be `UNKNOWN/BLOCKED` and MUST NOT be implemented from community knowledge.

#### Scenario: Rakuten current wire contract is unavailable

- **WHEN** public official Rakuten material does not expose current auth, Order/Product wire DTO, pagination, quota/error and event-verification contracts
- **THEN** the Rakuten adapter makes zero network calls and reports unavailable instead of constructing a guessed RMS request or returning an empty authoritative page

#### Scenario: TikTok endpoint version is pinned

- **WHEN** the TikTok read adapter searches orders or products
- **THEN** it uses only the separately pinned official endpoint version and a later Provider version requires a reviewed contract and test update

### Requirement: TikTok requests use the official signing contract

TikTok requests MUST target only `https://open-api.tiktokglobalshop.com`, carry the access token only in `x-tts-access-token`, and compute lowercase hexadecimal HMAC-SHA256 from the official canonical input: query parameters except `sign` and `access_token` sorted by key and concatenated as key/value, request path prefixed, exact non-multipart body appended, then the whole input wrapped by the app secret and signed with that same secret. Secrets and tokens MUST NOT enter URLs, DTOs, logs or errors.

#### Scenario: canonical signature is deterministic

- **WHEN** the same path, sorted-equivalent query, exact body and secret are signed
- **THEN** both signatures match while changing path, signed query value or any raw body byte changes the signature

#### Scenario: redirect or unofficial origin is rejected

- **WHEN** transport construction names another origin or the Provider responds with a redirect
- **THEN** the request fails closed without following or disclosing credentials to the target

#### Scenario: request timestamp comes only from the server clock

- **WHEN** the adapter signs a request
- **THEN** it emits a ten-digit Unix-second timestamp from its configured server clock and never accepts a client timestamp; production preflight separately requires clock-synchronization evidence for TikTok's published minus-five-minute/plus-thirty-second window

### Requirement: TikTok read pagination and retry are bounded

Order reads MUST use `POST /order/202309/orders/search` with `seller.order.info`; product reads MUST use `POST /product/202502/products/search` with `seller.product.basic`. Both MUST require the authorized shop cipher, accept only page size 1 through 100, treat `page_token` as an opaque bounded string and return the Provider `next_page_token` without synthesis. No fixed QPS may be invented. Only semantically read-only searches may receive finite exponential backoff with jitter for network/timeouts, HTTP `429`, the explicitly documented HTTP `503`, or documented transient TikTok codes; other HTTP statuses MUST NOT acquire guessed retry semantics.

#### Scenario: opaque cursor is preserved

- **WHEN** TikTok returns a bounded nonempty `next_page_token`
- **THEN** the adapter returns it byte-for-byte as the next cursor and the following request places that token only in the official query parameter

#### Scenario: authentication and contract errors are not retried

- **WHEN** the Provider reports expired credentials, missing scope, IP authorization failure, unknown business failure or a malformed success envelope
- **THEN** the adapter emits the stable authentication, authorization or contract-drift class after one attempt and returns no partial page

### Requirement: Provider JSON media type is exact and singleton

A Provider JSON response MUST contain exactly one syntactically valid `Content-Type` media type whose type and subtype case-insensitively equal `application/json`. Semicolon-delimited parameters and HTTP optional whitespace MUST follow the HTTP media-type grammar: empty parameter segments MUST be accepted, while every nonempty parameter segment MUST be a syntactically valid `name=value` pair. Prefix/suffix lookalikes, alternative `+json` types, combined media types and malformed nonempty parameter syntax MUST fail as `CONTRACT`; the adapter MUST cancel the rejected response body and MUST NOT retry that contract failure.

#### Scenario: valid JSON parameters are accepted without media sniffing

- **WHEN** a Provider response uses `application/json`, any casing-equivalent form, a valid parameterized form such as `application/json; charset=utf-8`, or an HTTP-valid empty parameter segment such as `application/json;`
- **THEN** the bounded JSON parser may decode the body without MIME sniffing or widening the accepted type

#### Scenario: lookalike, combined or malformed media type is rejected

- **WHEN** a Provider response uses `application/jsonp`, a prefixed/suffixed lookalike, more than one media type, or invalid parameter syntax
- **THEN** the adapter cancels the response stream, fails once as `CONTRACT`, returns no page and performs no retry

### Requirement: Provider DTOs are minimum and non-authoritative

The read adapter MUST runtime-validate and whitelist only platform code, platform order/product identifiers, Provider status, order timestamps and order line-item product identifiers plus product title/status. It MUST omit buyer messages, recipient/contact data, user identifiers, payment, tax, discounts and settlement data. Provider DTOs MUST NOT directly write D1 or establish Seller Organization, Store, permission, idempotency, formal-order, finance or audit authority.

#### Scenario: TikTok order and product values remain platform strings

- **WHEN** a safe Provider page contains long decimal TikTok order/product IDs, or an existing source fixture contains `tiktokDLP2555Q`
- **THEN** the adapter preserves the exact string without numeric coercion, Amazon order validation, ASIN validation or financial projection

#### Scenario: source identifier provenance is not invented

- **WHEN** the existing source identifier is `tiktokDLP2555Q` but current public Provider facts do not prove whether it came from `seller_sku`, an external-id field or another source column
- **THEN** the real Search Products parser maps only official TikTok `product.id`, while the source identifier remains compatible in the platform-neutral contract until a later provenance-aware ingestion Change

#### Scenario: Rakuten source product identifiers remain compatible

- **WHEN** the existing source mapping contains Rakuten `R-1` and `S-1`
- **THEN** both remain exact opaque platform product identifiers and are not reinterpreted as ASINs or claimed as a global Rakuten format

### Requirement: TikTok webhook verification is pure and route-free

The verifier MUST compare the official `Authorization` HMAC-SHA256 over `{app_key}{exact raw payload bytes}` using the app secret in constant time, MUST parse only a bounded safe envelope after verification, and MUST pass the official published golden vector. This Change MUST NOT register a callback route, persist a receipt or acknowledge a real event.

#### Scenario: any raw payload change fails verification

- **WHEN** one byte of the official webhook fixture or the Authorization signature is changed
- **THEN** verification fails and no parsed event, Provider call or local/external write is produced

#### Scenario: future webhooks cannot replace polling authority

- **WHEN** a later Change activates a verified webhook route
- **THEN** events only wake durable reconciliation, while scheduled reads remain required and canonical ingestion rechecks scope, idempotency, audit and finance boundaries

### Requirement: preflight is redacted, external and fail closed

The machine preflight MUST read activation evidence only from an absolute path outside the repository, MUST validate declared managed-secret names without reading their values, MUST reject embedded secret-like values, and MUST print no app/shop/credential/cursor value. Its best possible local result is `LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO`; missing official Rakuten evidence MUST remain a named blocker.

#### Scenario: complete anonymous structure is still production NO-GO

- **WHEN** an external anonymous manifest declares TikTok app/shop authorization, the exact preparation scope set (authorized-shop mapping plus the two read scopes), managed-secret names, a compliant HTTPS callback origin and owner approvals
- **THEN** preflight reports locally valid structure but still blocks production for absent real authorized-shop acceptance, callback registration, durable receipt/poller/ingestion and owner activation

#### Scenario: repository config or secret value is rejected

- **WHEN** the manifest is inside the repository, omits a required evidence field, declares a write scope or embeds a credential value
- **THEN** preflight exits nonzero with stable redacted blockers and zero external/Provider/resource/Secret/deployment writes

### Requirement: schema and existing security boundaries remain unchanged

This Change MUST use `NO_SCHEMA_CHANGE`, MUST add no migration, MUST leave marketplace registry rows unavailable, and MUST add no Rakuten/TikTok Provider binding, route or scheduler job. Seller Organization/Store authorization, Personal DENY, financial snapshots, platform identity uniqueness and immutable audit behavior MUST remain unchanged. The static verifier MUST allow unrelated approved edits to shared composition and template files while still rejecting any platform-specific production wiring.

#### Scenario: adapter cannot bypass canonical ingestion

- **WHEN** a local adapter page is produced for an unauthorized, unknown or mismatched store
- **THEN** no platform identity, formal order, evidence, money snapshot, audit or idempotency row is written because this Change exposes no ingestion method

#### Scenario: Unrelated integrations do not weaken or trip the platform guard

- **WHEN** another approved Change modifies a shared Worker composition root or deployment template without adding a Rakuten/TikTok import, route, job or Provider binding
- **THEN** the platform guard still passes and continues to reject any later platform-specific production wiring
