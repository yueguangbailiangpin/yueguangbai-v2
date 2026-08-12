# Buyer routing and task-center alignment

## REMOVED Requirements

### Requirement: Fixed five-item Buyer navigation

The archived five-item navigation requirement is no longer current canonical product behavior.

### Requirement: Dashboard is a bounded next-step workbench

The archived Dashboard priority-ranking requirement is removed from the current product requirement set. Retained legacy Dashboard files are evidence/compatibility material only.

### Requirement: Dashboard sources fail independently

The archived Dashboard-specific wording is replaced by the current task-center source boundary below.

## MODIFIED Requirements

### Requirement: Buyer route tree separates business journeys

The Buyer route tree SHALL provide the current `/buyer/products`, `/buyer/tasks`, `/buyer/me`, demand, reservation, order-material, formal-order, review, and refund journeys. `/buyer` SHALL enter `/buyer/products`; the product journey SHALL not be represented as a legacy Dashboard. Existing detail and mutation routes remain authoritative business implementation paths.

#### Scenario: Buyer deep-links to a detail or new form

- **WHEN** an authenticated Buyer opens `/buyer` or a valid current detail or form URL
- **THEN** `/buyer` enters `/buyer/products`, the current owning journey loads inside the Buyer shell, and the old Dashboard page is not restored.

#### Scenario: Buyer opens an unknown, invalid, stale, or concealed source

- **WHEN** a Buyer route is unknown or a current detail/form source is invalid, stale, or concealed
- **THEN** the Buyer shell retains its identity boundary and shows the existing safe owning-list or NotFound behavior without exposing another customer's resource.

## ADDED Requirements

### Requirement: Buyer primary navigation is exactly three items

The Buyer primary navigation SHALL contain exactly `产品`, `任务`, and `我的`, in that order. `产品` SHALL represent currently reservable products for the current Buyer; `任务` SHALL represent the task center; `我的` SHALL represent the business center. Formal orders, reviews, refunds, and reservation details remain reachable through contextual routes and task/business-center links.

#### Scenario: Buyer uses primary navigation

- **WHEN** a Buyer activates a primary navigation item
- **THEN** exactly one of `产品`, `任务`, or `我的` becomes current and no legacy Dashboard or extra primary item is introduced.

#### Scenario: Nested route keeps semantic ownership

- **WHEN** a Buyer opens a demand, reservation, order-material, formal-order, review, or refund route
- **THEN** the owning current primary item remains selected without duplicating navigation items.

### Requirement: Buyer task center distinguishes actionable and system-processing work

The Buyer task center SHALL aggregate current reservation, order-evidence, review, and refund API evidence. Work requiring the Buyer本人 to act SHALL be classified as actionable. Approval, verification, or refund processing states SHALL be classified as system-processing and SHALL NOT increase the actionable count. The task center SHALL not require the old `rankBuyerTasks` deadline/global-deduplication model as a product requirement.

#### Scenario: Actionable and processing facts are returned

- **WHEN** the task sources return Buyer actions and pending system states
- **THEN** actionable items are counted separately, while system-processing items are displayed in a separate processing section without increasing that count.

#### Scenario: One task source fails

- **WHEN** one reservation, evidence, review, or refund source fails
- **THEN** successful sources remain visible with a source-scoped recovery state and no fabricated task or count is shown.
