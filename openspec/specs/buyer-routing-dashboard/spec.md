# buyer-routing-dashboard Specification

## Purpose
TBD - created by archiving change module1-buyer-complete-business-loop. Update Purpose after archive.
## Requirements
### Requirement: Dedicated Buyer entry routing
The Web application SHALL keep `/` as the exact dedicated-link notice, expose `/buyer/login` for existing Buyers and `/buyer/register` only as a direct staff-supplied link, and protect every `/buyer/**` business route with the existing Buyer Customer Session boundary. The login page SHALL NOT advertise registration or any Seller or Staff entry.

#### Scenario: Existing or new Buyer uses the supplied route
- **WHEN** an existing Buyer opens `/buyer/login` or a new Buyer opens the directly supplied `/buyer/register`
- **THEN** the matching flow is shown without exposing another identity entry.

#### Scenario: Root or login is inspected for discovery links
- **WHEN** an unauthenticated visitor opens `/` or `/buyer/login`
- **THEN** no registration, Seller, or Staff link is present and the root still shows only `月光白` and `请使用工作人员发给您的专属链接登录。`.

### Requirement: Buyer route tree separates business journeys
The Buyer route tree SHALL provide the current `/buyer/products`, `/buyer/tasks`, `/buyer/me`, demand, reservation, order-material, formal-order, review, and refund journeys. `/buyer` SHALL enter `/buyer/products`; the product journey SHALL not be represented as a legacy Dashboard. Existing detail and mutation routes remain authoritative business implementation paths.

#### Scenario: Buyer deep-links to a detail or new form
- **WHEN** an authenticated Buyer opens `/buyer` or a valid current detail or form URL
- **THEN** `/buyer` enters `/buyer/products`, the current owning journey loads inside the Buyer shell, and the old Dashboard page is not restored.

#### Scenario: Buyer opens an unknown, invalid, stale, or concealed source
- **WHEN** a Buyer route is unknown or a current detail/form source is invalid, stale, or concealed
- **THEN** the Buyer shell retains its identity boundary and shows the existing safe owning-list or NotFound behavior without exposing another customer's resource.

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

### Requirement: Buyer query and mutation cache boundaries
Every Buyer business request SHALL use `identityApiRequest('buyer', ...)`, every business Query key SHALL start with `buyer`, and successful mutations SHALL invalidate only keys whose server facts can have changed. Sensitive Buyer queries and file bytes SHALL not be persisted.

#### Scenario: Buyer mutation succeeds
- **WHEN** registration returns 201, or reservation, evidence, review, or logout mutation succeeds
- **THEN** registration first cancels/clears both Buyer and Seller Customer roots and rereads a BUYER Session while preserving Staff; other mutations affect only their documented keys.

#### Scenario: Mutation or Customer Session fails
- **WHEN** a mutation conflicts or a protected request returns 403/404
- **THEN** there is no automatic mutation retry or session teardown; only a validated 401 uses the existing shared Buyer/Seller Customer transport invalidation group.
