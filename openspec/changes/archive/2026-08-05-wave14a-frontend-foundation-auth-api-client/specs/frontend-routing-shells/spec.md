# Frontend Routing and Shells Capability

## ADDED Requirements

> Controller amendment: root is a 月光白 dedicated-link notice only; it contains no identity selector, login form, or identity link. Direct identity login routes remain public.

### Requirement: Public routing preserves dedicated-link semantics

React Router SHALL own `/`, `/buyer/login`, `/seller/login`, and `/staff/login`. The root SHALL show only `月光白` and `请使用工作人员发送的专属链接登录。`; it SHALL NOT show Buyer, Seller, or Staff login controls or identity links. All three login routes SHALL remain directly reachable. Hidden navigation SHALL NOT be represented as a security control.

#### Scenario: Root entry

- **WHEN** an unauthenticated user opens `/`
- **THEN** the page shows `月光白` and the dedicated-link notice without any identity control or link.

#### Scenario: Direct Staff or unknown public route

- **WHEN** a user directly opens `/staff/login` or an unknown public path
- **THEN** Staff login remains reachable and the unknown path renders a safe NotFound rather than redirecting across identities.

### Requirement: Protected routes wait for matching Session resolution

Each `/buyer/**`, `/seller/**`, and `/staff/**` protected tree SHALL use only its identity Session guard and SHALL render no protected data during UNKNOWN or LOADING. Unauthenticated navigation SHALL preserve only an allowlisted relative return route inside the same identity tree.

#### Scenario: Authenticated matching route

- **WHEN** the matching identity Session reaches AUTHENTICATED
- **THEN** the route shell and route content render with that identity's query domain.

#### Scenario: Loading, mismatch, or unsafe return

- **WHEN** Session is unresolved, Customer account type mismatches, or a return path is absolute/cross-identity
- **THEN** protected data remains hidden and the route shows loading or same-domain login with an unsafe return discarded.

### Requirement: Buyer shell is mobile-first with fixed five-item navigation

The Buyer shell SHALL prioritize current stage, next action, and deadline, SHALL have no persistent desktop sidebar, and SHALL expose bottom navigation in exactly this order: 首页、任务、订单资料、评论、我的. Fixed navigation SHALL not obscure content and SHALL remain usable at 320px and 200% zoom.

#### Scenario: Buyer shell at mobile width

- **WHEN** an authenticated Buyer opens a Buyer foundation route at 320px
- **THEN** one focused content column and all five keyboard-operable bottom items remain visible without covering the page end.

#### Scenario: Navigation overflow or extra primary action

- **WHEN** translated/zoomed content would overlap the fixed navigation or a view introduces multiple competing primary actions
- **THEN** responsive layout/review fails until content remains reachable and the next-action hierarchy is restored.

### Requirement: Seller shell preserves list context through a right detail drawer

The Seller shell SHALL provide desktop left navigation, organization/store context, page title/action, metrics, search/filter region, and formal table container. Row selection SHALL open a right-side detail drawer and SHALL preserve validated filters, pagination, selection, scroll, and focus. Small screens SHALL use accessible cards or a detail route fallback.

#### Scenario: Open and close Seller detail

- **WHEN** a Seller selects a row and later closes the right drawer
- **THEN** the prior filter/page/scroll state remains and focus returns to the invoking row/control.

#### Scenario: Insufficient viewport

- **WHEN** table plus drawer cannot remain readable at the current width or zoom
- **THEN** the UI switches to the documented card/detail fallback without hiding essential fields or trapping focus.

### Requirement: Staff shell supports a contextual three-pane workbench

The Staff shell SHALL use left queue, center detail, and right review-action panes on sufficient widths, SHALL retain queue filter/position while processing records, and SHALL structurally distinguish internal from customer-visible content and financial from ordinary actions. It SHALL not model the workbench as an undifferentiated card grid.

#### Scenario: Desktop Staff workflow

- **WHEN** authenticated Staff selects and processes a queue item
- **THEN** queue context remains stable while detail and action panes update with logical landmarks and focus order.

#### Scenario: Narrow Staff workflow

- **WHEN** width or 200% zoom cannot support three readable panes
- **THEN** the flow degrades to queue → detail → review drawer with back/focus restoration and no loss of selected context.

### Requirement: Route errors and not-found states retain identity semantics

Every route tree SHALL provide LoadingState, ErrorState, PermissionDenied, NotFound, DependencyUnavailable, and RequestIdDisplay where applicable. HTTP 403 and 404 SHALL retain the authenticated shell and SHALL NOT trigger logout; dependency failure SHALL offer bounded retry without claiming unauthenticated state.

#### Scenario: Permission or concealed resource failure

- **WHEN** a protected request returns 403 or 404
- **THEN** the matching shell renders PermissionDenied or NotFound and keeps the Session authenticated.

#### Scenario: Dependency or route failure

- **WHEN** Session/data resolution fails from network, 503, or route-render failure
- **THEN** a sanitized identity-scoped recovery state displays request ID when available and does not reveal stale protected content.
