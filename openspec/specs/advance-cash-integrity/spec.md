# Advance Cash Integrity Specification

## Purpose

Defines the integrity boundaries for advance-principal reversals, Buyer cash-movement reporting, and manual payment occurrence timestamps so immutable financial facts remain bounded and each real cash movement is reported exactly once.

## Requirements

### Requirement: Advance reversals cannot exceed the original payment

The database SHALL reject any advance-principal reversal whose amount plus all committed reversals for the same original payment exceeds that payment. The guard SHALL execute at the serialized database write boundary and SHALL protect direct or concurrently stale insert attempts independently of the route precheck. Migration SHALL fail closed rather than accept an already over-reversed immutable ledger.

#### Scenario: Two stale reversal decisions target one remaining balance

- **WHEN** one reversal commits and another insert based on the earlier remaining amount would make cumulative reversals exceed the original payment
- **THEN** the database accepts at most the amount still remaining and rejects the excess insert without changing existing immutable entries.

#### Scenario: Existing ledger is already over-reversed

- **WHEN** Migration 0066 encounters an original advance payment whose committed reversals already exceed it
- **THEN** the migration rolls back at Schema 65 and does not claim the stronger integrity baseline.

### Requirement: Internal finance reports every real Buyer cash movement once

The internal-finance cash movement authority SHALL include ordinary Buyer refund payments/reversals and advance-principal payments/reversals at their actual occurrence times. A Buyer refund ledger payment or reversal created only to settle a previously paid advance SHALL NOT create a second cash movement. The cash-flow response and export SHALL expose normal-refund and advance totals separately and SHALL include both in net cash flow.

#### Scenario: Advance later settles a refund obligation

- **WHEN** an advance payment is later mirrored into the Buyer refund ledger during obligation settlement
- **THEN** cash reporting includes the original advance payment once, excludes the settlement mirror, and preserves the normal refund ledger for obligation accounting.

#### Scenario: Advance payment is partially reversed

- **WHEN** an advance payment and a valid partial reversal fall within the selected cash date range
- **THEN** the response reports their outflow and reversal separately and net cash uses their arithmetic difference.

### Requirement: Manual payment occurrence cannot be in the future

Buyer refund and advance-principal manual payment commands SHALL reject `paid_at` later than the server command time before acquiring idempotency or writing business, file, Audit or Outbox facts.

#### Scenario: Staff submits a future payment time

- **WHEN** an otherwise authorized manual Buyer refund or advance payment contains `paid_at` greater than server `now`
- **THEN** the command returns validation failure and leaves no idempotency or financial fact.
