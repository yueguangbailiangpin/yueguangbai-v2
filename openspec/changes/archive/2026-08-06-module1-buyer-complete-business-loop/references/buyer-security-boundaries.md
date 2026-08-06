# Buyer Security Boundaries

## Identity and Session

- Buyer, Seller, and Staff remain distinct authorization domains.
- Buyer/Seller use one shared HttpOnly `__Host-ygb_customer_session` cookie; the frontend cannot read it.
- Buyer/Seller Query roots clear together on Customer login replacement, registration cookie replacement, mismatch, logout, or validated 401. Staff cache/session is not cleared.
- A BUYER route receiving SELLER_MEMBER fails closed, logs out/cleans through the existing mismatch controller, and never offers cross-identity handoff.
- 403 and concealed 404 do not log out.
- `REVIEW_REQUIRED` is a safe limitation, not frontend permission to trigger staff action.

## Request authority

- Every protected business call uses `identityApiRequest('buyer', ...)` and credentials include.
- The client never sends Buyer ID, Staff ID, Seller organization, role, permission, scope, owner, status override, audit fact, financial result, or storage authority except identifiers explicitly required by the published Buyer Contract.
- `allowed_actions`, `can_cancel`, instruction booleans, status, expected versions, and server snapshots are authoritative.
- Origin guard, Session middleware, D1 scope, state machine, idempotency, and version enforcement remain backend responsibilities and are not duplicated as security claims.

## Registration

- `/buyer/register` is discoverable only by direct supplied URL; obscurity is not treated as authorization.
- Backend feature flag and verifier decide availability. The frontend never enables the flag or simulates verification.
- Public failures deliberately collapse account-exists, conflict, eligibility, configuration, and dependency details to safe messages.
- Passwords and human tokens are operation-local and not cached/logged.
- Registration 201 does not set frontend AUTHENTICATED. It immediately cancels Buyer and Seller requests, clears both Customer roots, preserves Staff, and rereads Customer Session; only BUYER succeeds. Mismatch logs out and clears both roots, and any cleanup/reread failure remains fail closed.

## Files

- Purpose, visibility, owner, entity link, and audience are derived by server workflow.
- Tokens are memory-only, bounded, one-use authorities; Object URLs are ephemeral.
- No storage object key, permanent URL, signed URL, private token, file bytes, or raw R2 diagnostic enters Query cache or UI diagnostics.
- Public FileReadController APIs do not accept arbitrary routes. Four fixed adapters create generic, instruction, review, and order-evidence intents while the existing controller retains byte/header/token/Object-URL safety.
- Instruction DTO paths must exactly match the Buyer/current-reservation/`main`-or-current-positive-position route. Review and order-evidence routes are constructed from validated entity IDs, never forwarded from unvalidated DTO strings.
- Dedicated order-evidence reads require current Buyer submission ownership, current visible link membership, positive matching version, CREATE_READ_INTENT, and explicit-audience/current formal-file authorization. Concealed misses are 404; unavailable historical facts remain metadata-only.
- One screenshot and three review files are business-layer limits even if a lower-level parser permits more.

## Disclosure and error handling

- Errors display only stable safe code/message/category, approved details, and `request_id`.
- Stack, SQL, cookie, Authorization, tokens, secrets, object key, signed URL, Provider detail, another customer/order, and raw exception are forbidden.
- Concealed ownership/scope misses are 404; permission failure is 403; both keep Session.
- Contract validation fails closed before rendering or cache insertion.

## Financial safety

- JPY is integer semantics, CNY is decimal-string fen, and rate is decimal-string e8.
- Formatting does not use floating-point fact calculation.
- Evidence PRICE_MISMATCH is a server business fact, not an exception to hide or recalculate.
- Formal-order snapshots, review refund due, and refund ledger values remain read-only.
- OVERPAID and reversals remain visible.

## Date authority

- `amazon_order_date` is a required valid Gregorian `YYYY-MM-DD` source fact from the Amazon order page, stored per evidence version and locked into new formal orders.
- It is date-only and receives no timezone conversion. Epoch milliseconds display in the frozen Buyer timezone with that timezone explicit; `confirmed_business_date` remains a separate server business date.
- Historical unknown dates remain NULL/unknown. No timestamp or business date is used to fabricate them, and new formal orders cannot omit the date.

## Explicitly excluded authority

No unrelated Backend, Contract, Domain, Migration, D1/R2 production binding, real Feishu, Seller/Staff business UI, deployment, data import, or history mutation is authorized. Later implementation is narrowly authorized only for end-to-end `amazon_order_date` (including required Migration 0028) and the one dedicated order-evidence file-read capability; this planning round changes none of that source.
