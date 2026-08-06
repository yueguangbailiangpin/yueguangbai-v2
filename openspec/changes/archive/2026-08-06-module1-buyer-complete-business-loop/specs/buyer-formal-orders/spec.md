# Buyer Formal Orders Capability

## ADDED Requirements

### Requirement: Formal-order list uses real filters and cursor paging
`/buyer/orders` SHALL call `GET /api/buyer-portal/formal-orders` and support only `limit`, opaque `cursor`, `marketplace`, `product_name`, `review_type`, `confirmed_business_date`, `formal_order_id`, and normalized `amazon_order_number`. Repeated or unknown filters SHALL not be sent.

#### Scenario: Buyer filters confirmed orders
- **WHEN** the Buyer selects supported filters
- **THEN** the list requests those exact parameters and renders the returned cursor page.

#### Scenario: Filter is invalid or page is empty
- **WHEN** a date/order number is invalid or the server returns no matches
- **THEN** validation prevents an unsafe request or a genuine no-results state appears without fake counts.

### Requirement: Formal-order detail is a read-only server snapshot
`/buyer/orders/:formalOrderId` SHALL call `GET /api/buyer-portal/formal-orders/:id` and display the confirmed order DTO, including its distinct nullable-read-model `amazon_order_date` snapshot, without any Buyer mutation control or reconstruction from current catalog, demand, evidence, timestamps, business date, or rate data. Every new formal order SHALL require and lock the same valid date-only value as its selected evidence version; historical NULL SHALL display as unknown.

#### Scenario: Owned formal order loads
- **WHEN** a valid owned identifier is opened
- **THEN** the exact confirmed snapshot, Amazon order date or explicit historical unknown, and order-evidence summary are displayed without timezone conversion.

#### Scenario: Order is missing or belongs elsewhere
- **WHEN** the route returns `BUYER_FORMAL_ORDER_NOT_FOUND` or concealed 404
- **THEN** an in-shell NotFound appears with no existence or ownership disclosure.

### Requirement: Formal financial facts use decimal strings
The UI SHALL present `final_paid_jpy`, self-pay JPY, refundable principal JPY, expected CNY principal, and `cny_per_jpy_e8` from Contract decimal strings with their units and snapshot labels. `amazon_order_date` SHALL remain a separate date-only Amazon fact, epoch-millisecond timestamps SHALL display in the frozen Buyer timezone with that timezone explicit, and `confirmed_business_date` SHALL remain the server business date. It SHALL not use floating-point arithmetic or another date field to replace server facts.

#### Scenario: Snapshot values are valid
- **WHEN** a formal-order DTO passes runtime validation
- **THEN** integer-safe formatters display JPY, CNY fen, basis points, and exchange-rate snapshot fields without changing their values.

#### Scenario: Value is unsafe or inconsistent
- **WHEN** a decimal string, `amazon_order_date`, business date, timestamp, or snapshot version/date is malformed or improperly conflated
- **THEN** the UI fails closed as a contract error instead of calling `parseFloat`, `toFixed`, or showing a recomputed amount.

### Requirement: Formal-order context connects downstream reads
Formal-order list/detail SHALL provide contextual links to review submission/status and related refund records only when those separate APIs return eligible or matching objects. Review creation SHALL use `/buyer/reviews/new?formal_order_id=<id>` and reread current eligibility after load/refresh/direct link; navigation state is not authority and Session storage SHALL NOT restore the ID. The formal-order DTO itself SHALL not be treated as action authority. Future Migration 0028 SHALL add a nullable Gregorian-checked `amazon_order_date` column to immutable `formal_orders`, preserve historical NULL, and recreate the source guard so new formal orders reject NULL and match their evidence version; no index is added.

#### Scenario: Related review or refund exists
- **WHEN** eligible-review or refund data identifies the same formal order
- **THEN** the Buyer can navigate to the query-bound downstream route, which independently confirms eligibility before showing a form.

#### Scenario: Related data is absent or fails
- **WHEN** downstream APIs return no object or fail independently
- **THEN** the formal order remains readable and no inferred submit/refund state is shown.
