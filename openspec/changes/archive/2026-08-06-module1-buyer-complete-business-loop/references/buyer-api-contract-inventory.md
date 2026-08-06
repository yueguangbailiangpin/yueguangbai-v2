# Buyer API and Contract Inventory

All paths below are registered on the formal baseline and use the existing success/error envelopes. Customer-protected calls use the shared HttpOnly Customer Session; business calls require BUYER. The baseline has exactly 38 Buyer-relevant endpoints. The separately marked future target adds exactly one endpoint for a total of 39.

## Registration and Customer Auth (5)

| Method | Path | Request / response authority |
|---|---|---|
| POST | `/api/buyer-auth/register` | `wechat_id`, `password`, `password_confirmation`, optional `human_verification_token`; backend flag, verifier, rate limit and conflict hiding; 201 replaces the Customer cookie but is not frontend authentication authority. |
| POST | `/api/customer-auth/login` | `login_identifier`, `password`; returns Customer Session with account type. |
| POST | `/api/customer-auth/change-password` | current/new password + Idempotency-Key; returns fresh Session. |
| POST | `/api/customer-auth/logout` | Origin guarded; returns logged-out facts and clears cookie. |
| GET | `/api/customer-auth/session` | Returns current Customer Session. |

## Buyer portal, demand and reservation (7)

| Method | Path | Request / response authority |
|---|---|---|
| GET | `/api/buyer-portal/me` | Buyer identity/profile and Session expiry. |
| GET | `/api/buyer-portal/demands` | `limit` 1–100, opaque `cursor`; public active demand page. |
| GET | `/api/buyer-portal/demands/:id` | Current public demand detail. |
| POST | `/api/buyer-portal/demands/:id/reservations` | Exact `expected_demand_version`, `accepted_buyer_self_pay_bps`, Idempotency-Key. |
| GET | `/api/buyer-portal/reservations` | `limit`, opaque `cursor`; own reservation page. |
| GET | `/api/buyer-portal/reservations/:id` | Own reservation detail, snapshots and `can_cancel`. |
| POST | `/api/buyer-portal/reservations/:id/cancel` | Exact positive `expected_version`, Idempotency-Key. |

## Order instruction (3)

| Method | Path | Request / response authority |
|---|---|---|
| GET | `/api/buyer-portal/reservations/:id/order-instruction` | Full content only for readable ACTIVE instruction; otherwise 403/409/410. |
| GET | `/api/buyer-portal/reservations/:id/order-instruction/state` | All status/state facts including submit/read booleans and two deadlines. |
| POST | `/api/buyer-portal/reservations/:id/order-instruction/images/:position/read-intent` | `position` is `main` or positive integer; Idempotency-Key; first response holds short read token. |

## Order evidence (6)

| Method | Path | Request / response authority |
|---|---|---|
| GET | `/api/buyer-portal/order-evidence/eligible-reservations` | `limit`, `cursor`; approved/no-evidence or changes-requested items plus actions. |
| POST | `/api/buyer-portal/order-evidence` | Initial command, expected version 0, one screenshot enforced by HTTP guard/domain. |
| GET | `/api/buyer-portal/order-evidence` | `limit`, `cursor`; own current evidence page. |
| GET | `/api/buyer-portal/order-evidence/:id` | Own current evidence detail. |
| POST | `/api/buyer-portal/order-evidence/:id/resubmit` | Latest positive version and full replacement payload. |
| POST | `/api/buyer-portal/order-evidence/:id/withdraw` | Latest positive version. |

## Formal orders (2)

| Method | Path | Request / response authority |
|---|---|---|
| GET | `/api/buyer-portal/formal-orders` | `limit`, `cursor`, marketplace, product name, review type, confirmed business date, formal-order ID, Amazon order number. |
| GET | `/api/buyer-portal/formal-orders/:id` | Own immutable confirmed order snapshot. |

## Reviews (7)

