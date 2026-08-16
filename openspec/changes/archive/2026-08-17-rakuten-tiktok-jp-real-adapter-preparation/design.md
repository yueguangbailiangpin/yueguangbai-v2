# Design: Rakuten and TikTok Japan Real Adapter Preparation

## Existing Authority and Activation Boundary

Canonical runtime codes remain `RAKUTEN_JP` and `TIKTOK_JP`; source-local `JP_RAKUTEN`/`JP_TIKTOK` names are not Provider codes. `marketplace_registry.adapter_status=UNAVAILABLE` remains the only production activation truth. Provider preparation readiness is intentionally not represented by a new feature flag because no production path consumes it.

The adapter returns validated read models only. It has no D1 binding and no method that writes a platform or local business fact. A future ingestion application service must re-resolve the canonical marketplace, seller organization, exact store scope and current permission, then use existing platform identity/formal-order carriers, local idempotency and immutable audit. Provider status, amount or address data cannot bypass the existing financial snapshot or authorization services.

## Official Fact Freeze

The detailed matrix is in `references/official-provider-fact-matrix.md` and records source URL, page/version and access date. Only `CONFIRMED_PUBLIC` facts may become production-shaped code.

Rakuten public official material confirms marketplace/RMS prerequisites, application/store approval and License Key existence, a test-environment programme, event-service existence, and the public order-number shape. Current auth scheme, request credentials beyond License Key existence, Order/Product endpoints and wire DTOs, pagination, quota/retry, error taxonomy, idempotency and event verification/delivery remain `UNKNOWN/BLOCKED` behind RMS/Partner authorization. Therefore the Rakuten adapter is network-inert and always throws `UNAVAILABLE`; common community knowledge such as `serviceSecret`, `ESA`, Item API versions or guessed QPS is deliberately absent.

TikTok Shop public official documents freeze:

- production origin `https://open-api.tiktokglobalshop.com`;
- `x-tts-access-token` header and HMAC-SHA256 request signing over sorted query parameters excluding `sign`/`access_token`, path, exact non-multipart body and app-secret wrapping;
- ten-digit Unix-second request timestamps generated from the server clock; the official acceptance window is no earlier than five minutes before receipt and no later than thirty seconds after receipt;
- order search `POST /order/202309/orders/search` with `seller.order.info`, `shop_cipher`, bounded `page_size` and opaque `page_token`;
- product search `POST /product/202502/products/search` with `seller.product.basic`, `shop_cipher`, bounded `page_size` and opaque `page_token`;
- dynamic App-ID × shop rate limits, `429` handling with bounded exponential backoff plus jitter, distinct `503`, and selected published business errors;
- webhook `Authorization` HMAC-SHA256 over `{app_key}{raw payload}`, HTTPS/TLS callback constraints, 3-second acknowledgement and documented delivery retries; webhooks are not sufficient without scheduled pulls.

API versions are pinned per endpoint. Version changes require an explicit contract/test update; the adapter never silently switches to a newer page.

## Contract and Privacy Boundary

`MarketplaceReadAdapter` exposes only `listOrdersPage` and `listProductsPage`, each returning an opaque cursor. Normalized order DTOs contain marketplace code, platform order identifier, provider status, Unix-derived timestamps and line-item product identifiers. Normalized product DTOs contain marketplace code, platform product identifier, title and provider status. Buyer message, recipient address, email, user ID, payment, tax, discount and settlement fields are intentionally not returned.

Every provider value is runtime-validated, bounded and NFKC-normalized through the existing platform-identifier boundary. Rakuten `R-1`/`S-1`, TikTok long decimal order IDs and the existing source identifier `tiktokDLP2555Q` remain strings; no number coercion or Amazon order/ASIN validator is permitted. The live Search Products parser maps only TikTok-generated `product.id`; it does not guess that `tiktokDLP2555Q` is a generated product ID, SKU or other official wire field. A future ingestion Change must preserve source-field provenance instead of collapsing those identities. Unknown or missing upstream fields never become client-computed authority.

