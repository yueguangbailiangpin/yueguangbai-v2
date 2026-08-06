# staff-internal-operations-workbench Specification

## Purpose
Define a truthful, protected and accessible Staff queue/detail/action workspace over existing authoritative business commands.
## Requirements
### Requirement: Every ACTIVE Staff can enter through an independent trusted Staff Session

The system SHALL protect every Staff workbench route with the existing internal Staff Session, SHALL reject non-ACTIVE or version-invalid Staff before rendering business content, SHALL keep Staff authority separate from Buyer/Seller Customer accounts, and SHALL NOT trust client-supplied Staff, role, permission, scope or Feishu fields.

#### Scenario: ACTIVE Staff enters

- **WHEN** an ACTIVE Staff user has a valid internal Staff Session
- **THEN** the protected Chinese workbench renders and each API request recalculates current D1 authorization.

#### Scenario: Inactive or stale Staff enters

- **WHEN** Staff is inactive or its session/authorization version is stale
- **THEN** the backend returns 401, protected Staff query/file state is cleared and no business content renders.

### Requirement: Work items form a stable scoped queue

The system SHALL list only work items visible under current permission, assignment and team scope, SHALL support exact status/work-type filters, bounded limits and an opaque stable `(created_at,id)` cursor, and SHALL return `next_cursor` without claiming totals or pages.

#### Scenario: Staff traverses a filtered queue

- **WHEN** Staff selects an allowed status/work type and follows returned cursors
- **THEN** each visible item appears at most once in stable order and no out-of-scope identifier or count is disclosed.

#### Scenario: Invalid or mismatched cursor

- **WHEN** a cursor is malformed or used with different bound filters
- **THEN** the request returns validation failure and no partial queue data.

### Requirement: Detail and action panels use only authoritative domain contracts

The workbench SHALL resolve the selected work item's existing domain detail where a Staff read route exists, SHALL separate customer-visible and internal content, SHALL expose only actions accepted by existing permission/state contracts, and SHALL truthfully render unsupported work types without inventing data or commands.

#### Scenario: Supported work item

- **WHEN** an authorized Staff selects order evidence, review, Buyer refund or Seller-organization context with an existing read contract
- **THEN** the detail is validated by a strict runtime schema and its controlled actions use the current server version.

#### Scenario: Out-of-scope or unsupported work item

- **WHEN** the selected resource is concealed by current scope or has no approved detail/action contract
- **THEN** the UI shows not-found or an explicit no-action state and does not probe or synthesize another endpoint.

### Requirement: Order and review confirmations preserve concurrency and formal facts

Order-evidence and review decisions SHALL call the existing controlled commands with Idempotency-Key, request hash and `expected_version`, SHALL preserve state-machine/transaction/audit enforcement, and SHALL surface version, state, mismatch and in-progress conflicts without optimistic confirmation.

#### Scenario: Successful decision

- **WHEN** authorized Staff submits a valid current decision and required reasons/acknowledgments
- **THEN** the server commits the existing atomic business command and the UI replaces sensitive state only with the returned/refetched server fact.

#### Scenario: Stale or ambiguous decision

- **WHEN** version/state conflicts or transport completion is ambiguous
- **THEN** the UI preserves input, shows request ID, reuses the exact key/body only for exact retry and requires refresh before changed resubmission.

### Requirement: Invitation and recovery remain single-use and password-blind

All ACTIVE Staff SHALL be able to issue/read/revoke Buyer invitations and issue password recovery through existing security contracts. Invitations SHALL remain WeChat/Marketplace-bound, expiring, revocable, single-use, issuer-audited facts. Staff SHALL NOT enter, read or receive Customer passwords, hashes or reusable plaintext credentials, and one-time links SHALL stay out of persistent browser state.

#### Scenario: Invitation lifecycle

- **WHEN** Staff issues, reads or revokes an invitation
- **THEN** the server enforces current Staff status, exact input, idempotency/version rules and returns only the approved safe lifecycle projection plus a first-response one-time link where applicable.

#### Scenario: Password recovery

- **WHEN** Staff records completed manual WeChat verification and issues recovery
- **THEN** the server returns a bounded one-time Customer link without exposing or accepting the new password.

### Requirement: Financial operations preserve integer money and independent components

The workbench SHALL treat Buyer payment money as currency-explicit integer minor-unit strings and Buyer refunds, Seller principal and Seller service fee as CNY-fen strings. It SHALL never use floating point for authoritative display calculations and SHALL keep Seller principal and service fee separate in queue, detail, actions, allocations, status and proof context.

#### Scenario: Mixed-currency order context

