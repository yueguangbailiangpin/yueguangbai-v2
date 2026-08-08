# Seller Portal Visual Refresh Requirements

## ADDED Requirements

### Requirement: Every real Seller surface uses one dense contextual visual grammar
Seller login, protected shell, dashboard, product/application, demand, formal-order, review, settlement, account, submission, application-detail, and forced-password surfaces SHALL use `tokens.css`, existing primitives, real routes, and returned Seller DTO facts to form one restrained, high-density business workspace.

#### Scenario: A Seller page is compared with the approved direction
- **WHEN** its deterministic mobile and desktop screenshots are reviewed beside the approved Seller direction
- **THEN** the implementation shows clear organization/store context, restrained Seller-green accent, efficient desktop navigation/content density, compact mobile reflow, and a clear action hierarchy without copying unsupported fields or controls.

#### Scenario: The reference depicts unsupported content
- **WHEN** the direction includes a filter, image, schedule, count, amount, status, date, action, permission, user control, or Marketplace fact absent from existing Seller behavior and DTOs
- **THEN** the implementation omits it and preserves the authoritative Contract/action projection.

### Requirement: Seller navigation and business context remain explicit
The protected Seller shell SHALL preserve all seven existing routes, route-aware navigation, returned organization/member context, and authorized Store selection while keeping client selection non-authoritative.

#### Scenario: Seller uses a wide screen
- **WHEN** an authenticated Seller opens any protected business route at 1440px or 1600px
- **THEN** a persistent desktop navigation rail and compact context bar expose the current route, organization, member, and authorized Store/Marketplace context without obscuring the page content.

#### Scenario: Seller uses a narrow screen or all-Store scope
- **WHEN** the viewport is 320px/390px or the Seller selects 全部授权店铺
- **THEN** all real routes and the exact all-authorized-store query scope remain reachable, context reflows without document overflow, and the browser does not treat the selected value as authorization.

### Requirement: Existing Seller submissions are clear primary entries
The portal SHALL expose `提交产品申请` and `提交需求` only when the existing Seller access projection permits them and SHALL make `提交需求` the dominant business entry where authorized without changing either workflow.

#### Scenario: OWNER or OPERATOR has both submission permissions
- **WHEN** the dashboard or relevant list renders with both existing access flags true
- **THEN** `提交需求` is the clear primary entry, `提交产品申请` remains discoverable, and each opens its existing separate form/route.

#### Scenario: Backend access projection denies an action
- **WHEN** either existing access flag is false
- **THEN** the associated entry is absent and direct route/API access continues to fail according to existing server authority.

### Requirement: Seller records preserve server facts and action authority
Product/application, demand, review, formal-order, and application-detail presentation SHALL use only returned Store, product, identifier, quantity, task, status, reason, time, amount, snapshot, evidence-summary, completion, and allowed-action facts, and SHALL preserve exact existing mutations.

#### Scenario: Dense record surfaces render on desktop and mobile
- **WHEN** Contract-valid collections contain several records
- **THEN** desktop presents scan-efficient labeled rows/tables, mobile presents the same facts/actions in logical labeled cards, and neither layout hides a required fact or invents a filter/action.

#### Scenario: Seller withdraws an application or demand
- **WHEN** the existing status/access projection permits withdrawal
- **THEN** the action remains subordinate, confirmed, version-bound, idempotent, and recovery-safe with its exact existing request body.

#### Scenario: Seller views formal-order completion or review evidence summary
- **WHEN** returned order/review facts render
- **THEN** four-component completion and Seller-safe evidence summary remain server-derived/read-only and no Buyer identity, Buyer refund amount/proof, Staff data, storage authority, or internal profit appears.

### Requirement: Seller finance stays separate, precise, and read-only
Seller settlement SHALL retain Seller principal and Seller service fee as independent CNY-fen facts and statuses, SHALL show returned due/paid/outstanding/summary values with integer-safe formatting, and SHALL provide no Seller proof, export, payment, confirmation, or overwrite action.

#### Scenario: Principal and service fee differ
- **WHEN** the returned principal and service-fee balances/statuses are not equal
- **THEN** the page displays both independently using the required names 卖家本金 and 卖家服务费 and does not combine them into one authoritative balance or status.

#### Scenario: Internal financial detail is absent
- **WHEN** settlement DTOs and DOM are inspected
- **THEN** Buyer Refund cost/proof, internal profit/cash flow/anomaly, Staff notes, object keys, Drive identifiers, permanent URLs, and internal export permission are absent rather than visually hidden.

