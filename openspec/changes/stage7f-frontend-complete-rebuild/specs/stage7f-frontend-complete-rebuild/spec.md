# stage7f-frontend-complete-rebuild Specification

## ADDED Requirements

### Requirement: Review runtime matches the current backend contract

The three-portal review runtime (`/review`, `/review/staff`, `/review/buyer`, `/review/seller`) MUST serve demo responses that parse against the exact strict runtime schemas used by the production pages for every endpoint reachable from review mode, at Schema 36 / 240 endpoints. The review demo adapter MUST NOT use `.passthrough()`, skip parsing, or weaken any strict schema, and MUST NOT render fake success pages in place of real components. All four staff roles (owner, pre_sales, seller_ops, buyer_refund) and all four seller roles (OWNER, OPERATIONS, FINANCE, VIEWER) MUST be able to enter their portals, and the buyer portal MUST load.

#### Scenario: Staff workbench loads with SLA metadata

- **WHEN** the review staff portal is opened by any of the four staff roles
- **THEN** the workbench renders without MALFORMED_RESPONSE, without 面板加载失败, and demo work items carry `sla_due_at`, `is_overdue`, `next_action`, `responsible_role`, and `priority` per the current strict work-item schema.

#### Scenario: Staff order list uses the list contract

- **WHEN** `/api/staff/formal-orders` is called in review mode without the single `amazon_order_number` parameter
- **THEN** the demo adapter returns `{ items, next_cursor }` matching the staff order list page schema (not the detail aggregate), and the single-parameter lookup mode still returns the unified detail aggregate.

#### Scenario: Previously missing endpoints resolve instead of blocking

- **WHEN** review-mode pages request `/api/staff/me/work-items/summary`, `/api/staff/me/work-items/:id`, `/api/staff/finance/orders/:id`, `/api/staff/seller-settlements/:org/{summary,payables,payments}`, `/api/staff/service-channels`, customer onboarding directory/invitation endpoints, or demand reservation schedules
- **THEN** the demo adapter returns schema-valid data instead of `REVIEW_MODE_REAL_API_BLOCKED`.

#### Scenario: Demo data covers normal business states

- **WHEN** any staff or seller review portal loads
- **THEN** list pages show non-zero representative business data (orders, work items, customers, products, refunds, settlement batches) rather than all-zero counters.

### Requirement: Staff portal navigation shows only real capabilities

The staff portal MUST NOT render "规划中" badges, placeholder navigation without a real page, the public pool, task grabbing, the acquisition center, duplicate chat-screenshot entries, the legacy order-integrity page, or duplicate legacy rate-center entries. Comment/evidence handling MUST be reachable from order detail or work items; seller settlement MUST live in the finance workspace; file archiving MUST be triggered from order detail and operational tools; service channels MUST live in system settings; the business dashboard MUST be Owner-only. Visibility decisions MUST be driven by backend session authority values and MUST NOT be loosened client-side.

#### Scenario: No placeholder badges or fake navigation

- **WHEN** any staff role renders the staff shell
- **THEN** no navigation entry displays a 规划中 badge and every navigation entry links to a real page or a redirect to a real page.

#### Scenario: Owner-only entries stay hidden from other roles

- **WHEN** a non-owner staff role renders the staff shell
- **THEN** the business dashboard and service-channel settings entries are not rendered.

### Requirement: Staff core pages follow the frozen design language

Rebuilt staff pages MUST use the layered stylesheet (tokens → base → primitives → staff shell → staff page patterns) with the frozen baseline: `#f8fafd` page background, `#0b57d0` primary, 240–256px sidebar, ~64px top bar, 14px body text, 24–28px page titles, 12–16px card radii, 44–52px table rows, ~40px form controls, light borders and sectioned backgrounds over large shadows, bounded main-content width, primary buttons reserved for important actions. Pages MUST NOT use the AI-template look (many large cards with huge numbers and whitespace) and MUST NOT compress desktop layouts into phone layouts. Order list filters MUST sit in a single toolbar row (or expandable area) with URL-persisted state and a clear-filters action; mobile uses a filter Drawer without horizontal overflow. Order detail MUST show uploader and upload time for screenshots, MUST NOT duplicate title/identity/breadcrumb, and MUST order sections by business hierarchy with finance sections rendered per permission. Customer pages MUST keep buyer and seller customers separate with buyer numbers as the primary identifier and no internal IDs exposed. Finance pages MUST NOT recompute authoritative amounts client-side. List pages MUST use backend keyset pagination.

#### Scenario: Desktop order list toolbar

- **WHEN** the staff order list is viewed at desktop width
- **THEN** search and compact filters (stage, exception, responsible staff, date) sit in one toolbar row with a result count and clear-filters action, and no full-width stacked filter form is present.

#### Scenario: Mobile filter drawer without overflow

- **WHEN** the staff order list is viewed at 390px
- **THEN** filters open in a Drawer, content has no horizontal overflow, and orders render as cards.

#### Scenario: Order detail screenshot provenance

- **WHEN** an order detail page shows payment or communication screenshots
- **THEN** each image displays its uploader and upload time.

### Requirement: Migrated staff legacy code is retired

Once a staff page is migrated to the new foundation, its old component and CSS implementations MUST be deleted (no dual implementations), and staff code MUST NOT reference retired legacy class names; a source guard test MUST enforce this. `global.css` and `design-freeze.css` MUST remain only while buyer/seller pages still depend on them, scoped as a legacy isolation layer, and the `main.tsx` CSS load order and each layer's responsibility MUST be documented in the handoff.

#### Scenario: Source guard blocks legacy class reuse

- **WHEN** staff source code adds a reference to a retired legacy class name
- **THEN** the source guard test fails.

### Requirement: Visual acceptance uses a real browser per page

Each required screenshot MUST be captured from a real browser against the review runtime with assertions before capture: key normal data visible; no error Alert; no loading state; no 服务暂时不可用; no MALFORMED_RESPONSE; images actually decoded where present; no horizontal overflow; no 规划中/public-pool/task-grab/acquisition-center entries. Each screenshot MUST then be individually human-reviewed; neither "screenshot generated" nor "tests passed" MAY substitute for the visual check.

#### Scenario: Screenshot assertions gate capture

- **WHEN** a normal-state screenshot is about to be captured
- **THEN** the capture aborts if any forbidden state (error alert, loading, overflow, placeholder nav) is detected on the page.

## 未来子阶段（7F-2/7F-3/7F-4，本轮不执行）

买家端与卖家端视觉重做、legacy CSS 全量退役将按各自子阶段追加 Requirement。