## TikTok Transport and Error Boundary

The transport accepts injected `fetch`, clock, sleep and jitter for deterministic tests. It fixes the official origin, rejects redirects, applies a finite timeout, bounds JSON bytes and array sizes, and never logs request bodies, tokens, app secret, shop cipher or upstream PII.

Provider JSON responses must carry exactly one syntactically valid HTTP media type whose case-insensitive type/subtype is exactly `application/json`. Semicolon-delimited parameters and HTTP optional whitespace follow the HTTP media-type grammar: empty parameter segments are accepted, while every nonempty parameter segment must be a syntactically valid `name=value` pair. Prefix/suffix lookalikes, structured-suffix alternatives, combined field values and malformed nonempty parameters fail as `CONTRACT`. A media-type rejection cancels the response body and is never converted into a successful empty page or a retry.

Only read-only search requests are retryable. Network/timeout, HTTP `429`, the explicitly documented HTTP `503`, and documented TikTok codes `36009002`, `36009003`, `36009007` receive finite exponential backoff with jitter; other HTTP statuses have no invented retry semantics. A valid `Retry-After` is the minimum wait, while a value beyond the local 60-second cap fails as rate-limited instead of retrying too early. No fixed official QPS is invented. `105002`/`106001` map to authentication; `101000`/`105005`/`36009033` map to authorization; missing shop cipher `106013` maps to configuration; `36009009`/`36009010`/`36009014`/`36009022`/`36009023`, malformed envelopes and unknown nonzero business codes map to contract drift. Ambiguous code `36009004` is never classified by number alone and also fails as contract drift because Provider messages are not exposed or trusted for authorization branching. The adapter does not refresh OAuth tokens, mutate orders/products or use idempotency keys because all platform writes are out of scope. A durable per-app × shop × endpoint limiter remains an activation blocker.

## Webhook and Polling Boundary

This Change implements only a pure TikTok raw-byte signature verifier and safe envelope parser. It registers no public route because there is no durable receipt/replay/lease store and no authorized callback domain. A future route must verify before parsing, enforce a bounded body, apply only a separately reviewed local replay-retention policy, record durable notification idempotency before acknowledgement, and return only the official `200`/`401` outcomes within the provider deadline. TikTok's public webhook material does not publish a timestamp-freshness window or notification-id retention TTL, so the OpenAPI request timestamp window MUST NOT be reused for webhook acceptance.

Even after future activation, webhook payloads may only wake reconciliation. Official guidance says network problems can lose webhook delivery, so scheduled order pulls remain required; event payloads cannot directly become formal-order, permission or financial authority. Rakuten event ingress remains disabled because current verification and delivery semantics are blocked.

## Preflight and Rollback

Explicit `--inspect` reports only the local implementation state and blockers. The activation preflight otherwise requires an absolute manifest outside the repository, validates non-secret evidence and declared managed-secret names, redacts values and performs no network call; a missing manifest exits nonzero. TikTok can reach `LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO`; Rakuten remains `BLOCKED_OFFICIAL_SPEC` until a dated official spec bundle and digest cover every unknown contract. Registry state remains unavailable, no Provider route or scheduler wiring is added, and Cloudflare templates receive no Rakuten/TikTok Provider binding. The verifier checks these platform-specific boundaries structurally instead of byte-locking shared composition or template files, so separately approved integrations do not create false failures. Rollback is deletion/revert of unused local code with no schema or external cleanup.

Rejected alternatives:

- Changing `adapter_status` to `AVAILABLE` is rejected because existing consumers would unlock incomplete product, seller and finance paths.
- Adding unused Wrangler flags or secret placeholders is rejected because they would imply a production path that does not exist.
- Persisting cursors or webhook receipts in memory is rejected because Worker instances cannot provide durable replay or ordering guarantees.
- Copying Feishu/Rakuten community auth, retry or error rules is rejected because Provider semantics must be independently official.