### Requirement: Seller forms, login, account, and forced password remain exact
Seller submission forms, path-bound login, account, and forced-password flow SHALL adopt the Seller visual grammar while preserving their exact fields, native controls, upload/recovery behavior, controller state, safe errors, request IDs, mismatch cleanup, Customer-root invalidation, and Session reread.

#### Scenario: Seller submits a product application or demand
- **WHEN** current server scope and access authorize the operation
- **THEN** the form exposes only existing fields and one dominant submit action, and the existing file manifest, Beijing-time conversion, request body, idempotency, invalidation, and success navigation remain unchanged.

#### Scenario: Seller logs in or must change password
- **WHEN** `/seller/login` or `/seller/change-password` renders normally or during a safe recovery state
- **THEN** path-bound identity and required recovery controls remain keyboard-operable, the login core is only 月光白、账号、密码、登录, and no identity selector, Buyer/Staff handoff, or unsafe account/session fact appears.

### Requirement: Seller copy, status, time, and money remain truthful
Touched user-facing copy SHALL be Chinese; epoch timestamps SHALL display in `Asia/Shanghai` with visible `北京时间`; business dates SHALL remain date-only; status/task/role/Marketplace enums SHALL use truthful Chinese display labels; and money/rates SHALL use integer/string/BigInt-safe formatters.

#### Scenario: Representative Seller pages are inspected
- **WHEN** the DOM is scanned for raw internal enum output, ambiguous timezone text, duplicate workspace titles, or internal implementation explanations
- **THEN** touched presentation uses Chinese labels, explicit Beijing timestamps, exact date-only and currency meanings, and omits the frozen duplicate/internal copy while retaining 卖家本金 and 卖家服务费.

#### Scenario: A runtime value is unknown
- **WHEN** a value falls outside the strict Seller runtime Contract
- **THEN** existing fail-closed validation/error behavior remains rather than fabricating a translation, date, amount, status, or authority.

### Requirement: Seller presentation remains responsive and accessible
Representative Seller list/detail/form/account surfaces SHALL remain usable at 320, 390, 768, 1440, and 1600 CSS-pixel widths, 200% root text size, keyboard-only navigation, and reduced-motion preference with visible unobscured focus, 44px targets, non-color-only state, suitable contrast, semantic headings/tables, and no document-level horizontal overflow.

#### Scenario: Required viewport and text matrix is exercised
- **WHEN** deterministic Seller pages are opened at every required width and at 200% root text size
- **THEN** context, identifiers, records, amounts, files, forms, actions, and navigation reflow without clipped primary controls or horizontal page scrolling.

#### Scenario: Keyboard and motion preferences are exercised
- **WHEN** a keyboard user traverses navigation, Store selection, forms, dialogs, and actions or reduced motion is requested
- **THEN** focus remains visible and clear of fixed navigation, source order stays logical, all controls meet 44px, and nonessential motion is removed.

### Requirement: Seller visual evidence is deterministic and reviewed
The Change SHALL produce comparable deterministic before/after screenshots for the frozen Seller route/viewport matrix and SHALL record per-image review for hierarchy, Chinese copy, context, wrapping, overflow, focus, truthfulness, and forbidden disclosure.

#### Scenario: Screenshot matrix is generated
- **WHEN** before and after suites run with the same Contract-valid fixtures, locale, timezone, motion, viewport, and filenames
- **THEN** comparable evidence exists outside runtime assets for every representative Seller surface and width.

#### Scenario: Evidence is handed to controller review
- **WHEN** implementation is reported complete
- **THEN** every final image has a recorded PASS/FAIL result, all failures are explicit, and visual evidence is accompanied by independent DOM/browser/security assertions.

### Requirement: Seller route isolation and presentation-only scope are preserved
The Change SHALL add no runtime dependency, keep the existing Seller lazy route boundary, keep every JavaScript chunk below 500 kB raw or report a blocker, and introduce no Buyer, Staff, Contract, Domain, API, Migration, permission, session, cache, file, production, or external-resource change.

#### Scenario: Seller route loads cold
- **WHEN** an authenticated Seller opens a protected Seller route from an empty browser cache
- **THEN** Buyer and Staff business route chunks are not prerequisites and protected Seller content renders only after the existing Customer Session boundary succeeds.

#### Scenario: Diff and build are reviewed
- **WHEN** changed files, imports, dependency manifests, production sizes, and Git state are inspected
- **THEN** only Seller presentation/OpenSpec/tests/evidence change, before/after sizes are recorded, no unauthorized boundary change exists, and the work remains unstaged, uncommitted, unpushed, unarchived, and undeployed.
