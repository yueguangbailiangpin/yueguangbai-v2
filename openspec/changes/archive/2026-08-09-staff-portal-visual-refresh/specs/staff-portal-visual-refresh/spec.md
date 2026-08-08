# Staff Portal Visual Refresh Requirements

## ADDED Requirements

### Requirement: Every real Staff surface uses one efficient workbench grammar
Staff login, protected shell, work queue/detail/action, customer-security tools, acquisition, product/scheduling, and owner dashboard surfaces SHALL use `tokens.css`, existing primitives, real routes, and returned Staff DTO facts to form one high-density Chinese operations workspace.

#### Scenario: Staff page is compared with the approved direction
- **WHEN** deterministic mobile and desktop screenshots are reviewed beside the Staff direction
- **THEN** the implementation has clear navigation, compact context, filter/list/detail/action hierarchy, restrained Staff accent, efficient density, and narrow-screen reflow without copying unsupported fields, counts, states, filters, or controls.

#### Scenario: Reference contains unsupported content
- **WHEN** the direction includes a search, source, customer field, amount, time, count, status, action, or permission absent from the current route's Staff DTO and behavior
- **THEN** the implementation omits it and preserves the authoritative Contract and backend action projection.

### Requirement: Staff navigation follows the four-role backend projection
The protected shell SHALL display 总管理员、售前、卖家对接、买家返款 from the trusted Session, SHALL preserve the existing real routes, and SHALL show optional navigation only when current role duties and effective backend-projected permissions authorize the area.

#### Scenario: Four canonical roles open Staff
- **WHEN** owner, pre_sales, seller_ops, or buyer_refund enters with one valid ACTIVE role and current permissions
- **THEN** the shell shows that exact Chinese role, never asks for role selection, and exposes only the permitted navigation while direct backend requests remain independently authorized.

#### Scenario: Buyer-refund Staff views navigation
- **WHEN** the current role is buyer_refund, even with stale client state
- **THEN** 获客登记 is absent, no acquisition registration control renders, and direct acquisition API calls continue to fail closed.

#### Scenario: Optional permission is denied
- **WHEN** PRODUCT_VIEW, an acquisition permission, or owner plus FINANCIAL_VIEW is absent or personally denied
- **THEN** the corresponding 产品预约、获客登记 or 经营看板 entry and cached sensitive content are absent without weakening backend 403/404 enforcement.

### Requirement: Queue, detail, and controlled action order is preserved
The workbench SHALL retain the queue as its navigation spine, exact status/work-type filters and opaque cursor traversal, authoritative detail panels, and existing controlled actions in queue → detail → action DOM and keyboard order.

#### Scenario: Desktop work queue renders
- **WHEN** a current scoped page of work items and a supported selected item are returned
- **THEN** desktop shows scan-efficient filters/list, the selected authoritative detail, and only the existing controlled actions without inventing search, sources, totals, pages, resource fields, or permissions.

#### Scenario: Narrow work queue renders
- **WHEN** the same route opens at 320px or 390px
- **THEN** queue, detail, and action/tool regions remain reachable in semantic order with no document-level horizontal overflow or hidden primary action.

#### Scenario: Permission or scope changes during work
- **WHEN** detail/action/file requests later return 401, 403, concealed 404, version conflict, or state conflict
- **THEN** stale sensitive/action state is removed as existing controllers require, input and exact-retry authority are preserved only where already authorized, and no optimistic business fact is shown.

### Requirement: Existing Staff commands and customer-security boundaries remain exact
Order/review/refund/settlement/demand actions and invitation/recovery controls SHALL keep their existing fields, confirmations, versions, idempotency, request hashes, exact retry, audit, protected-file, one-time-link, and password-blind behavior while receiving the unified hierarchy.

#### Scenario: Staff performs a controlled action
- **WHEN** the existing server projection and state authorize the command
- **THEN** one visually dominant real action uses the unchanged path/body/version/idempotency authority and success is shown only from returned or refetched server facts.

#### Scenario: Staff issues invitation or recovery
- **WHEN** an ACTIVE authorized Staff completes the existing required inputs
- **THEN** the one-time link remains ephemeral and hideable, Staff neither enters nor sees a Customer password, and request-ID/error/revoke recovery stays keyboard-operable.

### Requirement: Acquisition remains hybrid, scoped, and bookmarkable
`/staff/acquisition` SHALL remain a stable bookmarkable route and SHALL present only the existing owner administration, pre_sales Buyer-lead, and seller_ops Seller-lead panels allowed by trusted role and effective permissions.

#### Scenario: Authorized acquisition role opens the route
- **WHEN** owner, pre_sales, or seller_ops has the matching effective acquisition permission
- **THEN** the page shows its existing summary, lead registration/list, and owner administration as applicable, while channel selection, conversion facts, attribution, and counts remain server-derived.

#### Scenario: Acquisition is denied
- **WHEN** buyer_refund or a personally denied Staff opens the stable route directly
- **THEN** no registration/admin control or prior sensitive cached result appears and the backend continues to reject unauthorized reads/writes.

