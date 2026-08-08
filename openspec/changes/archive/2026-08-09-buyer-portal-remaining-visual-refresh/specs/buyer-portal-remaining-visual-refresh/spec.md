# Buyer Portal Remaining Visual Refresh Requirements

## ADDED Requirements

### Requirement: Remaining Buyer pages use the approved Buyer visual grammar
Reservation, instruction, order-material, formal-order, review, refund, Me, change-password, and necessary registration surfaces SHALL extend the approved Buyer login/home/product hierarchy using only `tokens.css`, existing primitives, real routes, and returned Buyer DTO facts.

#### Scenario: A remaining Buyer page is reviewed beside the approved pilot
- **WHEN** its deterministic mobile screenshot is compared with the approved Buyer direction and merged pilot
- **THEN** it shows generous Buyer whitespace, clear stage/title/status hierarchy, prominent primary content, one dominant action, relaxed cards, and the real five-item navigation without reading like an employee administration page.

#### Scenario: The reference depicts unsupported content
- **WHEN** the direction image includes an image, schedule, rank, status, amount, time, action, or permission absent from the page's existing Buyer DTO and behavior
- **THEN** the implementation omits it and preserves the authoritative Contract and action projection.

### Requirement: Reservation and instruction presentation preserves server authority
Reservation list/detail and instruction pages SHALL prioritize product, textual status, applicable deadline, public notes, and the real next action while preserving `can_cancel`, instruction status/booleans, version, idempotency, and state-first content rules.

#### Scenario: Reservation has a real next action
- **WHEN** an APPROVED reservation permits instruction access or `can_cancel=true`
- **THEN** the real instruction action is visually primary, cancellation remains subordinate and confirmed, and neither action changes its route, body, version, or idempotency behavior.

#### Scenario: Instruction is terminal or unreadable
- **WHEN** instruction status/booleans do not authorize content, images, or evidence submission
- **THEN** the page shows the returned Chinese state and applicable returned deadlines without requesting forbidden content, retaining stale images, or inventing a submit action.

### Requirement: Order-material forms and records remain exact
Order-material list/new/detail SHALL preserve eligibility, exact one-file verification, Amazon order number/date, integer JPY, optional note, price mismatch, public change reason, allowed actions, current version, protected reads, and exact mutation bodies while applying the Buyer visual hierarchy.

#### Scenario: Buyer submits or resubmits order material
- **WHEN** current server facts authorize the form
- **THEN** the page presents one clear staged task and one dominant submit action, while exact fields, native date/file inputs, upload lifecycle, command body, version, and idempotency remain unchanged.

#### Scenario: Existing material requires attention or is read-only
- **WHEN** the DTO returns CHANGES_REQUESTED, PRICE_MISMATCH, no readable file authority, or no allowed action
- **THEN** the public reason/business notice/metadata-only state is visually clear and the page neither fabricates file access nor exposes a disallowed control.

### Requirement: Formal orders remain read-only Buyer snapshots
Formal-order list/detail SHALL present only returned immutable order, amount, exchange-rate, date, time, and evidence summary facts and SHALL keep the existing supported filters, cursor paging, and absence of Buyer mutations.

#### Scenario: Buyer filters or opens a formal order
- **WHEN** a supported filter or owned detail is used
- **THEN** the existing exact API parameters and returned snapshot facts are presented in a clear Buyer hierarchy with no recomputation or added write action.

#### Scenario: Date or amount facts differ in meaning
- **WHEN** platform order date, confirmation business date, confirmation timestamp, JPY, CNY fen, or exchange-rate snapshot is displayed
- **THEN** each keeps its authoritative label/formatter and no field substitutes for another.

#### Scenario: Immutable exchange-rate snapshot is customer-readable
- **WHEN** the DTO returns `cny_per_jpy_e8` for a confirmed formal order
- **THEN** the page preserves that snapshot but renders it with integer-safe string/BigInt arithmetic as `1 JPY = X CNY`, and does not expose the `e8` storage label or raw scaled integer.

### Requirement: Review presentation preserves eligibility and file authority
Review list/new/detail SHALL preserve server-defined eligibility, exact review type, one-to-three verified files, nullable review URL, optional note, public change reason, allowed actions, protected file reads, version, and idempotency while providing one clear primary task.

#### Scenario: Buyer submits or resubmits review material
- **WHEN** current eligibility/actions authorize the operation
- **THEN** the form exposes only the existing fields and one dominant submit action, and the command still uses the exact current order/type/files/version facts.

#### Scenario: Review is approved or requires changes
- **WHEN** the DTO returns APPROVED with `buyer_refund_due` or CHANGES_REQUESTED with a public reason
- **THEN** the page shows the returned Chinese state and either `返款金额` or the public reason without inventing refund payment status or another action.

### Requirement: Refund surfaces use exact Buyer-safe terminology and facts
Refund list/detail SHALL be read-only, SHALL use `返款金额` for the returned product-principal obligation, and SHALL preserve due, net paid, remaining, overpaid, textual status, and every payment/reversal activity and balance-after fact.

