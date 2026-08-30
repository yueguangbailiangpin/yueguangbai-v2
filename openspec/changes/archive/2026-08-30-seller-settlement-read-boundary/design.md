# Design: seller-settlement-read-boundary

## 1. Authorization flow

All seven Seller settlement endpoints continue to use the existing customer
session middleware and `resolveSellerPortalActor`. Seller member roles remain
the four canonical values `OWNER`, `OPERATIONS`, `FINANCE`, and `VIEWER`.

The five legacy financial endpoints use the existing pure domain capability
`canReadSellerSettlementFinancials` after actor resolution:

- `GET /api/seller-portal/settlement/summary`
- `GET /api/seller-portal/settlement/payables`
- `GET /api/seller-portal/settlement/payables/:id`
- `GET /api/seller-portal/settlement/payments`
- `GET /api/seller-portal/settlement/payments/:id`

When the role lacks the capability, the route throws the existing settlement
`NOT_FOUND` error with status 404. The public response remains the generic
resource-not-found envelope and must not reveal amounts, payment identifiers,
allocation identifiers, payable identifiers, or whether the target exists.

The two Seller batch routes remain read-only for all four ACTIVE Seller member
roles. At this boundary, an authenticated session whose account type is not
`SELLER_MEMBER` is converted to the same concealed `NOT_FOUND`/404 result
before Seller actor resolution. This is limited to Seller batch routes; the
legacy Seller portal account-type behavior is unchanged.

Missing cookies and invalid customer sessions remain 401. An active login with
no active Seller membership, a disabled Seller membership, or an inactive
Seller organization remains 401 through the existing actor resolution.

## 2. Organization and resource scope

The organization is always derived from the active session; no endpoint accepts
a caller-selected Seller organization. Payable list/detail queries retain the
organization predicate and current store-scope helper. Payment list/detail
queries retain the organization predicate and current organization payment
scope check. A foreign or unknown detail identifier is concealed as 404. A
foreign organization list is empty under the existing list semantics.

The current D-056 organization-wide active-store projection remains unchanged,
including visibility of disabled-store history for authorized legacy financial
readers. This Change does not alter store access tables, cursor sharing, or
historical financial facts.

## 3. DTO and privacy boundary

The legacy read models and runtime schemas are unchanged. Summary continues to
return the existing outstanding amounts, unallocated credit, and settlement
account projection. Payables and payments continue to return their existing
seller-side fields and cursor page shape. This Change changes only role access
to those existing responses.

Batch list/detail continues to use the dedicated strict Seller-safe projection:

- Batch: `batch_id`, status, frozen total/count, paid/outstanding amounts, and
  confirmation time.
- Member: Amazon order number, payable type, frozen amount, paid amount, and
  outstanding amount.

Batch responses remain free of organization IDs, employee projection fields,
version/cancel metadata, internal member IDs, Buyer refund data, internal
profit, internal notes, and object storage keys. No employee DTO is reused.

## 4. Pagination compatibility

Payables keep keyset ordering by `due_at DESC, payable_id DESC`; payments keep
keyset ordering by `paid_at DESC, payment_id DESC`. Both continue fetching one
extra row to produce `next_cursor`, use the existing encoded cursor token, and
return the current page envelope and limit constraints.

Tests use real request-level HTTP calls with a small limit to traverse at least
two pages for each list. They assert stable order, no duplicate IDs, complete
coverage, cursor continuation, and malformed-token 400 behavior. No shared
cursor helper is changed.

## 5. Frontend compatibility

The existing frontend role gate remains authoritative for presentation:
`OWNER` and `FINANCE` render the full financial page; `OPERATIONS` and `VIEWER`
render batch-only pages. The API client and strict schemas remain unchanged.
No CSS or visual route change is included. The backend payment boundary is
made consistent with this existing gate.

## 6. Test plan

- Positive summary/payables/payable-detail regression for OWNER/FINANCE.
- Positive payment list/detail for OWNER/FINANCE.
- Concealed 404 payment list/detail for OPERATIONS/VIEWER with negative
  sensitive-field assertions.
- Payables and payments two-page cursor traversal, malformed cursor, and
  organization isolation/concealed detail 404.
- Four ACTIVE Seller roles still read visible batch list/detail with safe DTOs.
- Buyer batch list/detail both return 404 without batch data.
- Existing unauthenticated, inactive/disabled membership, DRAFT/CANCELLED,
  and cross-organization behavior remains fail-closed.

## 7. Rejected alternatives

- Do not broaden legacy financial reads to all Seller roles: the confirmed
  matrix explicitly keeps those five endpoints OWNER/FINANCE-only.
- Do not narrow batch reads to OWNER/FINANCE: the confirmed matrix preserves
  four-role access to the dedicated Seller-safe batch projection.
- Do not change DTO fields to solve a role decision; that would expand this
  Change into a separate privacy-contract decision.
- Do not return 401 for an authenticated Buyer at the batch resource boundary;
  the confirmed contract is concealed 404, while 401 remains for missing or
  invalid customer sessions.
