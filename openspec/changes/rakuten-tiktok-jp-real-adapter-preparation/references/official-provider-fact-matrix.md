# Official Provider Fact Matrix

Access date for every source: 2026-08-10. `CONFIRMED_PUBLIC` means a current public official page states the fact. `CONFIRMED_HISTORICAL` proves only historical existence. `UNKNOWN/BLOCKED` means the current official contract is unavailable without Provider authorization or is not stated publicly.

## Rakuten RMS

| Area | Status | Frozen fact / implementation consequence | Official source |
|---|---|---|---|
| RMS prerequisite | CONFIRMED_PUBLIC | RMS accounts are issued after a Rakuten Ichiba store contract; shop/order operations exist in RMS. | https://www.rakuten.co.jp/ec/environment/service/ |
| Current specification access | UNKNOWN/BLOCKED | Enterprise/Merchant portals and the RMS WEB SERVICE manual require authorized login. Portal login identity is not an API credential. | https://webservice.rms.rakuten.co.jp/enterprise-portal/ ; https://navi-manual.faq.rakuten.net/service/000010629 |
| Application/store approval | CONFIRMED_PUBLIC | Official service pages describe store approval for WEB API access and License Key issuance; the current portal exposes application registration. Exact credential wire fields remain unknown. | https://service.rms.rakuten.co.jp/product/0195-0001/1 ; https://service.rms.rakuten.co.jp/product/0212-0001/1 ; https://webservice.rms.rakuten.co.jp/merchant-portal/mainMenu |
| Auth/signing | UNKNOWN/BLOCKED | Header, scheme, canonical string, timestamp/nonce, body hash, clock tolerance, certificate and allowlist rules are not publicly frozen. No request may be built. | Authorized RMS manual required |
| Order/Product API | UNKNOWN/BLOCKED | Current names, versions, base URL, methods and wire DTOs are not publicly frozen. A 2021 maintenance page proves only historical RakutenPayOrderAPI/event names. | https://www.rakuten.co.jp/misc/maint_opp_backoffice_20211215.html |
| Rakuten order identifier | CONFIRMED_PUBLIC | Public buyer help describes three numeric segments: 6 digits, 8 digits and at least 7 digits. Preserve as a string and never apply Amazon validation. Existing narrower source profile is not broadened by this no-import Change. | https://ichiba.faq.rakuten.net/detail/000006629 |
| Product identifier | UNKNOWN/BLOCKED | Provider wire identifier is unknown. Existing `R-1`/`S-1` are compatible opaque source identifiers, not a claimed global format. | Current authorized Product API spec required |
| Pagination/rate/retry/idempotency/errors | UNKNOWN/BLOCKED | Cursor/page rules, quotas, retry semantics, write idempotency and error codes are not publicly frozen. No guessed mappings or QPS. | Current authorized RMS specs required |
| Events | PARTIAL/BLOCKED | Current portal exposes system-event application/settings; current verification, callback, ack, retry, order and replay semantics are unknown. Event ingress stays off. | https://webservice.rms.rakuten.co.jp/merchant-portal/mainMenu ; https://service.rms.rakuten.co.jp/product/0015-0036 |
| Test environment | CONFIRMED_PUBLIC existence | Official developer support describes Rakuten API/RMS test-environment support and the portal exposes test-shop management; eligibility must be confirmed for the chosen integration mode. | https://service.rms.rakuten.co.jp/docs/vendorInfo/ ; https://webservice.rms.rakuten.co.jp/merchant-portal/mainMenu |

## TikTok Shop Open Platform

