# Buyer Routing and Dashboard Capability

## ADDED Requirements

### Requirement: Dedicated Buyer entry routing
The Web application SHALL keep `/` as the exact dedicated-link notice, expose `/buyer/login` for existing Buyers and `/buyer/register` only as a direct staff-supplied link, and protect every `/buyer/**` business route with the existing Buyer Customer Session boundary. The login page SHALL NOT advertise registration or any Seller or Staff entry.

#### Scenario: Existing or new Buyer uses the supplied route
- **WHEN** an existing Buyer opens `/buyer/login` or a new Buyer opens the directly supplied `/buyer/register`
- **THEN** the matching flow is shown without exposing another identity entry.

#### Scenario: Root or login is inspected for discovery links
- **WHEN** an unauthenticated visitor opens `/` or `/buyer/login`
- **THEN** no registration, Seller, or Staff link is present and the root still shows only `月光白` and `请使用工作人员发送的专属链接登录。`.

### Requirement: Buyer route tree separates business journeys
The Buyer route tree SHALL provide separate list, detail, and form routes for dashboard, tasks/demands, reservations, order materials, formal orders, reviews, refunds, and account information. Unknown Buyer routes SHALL render a safe in-shell NotFound and SHALL NOT redirect to another identity.

#### Scenario: Buyer deep-links to a detail
- **WHEN** an authenticated Buyer opens a valid reservation, evidence, formal-order, review, or refund detail URL
- **THEN** the matching detail journey loads inside the Buyer shell and preserves direct-link refresh behavior.

#### Scenario: Buyer opens an unknown or concealed detail
- **WHEN** a Buyer route is unknown or its API returns concealed 404
- **THEN** the Buyer shell remains authenticated and shows a safe NotFound without disclosing another customer's resource.

### Requirement: Fixed five-item Buyer navigation
The bottom navigation SHALL contain exactly 首页、任务、订单资料、评论、我的 in that order. Formal orders and refunds SHALL be reachable from contextual links, especially 我的, without adding a sixth bottom item.

#### Scenario: Buyer moves between primary areas
- **WHEN** a Buyer activates any bottom navigation item
- **THEN** the matching area becomes current and the five names and order remain unchanged.

#### Scenario: Nested route is current
- **WHEN** a Buyer opens a nested reservation, formal-order, review, or refund route
- **THEN** the semantically owning bottom item remains current without duplicating navigation items.

### Requirement: Dashboard is a bounded next-step workbench
The dashboard SHALL present actionable or informational next steps in this priority: order evidence CHANGES_REQUESTED; review CHANGES_REQUESTED; soonest ACTIVE instruction; approved reservation without initial evidence; confirmed formal order without a submitted review; pending evidence and review; refund change or unpaid balance; newly reservable demand. It SHALL derive only from returned DTO status, `allowed_actions`, deadlines, and server facts.

#### Scenario: Multiple returned tasks compete
- **WHEN** the first loaded pages contain tasks from several priority groups
- **THEN** the dashboard de-duplicates each business object and orders items by group priority then earliest relevant deadline.

#### Scenario: Pagination prevents completeness
- **WHEN** a source has `next_cursor` or an instruction would require unbounded per-reservation reads
- **THEN** the dashboard shows only a bounded preview with 查看全部 and does not claim a complete count or fabricate missing tasks.

### Requirement: Dashboard sources fail independently
Dashboard source queries SHALL use separate Buyer-rooted Query keys and render successful sections even when another source fails. A source failure SHALL carry its safe request ID and a source-specific retry without converting valid empty data into an error.

#### Scenario: All required preview sources succeed
- **WHEN** the dashboard preview queries resolve with valid DTOs
- **THEN** the workbench combines their bounded items while retaining source ownership for links and invalidation.

#### Scenario: One source fails
- **WHEN** one source returns network, dependency, contract, 403, or 404 failure
- **THEN** other successful sources remain visible and the failed source shows a sanitized recovery state without logging out except for a real 401.

### Requirement: Buyer query and mutation cache boundaries
Every Buyer business request SHALL use `identityApiRequest('buyer', ...)`, every business Query key SHALL start with `buyer`, and successful mutations SHALL invalidate only keys whose server facts can have changed. Sensitive Buyer queries and file bytes SHALL not be persisted.

#### Scenario: Buyer mutation succeeds
- **WHEN** registration/session establishment, reservation, evidence, review, or logout mutation succeeds
- **THEN** only the documented Buyer queries are set, removed, or invalidated and Staff cache remains untouched.

#### Scenario: Mutation or Customer Session fails
- **WHEN** a mutation conflicts or a protected request returns 403/404
- **THEN** there is no automatic mutation retry or session teardown; only a validated 401 uses the existing shared Buyer/Seller Customer transport invalidation group.
