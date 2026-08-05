# Buyer Security Boundaries

## Identity and Session

- Buyer, Seller, and Staff remain distinct authorization domains.
- Buyer/Seller use one shared HttpOnly `__Host-ygb_customer_session` cookie; the frontend cannot read it.
- Buyer/Seller Query roots clear together on Customer login replacement, mismatch, logout, or validated 401. Staff cache/session is not cleared.
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

## Files

- Purpose, visibility, owner, entity link, and audience are derived by server workflow.
- Tokens are memory-only, bounded, one-use authorities; Object URLs are ephemeral.
- No storage object key, permanent URL, signed URL, private token, file bytes, or raw R2 diagnostic enters Query cache or UI diagnostics.
- Instruction and review reads use their entity-specific paths. Generic reads require authoritative positive file version.
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

## Explicitly excluded authority

No Backend, Contract, Domain, Migration, D1/R2 production binding, real Feishu, Seller/Staff business UI, deployment, data import, or history mutation is authorized by this Change.
