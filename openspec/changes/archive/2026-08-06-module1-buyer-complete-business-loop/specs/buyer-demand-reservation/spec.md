# Buyer Demand and Reservation Capability

## ADDED Requirements

### Requirement: Public demand list uses the real paged projection
`/buyer/tasks` SHALL read `GET /api/buyer-portal/demands` with `limit` and opaque `cursor` and display product, store, task type, reference JPY, self-pay basis points and estimates, Buyer-visible note, remaining quantity, reservation deadline, and order deadline from each DTO.

#### Scenario: Published demands are returned
- **WHEN** the API returns demand items
- **THEN** the list renders only returned values, labels JPY units, and offers the next cursor without inventing quantities.

#### Scenario: No demand or page fails
- **WHEN** the page is empty or a later cursor fails
- **THEN** a genuine empty or page-specific error is shown while previously validated items remain distinguishable from fresh loading.

### Requirement: Demand detail is versioned and read-only
`/buyer/tasks/:demandId` SHALL read `GET /api/buyer-portal/demands/:id`, retain `demand_version`, and show the full Buyer-safe projection without Seller internals, ASIN, product URL, keywords, object keys, or storage authority.

#### Scenario: Demand detail loads
- **WHEN** a Buyer opens a returned demand identifier
- **THEN** the page displays the exact current DTO and uses its version for any subsequent acceptance.

#### Scenario: Demand expires or is concealed
- **WHEN** the demand is no longer public or returns 404
- **THEN** the detail becomes unavailable without exposing why another resource is hidden or reusing stale acceptance data.

### Requirement: Self-pay facts require explicit acceptance
Before reservation, the UI SHALL prominently display `buyer_self_pay_bps`, `estimated_buyer_self_pay_jpy`, `estimated_refundable_principal_jpy`, and current `demand_version`, and SHALL require an initially unchecked explicit confirmation.

#### Scenario: Buyer confirms current facts
- **WHEN** the Buyer reviews the amounts and checks the confirmation
- **THEN** the reservation control becomes available using the displayed version and basis points.

#### Scenario: Buyer has not confirmed or facts refresh
- **WHEN** the checkbox is unchecked or refreshed facts differ
- **THEN** submission remains blocked and any prior confirmation is cleared.

### Requirement: Reservation creation is idempotent and version-bound
Reservation creation SHALL call `POST /api/buyer-portal/demands/:id/reservations` with exactly `expected_demand_version`, `accepted_buyer_self_pay_bps`, and one operation-scoped `Idempotency-Key`. The client SHALL not auto-retry the mutation.

#### Scenario: Reservation is created or replayed
- **WHEN** the server returns 201 or a same-operation replay returns 200
- **THEN** the returned reservation becomes authoritative and related demand, reservation, eligible-evidence, instruction, and dashboard keys are precisely invalidated.

#### Scenario: Version, capacity, or acceptance conflicts
- **WHEN** the API returns version conflict, capacity full, existing reservation, product conflict, expired demand, or acceptance mismatch
- **THEN** the UI keeps the server error semantic, requires refresh/reconfirmation where applicable, and never silently overwrites.

### Requirement: Reservation list preserves server states and snapshots
`/buyer/reservations` SHALL page `GET /api/buyer-portal/reservations` and display `PENDING_REVIEW`, `APPROVED`, `REJECTED`, `CANCELLED`, or `EXPIRED` plus returned snapshot amounts, accepted version/time, hold, order deadline, decision, cancellation, expiry, and `can_cancel`.

#### Scenario: Reservation history loads
- **WHEN** the API returns multiple statuses
- **THEN** each status is textually named and its historical snapshots are displayed without recalculation from current demand values.

#### Scenario: Unknown status or malformed snapshot appears
- **WHEN** runtime validation sees a value outside the Contract
- **THEN** the response fails as a contract error instead of rendering an invented label or action.

### Requirement: Reservation detail controls downstream entry
`/buyer/reservations/:reservationId` SHALL read the real reservation detail and, for an approved reservation, provide contextual entry to the order-instruction state and evidence journey. It SHALL not infer approval from timestamps or other fields.

#### Scenario: Approved reservation opens
- **WHEN** the reservation DTO status is `APPROVED`
- **THEN** the detail offers the real instruction-state check and downstream link using that reservation identifier.

#### Scenario: Reservation is not approved
- **WHEN** status is pending, rejected, cancelled, or expired
- **THEN** the page explains the returned state and exposes no evidence submission shortcut.

### Requirement: Reservation cancellation follows server authority
Cancellation SHALL be offered only when `can_cancel=true` and SHALL call `POST /api/buyer-portal/reservations/:id/cancel` with latest positive `expected_version` and a new logical-operation idempotency key.

#### Scenario: Cancellable reservation is cancelled
- **WHEN** the Buyer confirms cancellation against the current version
- **THEN** the returned reservation replaces stale detail and only reservation/demand/dashboard-related keys are invalidated.

#### Scenario: Cancellation conflicts
- **WHEN** `can_cancel=false`, the version changed, or state is already decided
- **THEN** no button is shown or the conflict requires refetch; the client never forces or repeats cancellation automatically.

### Requirement: Demand and reservation money and time are presentation-only
JPY decimal strings and basis points SHALL be formatted without floating-point financial calculation. UTC epoch timestamps SHALL be displayed in `Asia/Shanghai` with explicit labels for reservation and order deadlines.

#### Scenario: Values are valid
- **WHEN** a demand or reservation DTO is rendered
- **THEN** integer strings receive separators and units while the underlying value remains unchanged.

#### Scenario: Boundary time or unsafe numeric conversion occurs
- **WHEN** a deadline is at the current boundary or a value cannot be safely formatted
- **THEN** the UI does not extend availability, calculate with `parseFloat`, or display a misleading amount.