| Method | Path | Request / response authority |
|---|---|---|
| GET | `/api/buyer-portal/reviews/eligible-orders` | `limit`, `cursor`; no review or CHANGES_REQUESTED order plus actions. |
| POST | `/api/buyer-portal/reviews` | Initial expected version 0, review type/url, 1–3 files, optional note. |
| GET | `/api/buyer-portal/reviews` | `limit`, `cursor`; own review summaries. |
| GET | `/api/buyer-portal/reviews/:id` | Own review detail and current files. |
| POST | `/api/buyer-portal/reviews/:id/resubmit` | Latest positive version and full replacement payload. |
| POST | `/api/buyer-portal/reviews/:id/withdraw` | Latest positive version. |
| POST | `/api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent` | Positive `expected_file_version`, Idempotency-Key; explicit-audience current file link. |

## Refunds (2)

| Method | Path | Request / response authority |
|---|---|---|
| GET | `/api/buyer-portal/refunds` | `limit`, `cursor`; own read-only obligation summaries. |
| GET | `/api/buyer-portal/refunds/:id` | Own obligation plus payment/reversal activities. |

## Buyer file HTTP (6)

| Method | Path | Request / response authority |
|---|---|---|
| POST | `/api/buyer-portal/file-uploads/order-evidence/intents` | Fixed ORDER_EVIDENCE / BUYER_VISIBLE. |
| POST | `/api/buyer-portal/file-uploads/review-evidence/intents` | Fixed REVIEW_EVIDENCE / SELLER_VISIBLE. |
| PUT | `/api/buyer-portal/file-uploads/:fileObjectId/content` | One multipart `file`, upload token and Idempotency-Key. |
| POST | `/api/buyer-portal/file-upload-intents/:id/complete` | Positive intent `expected_version`; verifies R2 and returns file version. |
| POST | `/api/buyer-portal/files/:fileObjectId/read-intents` | Positive `expected_file_version`; legacy or resolved explicit link. |
| GET | `/api/buyer-portal/file-read-intents/:id/content` | One short read token; bounded bytes, no-store, nosniff. |

## Future Module 1 target (1; total 39)

| Method | Path | Request / response authority |
|---|---|---|
| POST | `/api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent` | Body is exactly positive `expected_file_version`; current Buyer must own the submission, link must be a currently visible submission file, version must match, and explicit-audience or current formal-file authorization applies. Concealed scope miss is 404. Response matches Buyer Review safety fields: `read_intent_id`, `file_object_id`, nullable `access_token`, `access_token_available`, `expires_at`, `replayed`; replay does not reissue a token. Content remains the existing Buyer bytes endpoint. |

No other endpoint is added or inferred by this module.

## Future narrow Contract and Schema target

- Initial and resubmit order-evidence requests add required `amazon_order_date`.
- `BuyerOrderEvidenceDto` adds `amazon_order_date: string | null`; `BuyerFormalOrderDto` and review order summaries add the same nullable-read-model snapshot field. NULL is legacy-only: every new initial/resubmit mutation and new formal-order projection must return a real date.
- `BuyerOrderEvidenceFileDto` adds `file_entity_link_id`, positive `version`, and `allowed_actions` whose only value is `CREATE_READ_INTENT`.
- `amazon_order_date` is strict valid Gregorian `YYYY-MM-DD`, represents the date displayed on the Amazon order page, remains date-only, and is never replaced by a submission/confirmation timestamp or `confirmed_business_date`.
- Migration 0028 is required for nullable checked columns on `order_evidence_versions` and `formal_orders`; new-row guards require the date and formal-order source matching, historical NULL remains unknown, and no index is needed.

## API limitations relevant to planning

- No dashboard aggregation endpoint exists.
- All business lists use cursor pagination with default page size 20 and maximum 100; no total count is returned.
- Instruction state is per reservation, so an exhaustive dashboard would create unbounded N+1 calls.
- Baseline `BuyerOrderEvidenceFileDto` exposes object ID, name, MIME, size, status, visibility, and verified time but not link/version/action facts. The authorized target fixes new readable data through the dedicated endpoint and DTO fields. Historical records that cannot be authoritatively backfilled remain metadata-only; the frontend never guesses version 1.
- Baseline order-evidence and formal-order Contracts/Schemas omit the product-required Amazon order date. The authorized date prerequisite fixes only that end-to-end fact; no historical date is fabricated.
- Full instruction content is intentionally unavailable outside readable ACTIVE state; the state endpoint is the status authority.
- No Buyer write route exists for formal orders or refunds.
