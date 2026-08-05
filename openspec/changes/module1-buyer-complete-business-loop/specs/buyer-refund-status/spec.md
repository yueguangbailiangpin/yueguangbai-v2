# Buyer Refund Status Capability

## ADDED Requirements

### Requirement: Refund list is paged and read-only
`/buyer/refunds` SHALL call `GET /api/buyer-portal/refunds` with only `limit` and opaque `cursor`, and display obligation/order summary, due, net paid, remaining, overpaid, status, due/payment/update timestamps, and empty `allowed_actions` from each DTO.

#### Scenario: Refund obligations load
- **WHEN** the API returns one or more items
- **THEN** returned balances and statuses are displayed without any Buyer mutation control.

#### Scenario: No refund or malformed actions appear
- **WHEN** the page is empty or `allowed_actions` is not empty
- **THEN** a genuine empty state appears or the malformed response fails closed rather than rendering an operation.

### Requirement: Refund detail shows the complete activity ledger
`/buyer/refunds/:refundId` SHALL call `GET /api/buyer-portal/refunds/:id` and display every returned PAYMENT_RECORDED and PAYMENT_REVERSED activity in server order, including amount, occurrence time, payment channel, and full balance-after snapshot.

#### Scenario: Payment and reversal history loads
- **WHEN** detail contains both activity types
- **THEN** both remain visible in chronology and each balance-after is labelled.

#### Scenario: Refund is concealed or activity is incoherent
- **WHEN** the detail returns 404 or runtime validation finds an unknown activity/channel/status
- **THEN** the page shows safe NotFound or contract failure without dropping reversals or guessing history.

### Requirement: Refund amounts preserve integer-fen authority
`due_amount_cny_fen`, `net_paid_cny_fen`, `remaining_amount_cny_fen`, and `overpaid_amount_cny_fen` SHALL be formatted directly from decimal strings. OVERPAID and its positive overpaid amount SHALL remain visible; the frontend SHALL not collapse it to zero or a negative remaining balance.

#### Scenario: Refund is due, partial, paid, or overpaid
- **WHEN** any Contract status is returned
- **THEN** all four amount fields display with explicit CNY semantics and status text.

#### Scenario: Balance strings are unsafe or inconsistent
- **WHEN** a string cannot be integer-formatted or fields conflict with status
- **THEN** the DTO fails runtime validation instead of using floating point or recomputing the ledger.

### Requirement: Refund refresh is scoped to real change signals
Refund list/detail SHALL use Buyer-rooted keys and refetch on explicit navigation/focus or after an approved review makes a due fact relevant. The dashboard MAY surface returned unpaid/changed items but SHALL not poll without a documented bound or claim real-time settlement.

#### Scenario: Refund-related fact changes
- **WHEN** an approved review is returned or the Buyer explicitly refreshes
- **THEN** only refund/dashboard keys are invalidated or refetched as documented.

#### Scenario: Data is stale or dependency fails
- **WHEN** a refund source cannot refresh
- **THEN** cached content is labelled by its last successful state and a safe retry is offered without fabricating arrival or payment status.
