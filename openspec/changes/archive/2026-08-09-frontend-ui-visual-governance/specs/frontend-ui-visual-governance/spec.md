# Frontend UI Visual Governance Requirements

## ADDED Requirements

### Requirement: Existing tokens are the only design truth
The frontend SHALL use `apps/web/src/styles/tokens.css` as its only design-token source and SHALL NOT add a second palette, spacing scale, typography system, identity theme, UI framework, external Chinese font, or site-wide glass/blur treatment.

#### Scenario: Buyer pilot styles are inspected
- **WHEN** the Buyer pilot source and production CSS are reviewed
- **THEN** visual values compose existing semantic tokens and no competing design system or runtime styling dependency exists.

#### Scenario: A visual reference contains unsupported styling or facts
- **WHEN** a supplied direction image shows a field, stage, icon, amount, date, font, blur, or workflow not authorized by repository truth
- **THEN** the implementation omits it and retains the authoritative existing contract and token behavior.

### Requirement: Persona density and context remain distinct
Buyer surfaces SHALL be mobile-first and concise; Seller surfaces SHALL remain high-density with clear organization/store context; Staff surfaces SHALL retain the established high-efficiency queue/detail/action order and three-column desktop model.

#### Scenario: This Change is reviewed for scope
- **WHEN** its source diff is compared with the baseline
- **THEN** only the Buyer pilot and non-rendering governance/test evidence change, while Seller and Staff pages, shells, copy, routes, and layout remain byte-for-byte unchanged.

#### Scenario: Future persona work uses the governance rule
- **WHEN** a later Seller or Staff visual Change is proposed
- **THEN** it preserves the frozen persona density/context rule without sharing identity authority, DTOs, Query caches, or route guards.

### Requirement: Buyer login stays minimal and recoverable
`/buyer/login` SHALL show 月光白、账号、密码、登录 as its core steady-state content, SHALL derive identity only from the route, and SHALL preserve necessary safe validation, loading, mismatch, request-ID, and cleanup-recovery feedback.

#### Scenario: Buyer opens the login page
- **WHEN** `/buyer/login` renders at any required viewport
- **THEN** it contains one labeled account field, one labeled password field, one login action, no persona selector, no registration or cross-identity link, and no duplicate identity/workspace/marketing copy.

#### Scenario: Login fails or cleanup must be retried
- **WHEN** the existing controller returns a safe login error, mismatch, or cleanup failure
- **THEN** the existing neutral error and explicit recovery behavior remain keyboard-operable without revealing the returned account type or entering another identity shell.

### Requirement: Buyer home and product pages use only reservable server facts
`/buyer`, `/buyer/products`, `/buyer/demands`, and `/buyer/demands/:demandId` SHALL render only the products and Buyer-safe facts returned by the existing server-authoritative reservable-demand APIs and SHALL preserve the final server recheck on reservation submission.

#### Scenario: Product list renders returned items
- **WHEN** the server returns currently reservable Buyer demand items
- **THEN** the home/product area shows those items and only their returned Buyer-safe product, store, availability, deadline, amount, task, note, and action facts as applicable to the route.

#### Scenario: Product is not returned or becomes stale
- **WHEN** Marketplace, time window, capacity, participation history, or Buyer eligibility excludes a product, or a returned product becomes stale before mutation
- **THEN** the client does not invent or retain unauthorized availability and the existing server conflict/recovery flow remains authoritative.

### Requirement: Buyer home reaches the approved mobile visual hierarchy
At 390x844 the Buyer home SHALL visibly approach the approved direction's hierarchy, scale, spacing, card prominence, and mobile completion while continuing to use only repository tokens, real routes, and server-authorized facts.

#### Scenario: Buyer home is reviewed beside the approved direction
- **WHEN** the deterministic 390x844 Buyer home screenshot is placed beside the approved direction image
- **THEN** both visibly present generous 月光白 brand space, a four-step 产品→订单资料→评论→完成 journey, a dominant 当前开放产品 area, a large primary product card and action, a distinct 下一步 area, and a tall relaxed five-item navigation in the same relative hierarchy.

#### Scenario: Visual hierarchy is distinguished from an administrative list
- **WHEN** the 390x844 page is reviewed at first glance
- **THEN** the primary product title and action dominate metadata, major regions have deliberate whitespace and card scale, and the page does not read as a stack of equally weighted backend information rows.