| Area | Status | Frozen fact / implementation consequence | Official source |
|---|---|---|---|
| Production origin/method | CONFIRMED_PUBLIC | Production requests use `https://open-api.tiktokglobalshop.com`; endpoint pages define method/path. | https://partner.tiktokshop.com/docv2/page/methods-and-endpoints |
| Request signing | CONFIRMED_PUBLIC | HMAC-SHA256 canonical request, sorted query excluding `sign`/`access_token`, path, exact non-multipart body, app-secret wrapping; token header is `x-tts-access-token`. | https://partner.tiktokshop.com/docv2/page/sign-your-api-request |
| Authorization | CONFIRMED_PUBLIC | Japan is ROW. Auth code is single use and expires in 30 minutes. Token exchange/refresh and server-generated one-time `state` remain an external owner process in this Change. Authorized shops MUST be resolved through the official shop endpoint; a caller-supplied cipher is never authority. | https://partner.tiktokshop.com/docv2/page/authorization-overview-202407 ; https://partner.tiktokshop.com/docv2/page/get-authorized-shops-202309 ; https://partner.tiktokshop.com/docv2/page/access-scope |
| Order read | CONFIRMED_PUBLIC | `POST /order/202309/orders/search`, scope `seller.order.info`, `shop_cipher`, page size 1..100, opaque token; safe fields include id/status/create/update and line-item product ID. | https://partner.tiktokshop.com/docv2/page/get-order-list-202309 |
| Product read | CONFIRMED_PUBLIC | `POST /product/202502/products/search`, scope `seller.product.basic`, `shop_cipher`, page size 1..100 and opaque token; safe fields include id/title/status. | https://partner.tiktokshop.com/docv2/page/search-products-202502 |
| Versioning | CONFIRMED_PUBLIC | API versions are per endpoint and independently pinned; no silent upgrade. | https://partner.tiktokshop.com/docv2/page/api-versioning |
| Rate/retry | CONFIRMED_PUBLIC | Limits are dynamic per App ID × shop; handle 429 with exponential backoff/jitter and distinguish 503. If present, `Retry-After` (seconds or HTTP-date) is a minimum wait. Do not invent fixed QPS. | https://partner.tiktokshop.com/docv2/page/rate-limits |
| Errors: retryable | CONFIRMED_PUBLIC selected codes | HTTP 429/`36009002` → `RATE_LIMITED`; endpoint `36009003` and `36009007` → `TRANSIENT` for these read-only calls. | https://partner.tiktokshop.com/docv2/page/common-errors ; endpoint Error Code tables |
| Errors: auth/config | CONFIRMED_PUBLIC selected codes | `105002` expired token and `106001` invalid signature → `AUTHENTICATION`; `101000` token/shop mismatch, `105005` missing scope and `36009033` IP authorization → `AUTHORIZATION`; `106013` missing shop cipher → `CONFIGURATION`. None is blindly retried. | https://partner.tiktokshop.com/docv2/page/common-errors |
| Errors: protocol/unknown | CONFIRMED_PUBLIC selected codes + conservative local mapping | `36009009` path, `36009010` method, `36009014` version and `36009022`/`36009023` content/body → `CONTRACT`. `36009004` has multiple incompatible meanings and is never classified by number alone; because this adapter does not expose/trust Provider messages, it fails closed as `CONTRACT`. Any unknown nonzero code or malformed envelope also fails as `CONTRACT`. | https://partner.tiktokshop.com/docv2/page/common-errors |
| Webhook signature | CONFIRMED_PUBLIC | `Authorization` is HMAC-SHA256 over app key plus exact raw payload using app secret; official page publishes a golden vector. | https://partner.tiktokshop.com/docv2/page/tts-webhooks-overview |
| Webhook delivery | CONFIRMED_PUBLIC | HTTPS/TLS callback, domain rather than IP, no port, 200/401 within 3 seconds; documented retries are 2m, 30m, 3h and 12h. Network loss means polling remains required. | https://partner.tiktokshop.com/docv2/page/configuration-guide ; https://partner.tiktokshop.com/docv2/page/tts-webhooks-overview |
| Webhook freshness/replay TTL | UNKNOWN/BLOCKED | Public webhook material does not state a timestamp acceptance window or notification-id retention TTL. Never reuse the OpenAPI request window; a later durable-ingress Change must approve a local replay-retention policy covering the documented retry span. | Current official webhook specification or approved local policy required |
| Webhook management scope | CONFIRMED_PUBLIC | Webhook management uses `seller.authorization.info`; this Change does not call it. | https://partner.tiktokshop.com/docv2/page/update-shop-webhook |
| Japan development shop | CONFIRMED_PUBLIC | Development Shop is the official test-account path; a development app cannot use a live online seller for this stage. Core Function JP shops support synthetic product/order API testing but are not production E2E. | https://partner.tiktokshop.com/docv2/page/seller-center-development-shops ; https://partner.tiktokshop.com/docv2/page/seller-authorization-guide |

## Conservative Local Policies (not Provider claims)

- Adapter reads are non-authoritative and cannot write D1 directly.
- Unknown Rakuten rules block construction; unavailable is an error, never an empty page.
- TikTok webhook verification is pure; without durable replay state, there is no route.
- Read retries are finite and bounded; all platform writes remain structurally absent.
- Provider payloads never establish seller/store scope, permission, financial snapshots or audit truth.
