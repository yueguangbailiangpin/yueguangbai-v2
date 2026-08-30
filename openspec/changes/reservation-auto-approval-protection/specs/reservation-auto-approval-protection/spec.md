# Reservation Auto-Approval Protection

## Purpose

Prevent automatic reservation approval from bypassing buyer-level formal-order operational responsibility while preserving manual review and existing reservation rules.

## ADDED Requirements

### Requirement: automatic approval uses global formal-order overdue responsibility

Before any automatic approval state, capacity, instruction, audit, or work-item completion side effect, the server MUST read the buyer's formal orders across all seller organizations through the existing formal-order responsibility projection. A formal order SHALL block automatic approval only when the shared responsibility model reports `stage` as `BUYER_REFUND` or `SELLER_SETTLEMENT` and `is_overdue=true`. Orders without an authoritative responsibility deadline, pending order-material submissions, and non-formal records SHALL not be included.

#### Scenario: overdue formal order in another seller organization blocks automatic approval

- **WHEN** a buyer submits an otherwise qualifying reservation for seller organization B while a formal order for the same buyer in seller organization A is in `BUYER_REFUND` or `SELLER_SETTLEMENT` with `is_overdue=true`
- **THEN** the reservation remains `PENDING_REVIEW`, its hold and open review work item remain effective, and no approval, approved-count increment, instruction publication, or completion side effect occurs

#### Scenario: resolved or non-authoritative records do not create overdue protection

- **WHEN** the buyer's prior formal orders are fully resolved/completed, have no authoritative deadline, or the only prior record is pending order material rather than a formal order
- **THEN** the overdue condition is clear and an otherwise qualifying reservation remains eligible for automatic approval

### Requirement: unresolved formal-order operational risk is global and resolves by current event state

Before automatic approval side effects, the server MUST treat any formal order for the buyer in any seller organization as a manual-review risk when its current unresolved operational event is `PLATFORM_CANCELLED`, `RETURN_REFUND`, `BUSINESS_VOID`, or `MANUAL_INVESTIGATION`. A latest `RESOLVED` event MUST clear that order's risk. The server MUST NOT use `internal_finance_exceptions` as this buyer-level risk marker.

#### Scenario: open operational exception in another seller organization blocks automatic approval

- **WHEN** a buyer submits an otherwise qualifying reservation and a formal order in another seller organization has one of the specified operational events as its current unresolved event
- **THEN** the reservation remains `PENDING_REVIEW` with its hold and review work item unchanged, and automatic approval produces no approval side effects

#### Scenario: resolving the operational exception restores automatic eligibility

- **WHEN** a `RESOLVED` event is later recorded as the current event for the buyer's prior formal order and no other global protection remains
- **THEN** a subsequent otherwise qualifying reservation may be automatically approved under the existing rules

### Requirement: internal reason codes are stable and buyer-safe

The automatic approval decision MUST expose stable internal reason codes `OVERDUE_FORMAL_ORDER_REQUIRES_MANUAL_REVIEW` and `OPEN_FORMAL_ORDER_RISK_REQUIRES_MANUAL_REVIEW`. When both conditions exist, the overdue code MUST win deterministically. The buyer reservation response MUST retain its existing waiting-for-manual-review shape and MUST NOT expose either code, exception type, formal-order identifier, seller organization, overdue detail, or internal risk text.

#### Scenario: both protections use deterministic priority

- **WHEN** the buyer has both an overdue formal-order responsibility and an unresolved specified operational risk
- **THEN** the internal automatic-review result uses the overdue reason code, while the Buyer response contains only the existing safe `PENDING_REVIEW` result fields

### Requirement: only automatic approval is protected

The protection conditions MUST prevent only the automatic approval attempt. A reservation MUST NOT be auto-rejected, and an authorized Staff `RESERVATION_DECIDE` approval MUST remain executable with the existing permission, assignment, expected-version, state-machine, capacity, audit, transaction-assertion, and work-item behavior.

#### Scenario: Staff manually approves a protected reservation

- **WHEN** automatic approval leaves a reservation pending because a global formal-order protection is present and an authorized Staff approves it with the current expected version
- **THEN** the existing manual approval command succeeds and applies exactly its normal approval-side effects

### Requirement: existing idempotency and concurrency guarantees remain intact

Automatic-review protection MUST be read-only before approval mutation statements and MUST not release a hold, increment approved capacity, publish duplicate instructions, or complete a review work item. Existing same-key submission replay, automatic-approval retry/concurrency, and manual continuation MUST preserve one set of facts and stable conflicts.

#### Scenario: same-key submission is replayed without duplicate reservation facts

- **WHEN** the same Buyer submits the same reservation command again with the same idempotency key after an automatic-review protection decision
- **THEN** the original safe response is replayed and reservation, hold, work-item, and audit counts are not duplicated
