# Product Reservation Order Scheduling Requirements

## ADDED Requirements

### Requirement: Product versions carry a simple default cadence
Each configured product version SHALL store positive integer `order_interval_days` and `orders_per_run` values, displayed to Staff as “每隔 N 个自然日、每次 M 单”.

#### Scenario: Seller operations changes a product default
- **WHEN** an authorized seller_ops Staff adds a new product version with a different valid cadence
- **THEN** the prior version remains immutable and only later demand publications use the new default automatically.

### Requirement: Each demand freezes its own first date and cadence
Publishing a demand with scheduling enabled SHALL require an `Asia/Shanghai` first-order date and SHALL copy the selected product version cadence into an independently versioned demand schedule.

#### Scenario: Product default changes after demand publication
- **WHEN** the product receives a later version with a new default cadence
- **THEN** the published demand keeps its existing schedule until an authorized demand-specific schedule change is confirmed.

### Requirement: Scheduling counts every calendar day
Planned order dates SHALL advance by consecutive `Asia/Shanghai` calendar days and SHALL include Saturdays, Sundays and public holidays without consulting a workday calendar.

#### Scenario: A run crosses a weekend or holiday
- **WHEN** the interval lands on a Saturday, Sunday or public-holiday date
- **THEN** that date remains a valid planned order date and is not moved.

### Requirement: Reservation rank is deterministic
The effective queue SHALL contain PENDING_REVIEW and APPROVED reservations ordered by `submitted_at ASC, id ASC`; REJECTED, CANCELLED and EXPIRED reservations SHALL remain historical but not occupy a current rank.

#### Scenario: Reservations share a timestamp
- **WHEN** two effective reservations have the same `submitted_at`
- **THEN** ascending immutable reservation ID determines their stable relative order on every page and replay.

#### Scenario: A reservation leaves the effective queue
- **WHEN** a reservation becomes REJECTED, CANCELLED or EXPIRED
- **THEN** later effective reservations move forward deterministically while the removed reservation and event history remain auditable.

### Requirement: Planned dates follow the frozen formula
For one-based rank `r`, interval `N` and per-run quantity `M`, the server SHALL calculate `run_index=floor((r-1)/M)` and `planned_order_date=first_order_date + run_index*N calendar days`.

#### Scenario: Confirmed examples are calculated
- **WHEN** a queue is scheduled as 1 day/1 order, 1 day/2 orders or 2 days/1 order
- **THEN** ranks map respectively to consecutive dates, pairs on each date, or every-other-day dates from the first-order date.

### Requirement: Capacity fits the order window
The server SHALL reject publication or schedule change when the last theoretical `target_quantity` slot would fall after the demand order deadline.

#### Scenario: Twenty slots cannot fit
- **WHEN** first date, interval and per-run quantity place rank 20 after the order deadline
- **THEN** no schedule version is committed and a stable conflict asks Staff to change the date, cadence or deadline.

### Requirement: Current-demand changes are controlled
An authorized owner or seller_ops SHALL change a published demand schedule only through a server preview followed by an idempotent, version-checked confirmation bound to the preview hash and a reason.

#### Scenario: Staff confirms a changed cadence
- **WHEN** the demand version and preview hash still match
- **THEN** a new schedule version becomes current and the prior schedule, affected count, actor, reason and before/after dates remain auditable.

#### Scenario: Queue changes after preview
- **WHEN** a reservation or schedule fact changes before confirmation
- **THEN** confirmation fails with a stable conflict and does not apply a stale preview.

### Requirement: Staff visibility follows duty and data scope
Active owner and authorized seller_ops SHALL maintain schedules; authorized pre_sales SHALL read ranking and dates within scope; buyer_refund SHALL not modify schedules, and Buyer identity fields SHALL remain minimized outside authorized Buyer Scope.

#### Scenario: Pre-sales opens reservation details
- **WHEN** pre_sales has PRODUCT_VIEW and the relevant Buyer/Customer Scope
- **THEN** the page returns stable ranks, reservation times, planned dates and permitted Buyer identifiers without refund, profit or unrelated-customer data.

#### Scenario: An unauthorized role calls the edit command
- **WHEN** buyer_refund, Buyer, Seller or a Staff lacking effective edit permission submits a schedule change
- **THEN** the backend denies it without changing schedule, product, demand, reservation or audit facts.

### Requirement: Estimated and actual order facts stay separate
Schedule calculation SHALL NOT create or modify order evidence, Amazon order dates, formal orders or financial snapshots, and Buyer/Seller DTOs SHALL NOT expose the internal queue or planned dates.

#### Scenario: A Buyer submits order evidence
- **WHEN** a scheduled reservation gains an actual order-evidence or formal-order fact
- **THEN** Staff UI distinguishes actual status/date from the plan and no recalculation overwrites the actual fact.

### Requirement: Legacy rows and migration are recoverable
Legacy product versions and demands without schedule facts SHALL remain valid historical data, SHALL display schedule-unconfigured rather than invented dates, and SHALL survive tested upgrade, restore and forward recovery.

#### Scenario: An old demand is opened after migration
- **WHEN** it has no approved schedule version
- **THEN** Staff sees “尚未配置排期” and must use the controlled schedule command before planned dates are shown.