#### Scenario: Refund list or detail renders
- **WHEN** the API returns DUE, PARTIALLY_PAID, PAID, or OVERPAID data
- **THEN** `返款金额` and all returned balances/statuses are visible with CNY formatting and no Buyer payment or edit control.

#### Scenario: Payment and reversal history is present
- **WHEN** detail returns PAYMENT_RECORDED and PAYMENT_REVERSED activities
- **THEN** both remain visible in server order with Chinese activity/channel labels, Beijing time, and complete returned balance-after facts.

#### Scenario: Refund journey projects completion truthfully
- **WHEN** the refund list contains mixed statuses, or detail returns DUE, PARTIALLY_PAID, or OVERPAID
- **THEN** the journey does not mark `完成` as current; only a detail whose returned status is exactly PAID marks `完成` as current.

### Requirement: Me, password, and registration align without weakening identity security
Buyer Me, change-password, and invitation-registration SHALL match the approved Buyer hierarchy while preserving read-only profile scope, exact account destinations, logout, forced-password behavior, invitation authority, Customer-root cleanup, Session reread, mismatch handling, and safe errors.

#### Scenario: Buyer opens Me or changes password
- **WHEN** the authenticated route renders normally or under forced password change
- **THEN** published Buyer facts and real account actions remain available, unsupported edits/customer number/Session expiry remain absent, and cleanup recovery stays keyboard-operable.

#### Scenario: Buyer opens an invitation registration link
- **WHEN** a valid or invalid invitation route is loaded
- **THEN** the page retains the real invitation context, exact fields, backend authority, safe error flow, and post-registration Session confirmation without identity switching, marketing copy, or fabricated verification.

### Requirement: Remaining Buyer copy, time, status, and money remain truthful
Touched user-facing copy SHALL be Chinese; epoch timestamps SHALL display in `Asia/Shanghai` with `北京时间`; date-only/business-date facts SHALL remain distinct; status/task/channel enums SHALL use truthful Chinese display labels; and money SHALL use existing integer-safe JPY/CNY formatters.

#### Scenario: A representative remaining page is inspected
- **WHEN** its DOM is scanned for raw internal English enum presentation, ambiguous timezone text, or refund wording
- **THEN** touched presentation uses Chinese labels, explicit Beijing-time timestamps, exact date-only facts, and `返款金额` without changing source values.

#### Scenario: A value is unknown or unsupported
- **WHEN** a nullable historical fact is absent or a runtime value is outside the Contract
- **THEN** the existing unknown/fail-closed behavior remains rather than fabricating a translation, time, amount, status, or authority.

### Requirement: Remaining Buyer pages are responsive and accessible at frozen conditions
Representative list/detail/form/account surfaces SHALL remain usable at 320, 390, 768, 1440, and 1600 CSS-pixel widths, 200% root text size, keyboard-only navigation, and reduced-motion preference with visible unobscured focus, 44px targets, non-color-only state, suitable contrast, and no document-level horizontal overflow.

#### Scenario: Required viewport and text matrix is exercised
- **WHEN** deterministic pages are opened at each width and at 200% root text size
- **THEN** content, identifiers, files, filters, forms, actions, and five-item navigation reflow without clipped primary controls or horizontal page scrolling.

#### Scenario: Keyboard and motion preferences are exercised
- **WHEN** a keyboard user traverses pages or reduced motion is requested
- **THEN** focus remains visible above fixed navigation, semantic order remains logical, all interactive targets meet 44px, and nonessential motion is removed.

### Requirement: Remaining Buyer evidence is deterministic and reviewed
The Change SHALL produce comparable deterministic before/after screenshots at the five frozen widths and SHALL record per-image review for hierarchy, Chinese copy, wrapping, overflow, focus, truthfulness, and forbidden disclosure.

#### Scenario: Screenshot matrix is generated
- **WHEN** before and after suites run with the same Contract-valid fixtures, locale, timezone, motion, viewport, and filenames
- **THEN** comparable evidence exists outside runtime assets for every representative remaining surface and width.

#### Scenario: Evidence is handed to controller review
- **WHEN** implementation is reported complete
- **THEN** every final image has a recorded PASS/FAIL result, all failures are explicit, and visual evidence is accompanied by independent DOM/browser/security assertions.

### Requirement: Route isolation and presentation-only scope are preserved
The Change SHALL add no runtime dependency, keep existing Buyer page-level lazy loading, keep every JavaScript chunk below 500 kB raw or report a blocker, and introduce no Contract, Domain, API, Migration, permission, session, cache, file, Seller, Staff, production, or external-resource change.

#### Scenario: Cold Buyer route chunks are observed
- **WHEN** product, order, and after-sales routes are loaded from empty browser cache
- **THEN** each requests only the existing entry/Buyer/shared chunks and its own necessary business chunk without preloading adjacent Buyer, Seller, or Staff business modules.

#### Scenario: Diff and build are reviewed
- **WHEN** changed files, imports, dependency manifests, production build sizes, and Git state are inspected
- **THEN** only Buyer presentation/OpenSpec/tests/evidence change, before/after sizes are recorded, no unauthorized boundary changes exist, and the work remains unstaged, uncommitted, unpushed, unarchived, and undeployed.
