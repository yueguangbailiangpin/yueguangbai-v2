# Advance Cash Integrity Delta

## ADDED Requirements

### Requirement: Advance V1 uses one server-authoritative full Payment

The Advance Principal Payment amount SHALL equal the formal order immutable financial snapshot `buyer_expected_principal_cny_fen`. The Staff request and editable UI SHALL NOT accept an amount. The server SHALL derive and include the authoritative amount in idempotency, immutable ledger, Audit and response facts. The database SHALL reject a different amount and SHALL permit at most one Payment with a positive outstanding balance per formal order.

#### Scenario: Staff records a full Advance Payment

- **WHEN** an authorized owner or buyer_refund Staff submits valid occurrence, channel, note and verified proof facts before a Buyer Refund obligation exists
- **THEN** the server records exactly the snapshot Buyer expected principal and returns that amount without accepting client amount authority.

#### Scenario: Legacy or malicious client submits an amount

- **WHEN** a Payment request includes `amount_cny_fen`, or a direct insert differs from the immutable snapshot
- **THEN** the command fails before committing Payment, file-link, Audit, Outbox or idempotency-completion facts.

#### Scenario: Two Payments target one order

- **WHEN** a second or concurrently stale Payment insert targets an order whose prior Payment still has a positive outstanding balance
- **THEN** the database accepts at most one outstanding Payment and rejects the other insert.

### Requirement: Advance V1 Reversal is full and server-derived

The Advance Principal Reversal request SHALL accept a reason but no amount. The server SHALL derive the original Payment full amount. The database SHALL reject partial, repeated or otherwise non-full Reversals. After one full Reversal, the order MAY receive one replacement full Payment.

#### Scenario: Staff corrects an erroneous Advance Payment

- **WHEN** an authorized Staff fully reverses an unsettled Advance Payment
- **THEN** one immutable Reversal equal to the original Payment commits and a replacement full Payment may subsequently be recorded.

#### Scenario: Partial or repeated Reversal is attempted

- **WHEN** a request includes an amount, a direct insert is smaller than the original Payment, or another Reversal already exists
- **THEN** the command fails without changing existing immutable ledger or cash facts.

### Requirement: Schema 67 refuses incompatible Advance history

Migration 0067 SHALL fail closed when Schema 66 contains a Payment that differs from its immutable snapshot, a partial/multiple Reversal, or more than one outstanding Payment for an order. It SHALL NOT delete, update or synthesize compensation for immutable history.

#### Scenario: Existing ledger contains partial behavior

- **WHEN** Migration 0067 encounters a partially reversed Payment or other ledger shape incompatible with the full-payment model
- **THEN** the migration rolls back at Schema 66 and requires explicit investigation.

## MODIFIED Requirements

### Requirement: Internal finance reports every real Buyer cash movement once

The internal-finance cash movement authority SHALL include ordinary Buyer refund payments/reversals and advance-principal payments/reversals at their actual occurrence times. A Buyer refund ledger payment or reversal created only to settle a previously paid advance SHALL NOT create a second cash movement. The cash-flow response and export SHALL expose normal-refund and advance totals separately and SHALL include both in net cash flow. Under the V1 full-payment model an Advance Reversal SHALL equal its original Payment.

#### Scenario: Advance later settles a refund obligation

- **WHEN** an advance payment is later mirrored into the Buyer refund ledger during obligation settlement
- **THEN** cash reporting includes the original advance payment once, excludes the settlement mirror, and preserves the normal refund ledger for obligation accounting.

#### Scenario: Advance Payment is fully reversed

- **WHEN** an Advance Payment and its valid full Reversal fall within the selected cash date range
- **THEN** the response reports their outflow and reversal separately and their net cash contribution is zero.

#### Scenario: Advance payment is partially reversed

- **WHEN** a Staff request or direct database insert attempts to reverse less than the original Advance Payment
- **THEN** the operation is rejected and cash reporting remains unchanged because no partial Reversal fact commits.