- **WHEN** returned order facts use JPY, USD or KRW and associated refund/settlement facts use CNY
- **THEN** the UI labels each source currency/exponent and displays CNY facts independently without client-side conversion.

#### Scenario: Principal complete and service fee pending

- **WHEN** Seller principal is paid but service fee remains unpaid
- **THEN** the workbench shows two distinct statuses and never marks a combined settlement complete.

### Requirement: Financial writes reuse immutable controlled commands

Buyer-refund payment/reversal and Seller payment/allocation/reversal actions SHALL use existing idempotency, expected-version, state, final-assertion and audit boundaries. Completed facts SHALL not be edited or deleted, and deployment rollback SHALL not create financial reversals.

#### Scenario: Exact replay or stale write

- **WHEN** an exact financial request is replayed or a stale version is submitted
- **THEN** the server replays the original result or returns a clear conflict without duplicating or overwriting ledger facts.

#### Scenario: Partial workflow failure

- **WHEN** proof, allocation, assertion or dependency processing fails
- **THEN** no partial financial confirmation is shown and the affected panel offers a request-ID-bearing retry path.

### Requirement: Protected files remain purpose and audience authorized

Order screenshots, review screenshots, Buyer-refund proofs and Seller-settlement proofs SHALL be opened only through fixed purpose-bound Staff adapters and short read intents. Every intent and content read SHALL recheck current Staff permission, Personal DENY, data scope, resource relation, file purpose/audience and expected version. DTOs SHALL NOT expose object keys, Drive IDs, arbitrary URLs or permanent tokens.

#### Scenario: Authorized file read

- **WHEN** currently authorized Staff opens a safe file reference with its exact version/link context
- **THEN** a short intent is created, content is consumed in memory and temporary tokens/Object URLs are discarded after use.

#### Scenario: Cross-scope, denied or malformed read

- **WHEN** Staff is denied, outside the customer/organization/store scope, or supplies a wrong purpose/version
- **THEN** the read fails closed as concealed not-found, conflict or validation failure and no storage authority leaks.

### Requirement: Marketplace and unavailable capabilities are truthful

The workbench SHALL display Marketplace, Store and currency context from server facts, SHALL preserve JP compatibility, SHALL support active Amazon JP/US facts, and SHALL present Korea as unavailable while its Adapter/workflow remains disabled.

#### Scenario: Active US fact

- **WHEN** a returned Staff-visible fact belongs to Amazon US
- **THEN** the UI labels the Marketplace and USD minor units without applying JP assumptions.

#### Scenario: Korea capability

- **WHEN** Korea appears in a selectable or explanatory context
- **THEN** it is disabled/unavailable and no Coupang action or validation is invented.

### Requirement: The workbench handles partial failure and recovery explicitly

Queue, detail and secondary domain panels SHALL fail independently, retain still-valid context, expose sanitized Chinese recovery text and request IDs, and SHALL not automatically retry non-idempotent mutations or deterministic 4xx failures.

#### Scenario: Detail fails while queue succeeds

- **WHEN** the selected domain detail returns a dependency error
- **THEN** the queue remains usable and only the detail panel offers retry with the returned request ID.

#### Scenario: Permission changes during use

- **WHEN** a later request returns 403/404 after a permission or scope change
- **THEN** the UI removes stale action state, preserves no optimistic fact and explains that current access no longer permits the operation.

### Requirement: Chinese time, responsive layout and accessibility are mandatory

The Staff UI SHALL use Chinese, display timestamps in `Asia/Shanghai`, preserve date-only facts, support desktop efficiency and 390px primary/320px minimum layouts, keyboard/touch operation, visible focus, 44px targets, non-color status, 200 percent reflow and reduced motion.

#### Scenario: Desktop and narrow workflow

- **WHEN** Staff completes queue → detail → action at desktop width or a 390/320px viewport
- **THEN** the same authoritative content and actions remain reachable without horizontal page scrolling or lost context.

#### Scenario: Keyboard, zoom and reduced motion

- **WHEN** Staff uses keyboard navigation, 200 percent zoom or reduced motion
- **THEN** focus order/return, labels, errors, dialogs/drawers and sensitive confirmations remain clear without reliance on color or animation.

### Requirement: Existing Buyer, Seller, Staff and JP behavior remains compatible

The Change SHALL preserve existing Buyer/Seller API and UI behavior, Staff command semantics, JP compatibility fields, file audiences and the documented dependency advisory baseline.

#### Scenario: Full regression

- **WHEN** repository, D1, permission, finance, file, Buyer/Seller/Staff and browser suites run
- **THEN** existing contracts remain compatible and the two documented React Router RSC high advisories do not increase or trigger a downgrade.