#### Scenario: Direction-only elements lack business authority
- **WHEN** the approved direction depicts completion, an expected date, ranking, schedule, order state, image, or menu control not authorized by the existing UI behavior and Buyer DTO
- **THEN** the implementation omits that claim or control; the four steps remain explanatory, and 下一步 contains only returned safe facts plus a real product-detail action.

#### Scenario: Open products are not presented as Buyer progress
- **WHEN** a Buyer-safe demand is returned as currently reservable but no reservation or order exists
- **THEN** the home calls it 当前开放产品 and does not label it 进行中、已预约、已下单、等待下单 or otherwise imply a Buyer-owned workflow state.

### Requirement: Buyer pilot does not expose internal or adjacent workflow data
The Buyer login/home/product pilot SHALL NOT expose customer number, session expiry, internal business time, internal notes, internal ranking or scheduling, storage authority, Seller internals, Staff data, internal profit, or order/review/refund content.

#### Scenario: Pilot DOM and fixtures are inspected
- **WHEN** login, product list, and product detail responses and rendered DOM are reviewed
- **THEN** forbidden internal fields and adjacent order/review/refund facts are absent rather than visually hidden.

#### Scenario: Direction image contains a next-step or schedule card
- **WHEN** no existing Buyer-safe DTO authorizes that next-step or schedule fact
- **THEN** the card is not implemented or fabricated.

### Requirement: Buyer pilot is responsive and accessible at frozen conditions
The Buyer pilot SHALL remain usable at 320, 390, 768, 1440, and 1600 CSS-pixel widths, 200% root text size, keyboard-only navigation, and reduced-motion preference, with visible focus, non-color-only state, suitable contrast, and no document-level horizontal overflow.

#### Scenario: Required viewport matrix is exercised
- **WHEN** each pilot route is opened at the five required widths
- **THEN** content reflows without clipped text or primary controls, the five-item navigation remains operable, and the document scroll width does not exceed its client width.

#### Scenario: Accessibility preferences are exercised
- **WHEN** a keyboard user traverses the pilot, root text size is set to 200%, or reduced motion is requested
- **THEN** focus remains visible and unobscured, controls retain accessible names and 44px targets, content reflows, and meaningful animation duration is removed.

### Requirement: Visual evidence is deterministic and reviewed
The Change SHALL produce comparable deterministic before/after screenshots for Buyer login, home/product list, and product detail at every required viewport and SHALL record a per-image review result in the Change evidence.

#### Scenario: Screenshot suite runs twice
- **WHEN** the baseline and implementation use the same fixture data, timezone, locale, viewport, animation settings, and file naming
- **THEN** the resulting before/after pairs are comparable and stored outside tracked application assets.

#### Scenario: Visual review is reported
- **WHEN** the Change is presented for controller review
- **THEN** every screenshot pair has been inspected for hierarchy, copy, wrapping, overflow, focus, forbidden data, and responsive behavior, with any failure explicitly listed.

### Requirement: Existing lazy-loading performance is preserved
The Buyer pilot SHALL add no runtime dependency, SHALL keep the initial entry below 500 kB raw, and SHALL not make Buyer product routes preload Buyer order, review, refund, Seller, or Staff business-page modules.

#### Scenario: Production build is compared
- **WHEN** before and after builds run in the same Node/npm/lockfile environment
- **THEN** raw and gzip sizes for the entry, CSS, Buyer route, and any new chunk are recorded and every JavaScript chunk remains below 500 kB or is reported as an explicit blocker.

#### Scenario: Buyer product page loads cold
- **WHEN** `/buyer/products` renders from an empty browser cache after session authorization
- **THEN** order-material, review, refund, Seller, and Staff route chunks are not prerequisites for the page.

### Requirement: The pilot is presentation-only and locally reversible
The Change SHALL introduce no Migration, API/DTO/request contract, authorization, session, cache namespace, business state, Audit, Outbox, file workflow, production configuration, or external-resource change.

#### Scenario: Change scope is verified
- **WHEN** changed files and network requests are inspected
- **THEN** only OpenSpec/governance evidence, Buyer pilot presentation, and its tests are present and existing API paths and bodies remain unchanged.

#### Scenario: Pilot is rolled back
- **WHEN** the Buyer pilot JSX/CSS/tests are reverted
- **THEN** the baseline Buyer behavior returns without any data, schema, API, permission, session, cache, or external-resource rollback.
