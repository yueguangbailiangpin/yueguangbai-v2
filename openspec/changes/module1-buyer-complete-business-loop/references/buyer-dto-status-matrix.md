# Buyer DTO and Status Matrix

## Core DTOs

| Area | Authoritative fields |
|---|---|
| Session | account/identity IDs, `account_type`, session version, password-change required, issued/expiry times. |
| Me | customer number, display name, JP marketplace, identity review status, Session expiry. |
| Demand | ID/version, product/store/task, reference JPY, self-pay bps and estimates, Buyer note, quantity, open/reservation/order times. |
| Reservation | status/version, submit/update/hold/order times, financial snapshots, accepted version/time, decision/cancel/expiry times, `can_cancel`, demand snapshot. |
| Instruction | status/content/notes/color mode, financial estimates, two deadlines, update flag, main/ordered image handles and read paths. |
| Instruction state | status/version numbers, two deadlines, evidence status, submit/read booleans, update flag. |
| Evidence target | reservation, order number, distinct required `amazon_order_date`, final/self-pay/refundable JPY facts, mismatch/difference, status/versions/times/reason/files/actions. Each file adds link ID, positive version, and only CREATE_READ_INTENT when readable. |
| Formal order target | confirmed snapshot, distinct `amazon_order_date`, financial decimal strings, rate snapshot, server `confirmed_business_date`, evidence summary. |
| Review target | order summary safely includes `amazon_order_date` when available, plus type/status/versions/times/reason/url/approved/refund-due/file count/files/actions. |
| Refund | order, four CNY balance strings, status/times, empty actions; detail adds payment/reversal activities and balance-after. |

## Status and action authority

| Domain | Status | Buyer action |
|---|---|---|
| Reservation | PENDING_REVIEW | Cancel only if `can_cancel=true`. |
| Reservation | APPROVED | Cancel only if `can_cancel=true`; instruction/evidence uses separate state APIs. |
| Reservation | REJECTED / CANCELLED / EXPIRED | None. |
| Instruction | UNPUBLISHED | State presentation only; full content unavailable. |
| Instruction | ACTIVE | Read/submit only when booleans and deadlines permit. |
| Instruction | EXPIRED / CANCELLED / COMPLETED | No evidence submit/read. |
| Instruction evidence | NONE | Initial submit may be allowed. |
| Instruction evidence | PENDING_VERIFICATION | No new submit; evidence detail may allow withdraw. |
| Instruction evidence | CHANGES_REQUESTED | Resubmit may be allowed before change deadline. |
| Instruction evidence | VERIFIED | No Buyer mutation. |
| Instruction evidence | WITHDRAWN / CONSUMED | No instruction image read/submit. |
| Order evidence | no current case | `SUBMIT` only when returned in eligibility. |
| Order evidence | PENDING_VERIFICATION | `WITHDRAW`. |
| Order evidence | CHANGES_REQUESTED | `RESUBMIT`, `WITHDRAW`. |
| Order evidence | VERIFIED / WITHDRAWN / CONSUMED | No actions. |
| Order evidence file | VERIFIED current visible linked file | `CREATE_READ_INTENT` only; absent action/version/link means metadata-only. |
| Review | no current case | `SUBMIT` only when returned in eligibility. |
| Review | PENDING_REVIEW | `WITHDRAW`. |
| Review | CHANGES_REQUESTED | `RESUBMIT`, `WITHDRAW`. |
| Review | REJECTED / WITHDRAWN / APPROVED | No actions. |
| Review file | VERIFIED current explicit-audience file | `CREATE_READ_INTENT`. |
| Refund | DUE / PARTIALLY_PAID / PAID / OVERPAID | `allowed_actions=[]`; read-only. |
| Refund activity | PAYMENT_RECORDED / PAYMENT_REVERSED | read-only. |

## Review/task types and financial units

- Demand/review types: RATING, TEXT, IMAGE, VIDEO.
- JPY demand and formal-order Contract amounts are decimal strings where declared; order-evidence JPY fields are safe integers in the current Contract.
- CNY refund and review-due values are decimal strings in fen.
- Rate direction is `cny_per_jpy_e8` and is displayed as a snapshot, not recomputed.
- `amazon_order_date` is valid Gregorian `YYYY-MM-DD`, date-only, and is never timezone-converted.
- Epoch-millisecond deadlines/timestamps display in the frozen Buyer timezone `Asia/Shanghai` with the timezone explicit.
- `confirmed_business_date` is a server business date and never substitutes for `amazon_order_date`.

## Stable frontend error semantics

| HTTP / code | Frontend behavior |
|---|---|
| 401 UNAUTHENTICATED / SESSION_INVALID | Existing identity invalidation; Buyer/Seller Customer roots clear together; Staff remains. |
| 403 PASSWORD_CHANGE_REQUIRED | Route to Buyer password boundary. |
| 403 FORBIDDEN | Retain authenticated Buyer shell; no logout. |
| 404 NOT_FOUND / concealed domain not-found | Retain shell; reveal no ownership/existence detail. |
| 409 VERSION_CONFLICT | Refetch current aggregate; keep safe input; require explicit retry. |
| 409 IDEMPOTENCY_CONFLICT | Do not generate a silent replacement request; explain logical-operation conflict. |
| 409 REQUEST_IN_PROGRESS | No concurrent/automatic retry; explicit later retry with same operation key where controller supports it. |
| 409 business state/capacity/duplicate | Display safe server semantic; do not override or infer authority. |
| 429 RATE_LIMITED | Respect safe Retry-After presentation; no automatic mutation resubmit. |
| 503 DEPENDENCY_UNAVAILABLE | Sanitized recoverable state and request ID; Session is not declared absent. |
| malformed envelope/DTO | Contract error; fail closed and show no raw payload. |
