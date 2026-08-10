# Activation Checklist and Production NO-GO

## Current Result

Both platforms remain `PRODUCTION_NO_GO`. TikTok has enough public official material for local signing, read transport and webhook-verifier tests, but there is no real authorized shop acceptance, callback registration, durable webhook/polling state or canonical ingestion. Rakuten current request contracts remain blocked behind authorized RMS/Partner documentation.

## Boss / Platform Minimum Inputs

### Rakuten

1. Choose and document the integration identity: merchant-internal application or approved system-development/Partner Portal organization.
2. Provide an active Rakuten Ichiba store contract, target test-shop identity and an RMS administrator/contact able to approve WEB API access. Do not send personal R-Login credentials to code or chat.
3. Grant the named operator only the manual/application-management access needed to export the current official Order API, Product API, authentication, pagination, quota/retry, errors and system-event documents.
4. Deliver those official files with revision/date and SHA-256; deliver no credential values.
5. Register a separate test application/store authorization with only current order-read and product-read permissions. Event permission is separate; all order/product/inventory/shipping writes remain unapproved.
6. Obtain an official test shop/environment and synthetic fixtures including a valid Rakuten order ID plus source compatibility identifiers `R-1`/`S-1`.
7. If events are later proposed, provide a controlled HTTPS domain/certificate and official confirmation of host/port/TLS/signature/ack/retry/IP rules.
8. Name the managed-secret owner, rotation/revocation operator and Rakuten support/escalation contact; keep values only in the approved secret manager.

### TikTok Shop Japan

1. Choose an eligible Partner Center application type and complete application review/enrollment for Japan/ROW as required by the current official flow.
2. Provide one separate authorized TikTok Shop Japan test shop and synthetic order/product fixtures; do not test mutations against production inventory/orders.
3. Approve the exact preparation set: `seller.authorization.info` to resolve and verify Authorized Shops/shop cipher, plus `seller.order.info` and `seller.product.basic` for the two read adapters. The authorization scope also permits webhook management, but this Change has no such method and MUST NOT call it. No product/order/inventory/fulfilment/refund/finance write scope is allowed.
4. Provide secret-manager references, not values, for `TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_ACCESS_TOKEN`, `TIKTOK_SHOP_REFRESH_TOKEN` and the authorized shop cipher; provide non-secret app-key reference metadata under owner control.
5. Provide an HTTPS callback origin controlled by the business: TLS 1.2+, domain hostname, default port, no IP literal, no query/fragment/userinfo. Final path registration waits for a durable receipt/replay Change.
6. Assign token rotation/revocation and 24×7 Provider-error escalation owners; confirm any IP allowlist and the current dynamic quota in Partner Center.
7. Authorize a separately approved anonymous acceptance window covering signature, one order page, one product page, cursor continuation, 429/timeout behavior and webhook delivery. This task performs none of those calls.

## Activation Sequence for a Later Change

1. Re-verify `origin/main`, official docs and API versions.
2. Add durable shop connection, token reference, webhook receipt/replay and poll cursor/lease schema with a new Migration.
3. Implement canonical ingestion behind Seller Organization + exact Store + permission + idempotency + audit + financial boundaries.
4. Register callback and polling while registry remains unavailable; run owner-approved anonymous acceptance and rollback rehearsal.
5. Audit every consumer that currently treats `adapter_status=AVAILABLE` as a broad business unlock.
6. Only a separately approved activation Change may consider changing registry/UI status.

## Rollback

Before activation, rollback is local code revert only. After future activation, first disable callback/poller/ingestion, retain immutable business/audit facts, revoke/rotate Provider credentials outside the repository and use forward recovery; never delete facts merely to roll back an adapter.
