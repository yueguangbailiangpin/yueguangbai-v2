# Buyer Form State Matrix

| Form | Start authority | Required business fields | File rule | Version / idempotency | Success refresh |
|---|---|---|---|---|---|
| Registration | direct `/buyer/register`; backend ultimately decides availability | wechat, password, confirmation, optional real human token | none | backend-generated operation; no client retry loop | 201 → Customer transport invalidation → cancel/clear Buyer+Seller, preserve Staff → reread Session → enter `/buyer` only for BUYER |
| Password change | existing password-required route boundary | current and new password | none | Idempotency-Key owned by existing controller | clear Customer roots, reread Session |
| Reservation | current demand detail + unchecked acceptance | expected demand version, accepted self-pay bps | none | new logical key | demand, reservation, dashboard, affected instruction |
| Reservation cancel | `can_cancel=true` | latest expected version | none | new logical key | reservation/detail, demand, dashboard |
| Evidence initial | required `/buyer/order-materials/new?reservation_id=<id>` query + refreshed eligibility SUBMIT + instruction `can_submit_evidence` | reservation, version 0, Amazon order number, required valid date-only `amazon_order_date`, final paid JPY, optional note | exactly one verified image | business key separate from upload keys | eligibility, evidence, instruction, reservation, dashboard |
| Evidence resubmit | detail/eligibility RESUBMIT + current change deadline | latest positive version and full replacement payload including required `amazon_order_date` | exactly one newly/currently verified image | new logical key | same as initial |
| Evidence withdraw | detail `allowed_actions` contains WITHDRAW | latest positive version | none | new logical key | evidence, eligibility, instruction, dashboard |
| Review initial | required `/buyer/reviews/new?formal_order_id=<id>` query + refreshed eligible-order SUBMIT | formal order, version 0, exact review type, nullable URL, optional note | 1–3 verified evidence files | business key separate from each file stage | eligibility, reviews, dashboard |
| Review resubmit | detail/eligibility RESUBMIT | latest positive version and full replacement payload | 1–3 verified evidence files | new logical key | reviews, eligibility, dashboard |
| Review withdraw | detail action WITHDRAW | latest positive version | none | new logical key | reviews, eligibility, dashboard |
| Logout | authenticated Buyer or safe idempotent anonymous logout | none | none | existing logout controller | cancel/remove Buyer and Seller Customer roots; preserve Staff |

## Shared client states

Every form distinguishes IDLE, local INVALID, SUBMITTING, SUCCESS, safe CONFLICT, RATE_LIMITED, DEPENDENCY_ERROR, and SESSION_INVALIDATED. File-backed forms additionally expose validating, intent, uploading, completing, VERIFIED, explicit retry/restart, FILE_NOT_VERIFIED, and terminal compensation states from the Wave14A controllers.

Registration 201 enters `CUSTOMER_TRANSPORT_INVALIDATION_GROUP` rather than AUTHENTICATED. Cancellation/cleanup or Session reread failure stays fail closed. Session mismatch invokes logout and clears both Customer roots; no Buyer business content renders before a validated BUYER Session.

## Conflict rules

- Mutation retry remains false; a user action starts one logical operation.
- A safe lost-response retry reuses the same key and identical body only where the existing controller owns that state.
- Editing the body after a failed non-ambiguous attempt creates a new logical operation/key.
- VERSION_CONFLICT always refetches the current aggregate and requires explicit review; no last-write-wins behavior.
- REQUEST_IN_PROGRESS disables concurrent submit and offers only documented explicit later retry.
- File upload keys/tokens never become business-command keys.
- Successful file verification does not imply successful evidence/review submission.

## Accessible validation rules

- Reservation self-pay checkbox starts unchecked and resets on demand-version change.
- Evidence/review submission buttons remain disabled until file verification and Contract fields are valid.
- Evidence date accepts only an actual Gregorian `YYYY-MM-DD`; it remains date-only and is not derived from `submitted_at`, `confirmed_at`, or `confirmed_business_date`.
- Both new-form query identifiers must exist, pass length/character validation, and resolve through current eligibility. Missing/invalid/stale identifiers never expose the form; navigation state and Session storage are not authority.
- Error summary links/focus to fields; safe server error and request ID are separate from field validation.
- Passwords, human tokens, upload/read tokens, idempotency keys, file bytes, and Object URLs never appear in public snapshots, Query cache, URLs, or logs.
