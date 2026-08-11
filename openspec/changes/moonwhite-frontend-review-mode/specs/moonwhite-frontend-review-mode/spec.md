# Moonwhite Frontend Review Mode

## ADDED Requirements

### Requirement: Review renders the real identity frontends

The web application MUST expose `/review`, `/review/buyer`, `/review/seller`, and `/review/staff` without login. Buyer Review MUST render the existing BuyerFrame and three-item 产品、任务、我的 navigation. Seller Review MUST render the existing SellerLayout and current full Seller navigation. Staff Review MUST render the existing StaffShell and current role/capability navigation. Review MUST NOT copy or recreate identity pages.

#### Scenario: reviewer enters an identity

- **WHEN** the reviewer chooses Buyer, Seller, or Staff from `/review`
- **THEN** the matching existing Layout, route modules, pages, components, CSS, dialogs, tables, cards, forms, status UI, pagination, errors, empty states, and responsive rules render under `/review/<identity>`.

#### Scenario: real page navigates to a detail

- **WHEN** a Review link, row, back control, bottom navigation item, or dialog navigates using an existing `/buyer`, `/seller`, or `/staff` path
- **THEN** the browser remains inside the matching `/review` basename and never enters a formal identity route.

### Requirement: Review data and identity are Demo-only

Every Review identity MUST consume runtime-schema-valid Demo Session, me/access, capability, business, and file DTOs. Buyer MUST cover the current product and lifecycle surfaces; Seller MUST cover two switchable stores and OWNER, OPERATIONS, FINANCE, VIEWER; Staff MUST cover owner, acquisition, pre_sales, seller_ops, buyer_refund with current navigation and data-scope logic.

#### Scenario: Seller or Staff role changes

- **WHEN** the reviewer changes a Seller or Staff role
- **THEN** the existing identity and permission/capability conditions recompute from the selected Demo DTO, Query caches do not cross roles, and no item is hidden only through Review CSS.

#### Scenario: representative local operation succeeds

- **WHEN** the reviewer uses an existing supported submit, withdraw, confirm, resubmit, invite, or policy control
- **THEN** only in-memory Demo state changes, existing success/recovery UI runs, and refresh may restore the initial fixture.

### Requirement: Review fails closed before real transport

While the browser path is `/review` or begins `/review/`, every application API operation MUST be resolved by an explicit Demo handler before native fetch. Unknown or omitted Review API operations MUST fail with `REVIEW_MODE_REAL_API_BLOCKED`. Review MUST send zero GET, POST, PUT, PATCH, or DELETE requests to `/api/*` and MUST perform zero D1 or R2 writes.

#### Scenario: handled Review request

- **WHEN** a real page requests a registered Demo API endpoint
- **THEN** the Demo adapter returns data validated by the endpoint's existing Zod schema without invoking fetch.

#### Scenario: missing Review handler

- **WHEN** a Review page attempts an unregistered `/api/*` request or method
- **THEN** the operation terminates as `REVIEW_MODE_REAL_API_BLOCKED`, automated tests fail the missing coverage, and the request is not forwarded.

### Requirement: Review is unmistakable and non-authoritative

Every `/review/*` page MUST continuously display a compact `前端评审 · Demo 数据` marker. `/review` MUST display `月光白 V2 · 前端评审环境`, state that Demo data cannot modify formal business data, provide the three identity entries, and show the exact deployed build SHA.

#### Scenario: reviewer opens or captures any Review page

- **WHEN** Review content is visible at a supported viewport
- **THEN** the Demo marker remains visible without obscuring Buyer bottom navigation, Seller desktop layout, Staff panes, dialogs, or primary actions.

### Requirement: formal routes and infrastructure are unchanged

Formal `/buyer/**` and `/seller/**` MUST retain Customer Auth. Formal `/staff/**` and `/api/staff/*` MUST retain Staff Session and Cloudflare Access protection. The Change MUST add no migration, D1/R2 mutation, Access bypass, secret, domain, second Worker, or production-data fixture.

#### Scenario: formal route is opened

- **WHEN** an unauthenticated browser opens formal `/buyer`, `/seller`, or `/staff`
- **THEN** the existing identity authentication behavior runs and no Demo identity or data appears.

#### Scenario: Review is deployed or rolled back

- **WHEN** the existing production Worker/Web Assets are deployed or reverted
- **THEN** Schema remains 64, no migration executes, no D1/R2/Access resource is created or modified, and rollback needs no business-data compensation.

### Requirement: Review is responsive and automatically verified

Review MUST have no document-level horizontal overflow at Buyer 390x844 and 430x932, tablet 768x1024 and 1024x1366, and Seller/Staff desktop 1280x720, 1366x768, 1440x900, and 1920x1080. Seller MUST remain a desktop workspace at 1280-1440 widths; Staff MUST preserve usable workbench panes. Automated tests MUST prove route availability, navigation/role differences, formal-route isolation, no real Staff Session read, and zero Review API network traffic.

#### Scenario: required viewport is exercised

- **WHEN** the Review route is loaded and primary surfaces are opened at each required viewport
- **THEN** controls, tables, cards, dialogs, sidebars, sticky elements, and Buyer bottom navigation remain reachable without page-level horizontal overflow or accidental Seller mobile layout.
