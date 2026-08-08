# Product Reservation Order Scheduling Requirements

## ADDED Requirements

### Requirement: Product versions carry a simple default cadence
Each configured product version SHALL store positive integer `order_interval_days` and `orders_per_run` values, displayed to Staff as “每隔 N 个自然日、每次 M 单”.

#### Scenario: Seller operations changes a product default
- **WHEN** an authorized seller_ops Staff adds a new product version with a different valid cadence
- **THEN** the prior version remains immutable and only later demand publications use the new default automatically.

### Requirement: Each demand freezes its own first date and cadence
Publishing a demand with scheduling enabled SHALL require an `Asia/Shanghai` first-order date and SHALL copy the selected product version cadence into an independently versioned demand schedule.

#### Scenario: Assigned seller operations publishes from the Staff work item
- **WHEN** an assigned seller_ops with effective PRODUCT_REVIEW and DEMAND_PUBLISH opens a DEMAND_REVIEW work item, reads the authoritative demand review context and submits PUBLISH
- **THEN** the request carries that demand version as `expected_version`, a Beijing `first_order_date` and an Idempotency-Key, and the server locks the selected product-version cadence.

#### Scenario: Assigned seller operations rejects a demand
- **WHEN** an assigned owner or seller_ops with effective DEMAND_PUBLISH submits REJECT with a reason and the authoritative demand version, even without PRODUCT_REVIEW
- **THEN** the existing demand review command rejects the demand without creating a schedule version.

#### Scenario: Review actions do not inherit cadence-write permissions
- **WHEN** seller_ops has only PRODUCT_REVIEW and rejects a product application, or has only DEMAND_PUBLISH and rejects or closes a demand
- **THEN** the action succeeds within assignment and authoritative Seller Scope, while product APPROVE and demand PUBLISH still require both permissions.

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

#### Scenario: Ambiguous response is retried as the same confirmation
- **WHEN** a product-version or schedule-confirm request may have reached the server but its response is lost
- **THEN** the unchanged primary button, Enter activation and “重试原请求” all use the exact retained action, path, body and Idempotency-Key; mutation inputs are disabled while the request is in flight, success or deterministic 4xx releases it, and changed input or a newly submitted preview creates a new key.

### Requirement: Staff visibility follows duty and data scope
Active owner and seller_ops SHALL maintain product cadence or demand schedules only while both PRODUCT_REVIEW and DEMAND_PUBLISH are effective and the relevant Seller Scope/assignment permits the resource; authorized pre_sales SHALL read ranking and dates within scope; buyer_refund SHALL not modify schedules, and Buyer identity fields SHALL remain minimized outside authorized Buyer Scope.

The double-permission rule SHALL apply only to writes that create or change cadence/schedule facts; product-application rejection remains a PRODUCT_REVIEW action and demand rejection/closure remains a DEMAND_PUBLISH action.

#### Scenario: Stale work-item organization metadata cannot grant resource scope
- **WHEN** a work item's seller organization differs from the authoritative product application or demand source organization
- **THEN** a non-global reviewer receives NOT_FOUND with no business write or work-item completion, while an authorized owner with GLOBAL scope can proceed against the authoritative source.

#### Scenario: Pre-sales opens reservation details
- **WHEN** pre_sales has PRODUCT_VIEW and the relevant Buyer/Customer Scope
- **THEN** the page returns stable ranks, reservation times, planned dates and permitted Buyer identifiers without refund, profit or unrelated-customer data.

#### Scenario: An unauthorized role calls the edit command
- **WHEN** buyer_refund or pre_sales has even been personally granted both permissions, or seller_ops lacks either permission, or Buyer/Seller submits a cadence or schedule write
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