### Requirement: Scheduling and dashboard facts remain distinct and truthful
Product/scheduling pages SHALL preserve product cadence, stable reservation rank, planned dates, preview/confirm authority, and legacy unconfigured states; the owner dashboard SHALL preserve Beijing windows, cohort metrics, and separate projected/completed profit facts.

#### Scenario: Staff views or edits scheduling
- **WHEN** a scoped authorized Staff opens product or reservation scheduling routes
- **THEN** all displayed ranks, dates, actual-versus-planned distinctions and actions come from existing server facts and no Buyer/Seller DTO, order date, financial snapshot, or historical unconfigured row is fabricated or overwritten.

#### Scenario: Owner views profit
- **WHEN** an ACTIVE owner with FINANCIAL_VIEW and no final DENY opens the dashboard
- **THEN** 预计利润 and 已完成利润 remain separate CNY-fen server aggregates with explicit conflict facts and no browser recomputation.

#### Scenario: Unauthorized Staff opens dashboard
- **WHEN** role, permission, or Personal DENY fails the existing dashboard authority
- **THEN** no global metric, internal profit, customer drill-down, or cached owner response is displayed.

### Requirement: Staff login, copy, time, money, and files remain safe
Touched copy SHALL be Chinese; Staff login SHALL remain path-bound to its trusted Provider with no role/customer selector; epoch timestamps SHALL display in `Asia/Shanghai`; business dates SHALL remain date-only; money SHALL use integer-safe formatters; and files SHALL remain dynamically purpose/audience authorized.

#### Scenario: Staff opens login
- **WHEN** `/staff/login` renders normally or with a safe start failure
- **THEN** 月光白, one clear trusted-login action, necessary error/recovery and optional return remain visible without duplicated workspace/login explanations, account/password fields, role selection, or Buyer/Seller handoff.

#### Scenario: Representative Staff facts render
- **WHEN** queue, acquisition, scheduling, refund, settlement, or dashboard facts are shown
- **THEN** touched labels are Chinese, timestamps explicitly mean北京时间, date-only facts are not converted, 预计/已完成利润 and 卖家本金/服务费 remain separate, and object keys, Drive IDs, permanent URLs, tokens, secrets, or unauthorized customer fields are absent.

### Requirement: Staff presentation remains responsive and accessible
Representative login, queue, acquisition, scheduling, and dashboard surfaces SHALL remain usable at 320, 390, 768, 1440, and 1600 CSS pixels, 200% root text, keyboard-only operation, and reduced motion with visible unobscured focus, 44px targets, semantic headings/tables, non-color-only state, suitable contrast, and no document-level horizontal overflow.

#### Scenario: Required viewport and text matrix runs
- **WHEN** deterministic Staff pages open at each required width and at 200% text
- **THEN** navigation, filters, lists, identifiers, amounts, tables, forms, details, actions, and tools reflow without clipped primary controls or horizontal page scrolling.

#### Scenario: Keyboard and motion preferences run
- **WHEN** a keyboard user traverses navigation, filters, rows, forms, dialogs, and actions or reduced motion is requested
- **THEN** focus remains visible and clear of fixed navigation, source order remains logical, controls meet 44px, and nonessential motion is removed.

### Requirement: Four-role visual evidence is deterministic and reviewed
The Change SHALL produce comparable deterministic before/after screenshots for the frozen Staff route/viewport matrix and SHALL record per-image review plus independent four-role, permission, security, accessibility, and disclosure assertions.

#### Scenario: Evidence matrix is generated
- **WHEN** before and after suites run with the same Contract-valid fixtures, locale, timezone, motion, viewport, and filenames
- **THEN** comparable evidence exists outside runtime assets for every representative Staff surface and required width.

#### Scenario: Evidence is handed to controller review
- **WHEN** implementation is reported complete
- **THEN** every final image has a PASS/FAIL result, all failures and retries are explicit, and no unexecuted check is reported as passed.

### Requirement: Staff route isolation and presentation-only scope are preserved
The Change SHALL add no runtime dependency, keep the existing Staff identity/page lazy boundaries, keep every JavaScript chunk below 500 kB raw or report a blocker, and introduce no Buyer, Seller, Contract, Domain, API, Migration, Schema, permission, session, cache, file, production, or external-resource change.

#### Scenario: Staff routes load cold
- **WHEN** `/staff`, dashboard, or scheduling opens from an empty cache after Staff Session authorization
- **THEN** Buyer/Seller chunks are not prerequisites, `/staff` does not preload dashboard/scheduling chunks, and protected content never appears before authorization succeeds.

#### Scenario: Diff and build are reviewed
- **WHEN** changed files, imports, manifests, build sizes, routes, and Git state are inspected
- **THEN** only Staff presentation/OpenSpec/Staff tests/evidence change, before/after performance is recorded, and the work remains unstaged, uncommitted, unpushed, unarchived, undeployed, and without PR or external write.
