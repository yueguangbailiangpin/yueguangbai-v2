# buyer-order-evidence Specification

## Purpose
TBD - created by archiving change module1-buyer-complete-business-loop. Update Purpose after archive.
## Requirements
### Requirement: Evidence eligibility is server-defined
The order-materials area SHALL page `GET /api/buyer-portal/order-evidence/eligible-reservations` and use `current_order_evidence_status`, `current_order_evidence_version`, and `allowed_actions` as the only authority for SUBMIT or RESUBMIT entry.

#### Scenario: Eligible reservation is returned
- **WHEN** `allowed_actions` contains SUBMIT or RESUBMIT
- **THEN** the matching form entry is shown with reservation product, store, review type, and order deadline.

#### Scenario: Action is absent or stale
- **WHEN** the returned action is absent or a later mutation rejects the state
- **THEN** the UI exposes no inferred action and refetches the authoritative eligibility/detail.

### Requirement: Evidence upload accepts exactly one verified screenshot
The order-evidence form SHALL use the Wave14A `buyerOrderEvidence` workflow, accept exactly one image/jpeg, image/png, or image/webp file within its configured byte limit, and permit business submission only after that one file is VERIFIED.

#### Scenario: One screenshot verifies
- **WHEN** the selected screenshot passes intent, upload, and server-side file verification during Complete
- **THEN** its single verified `file_object_id` becomes the only file in the business command.

#### Scenario: Zero, multiple, PDF, expired, or unverified files
- **WHEN** selection or verification does not yield exactly one allowed verified screenshot
- **THEN** the business submit remains blocked and no extra file identifier enters the command.

### Requirement: Initial evidence submission follows the Contract
Initial submission SHALL start only from `/buyer/order-materials/new?reservation_id=<id>` after identifier validation and a fresh eligibility/instruction-state read, then call `POST /api/buyer-portal/order-evidence` with `reservation_id`, `expected_version=0`, normalized-input Amazon order number, required `amazon_order_date`, integer `final_paid_jpy`, exactly one `file_object_ids` entry, optional Buyer note, and one logical-operation idempotency key. `amazon_order_date` SHALL be exact valid Gregorian `YYYY-MM-DD`, represent the date displayed on the Amazon order page, and remain date-only without timezone conversion. Navigation state SHALL NOT authorize the form and Session storage SHALL NOT restore the reservation ID.

#### Scenario: Initial submission succeeds
- **WHEN** the refreshed source remains eligible and the current instruction window accepts the command with a valid Amazon order date
- **THEN** the returned evidence detail, including the stored date for version 1, becomes authoritative and related eligibility, list/detail, reservation instruction state, dashboard, and file views are precisely refreshed.

#### Scenario: Source, date, order number, file, or state conflicts
- **WHEN** the source query is missing/invalid/stale, the date is not a real `YYYY-MM-DD`, or the API returns hidden not-found, duplicate order number, state conflict, unverified file, or deadline/version conflict
- **THEN** the UI displays only the safe code/message/request ID and does not reveal another Buyer or order.

### Requirement: Evidence list and detail preserve server facts
The order-evidence list/detail SHALL display reservation summary, Amazon order number, nullable-read-model `amazon_order_date`, final paid JPY, self-pay basis points and JPY, refundable principal JPY, price mismatch and difference, status, versions, public change reason, files, timestamps, and `allowed_actions` from the DTO. New versions SHALL always return the required date; a historical NULL SHALL display as unknown and SHALL NOT be replaced with `submitted_at`, `confirmed_at`, or `confirmed_business_date`. Future Migration 0028 SHALL add a nullable Gregorian-checked column to immutable `order_evidence_versions`, preserve historical NULL without fake backfill, and recreate its insert guard so every new version rejects a missing date; it SHALL add no index.

#### Scenario: Evidence detail loads
- **WHEN** a valid evidence DTO is returned
- **THEN** every displayed date, financial, and workflow fact is sourced directly, historical unknown remains explicit, and actions match `allowed_actions`.

#### Scenario: File or financial field is malformed
- **WHEN** runtime validation detects unsupported state, file shape, or unsafe number
- **THEN** the response fails closed instead of recomputing, rounding, or exposing storage authority.

### Requirement: PRICE_MISMATCH is a business notice
When `price_mismatch=true`, the UI SHALL state `实际支付金额与参考金额不一致` and show signed `price_difference_jpy` with JPY semantics. It SHALL NOT label this DTO fact as a system failure or block viewing the submitted evidence.

#### Scenario: Paid amount differs
- **WHEN** the DTO has `price_mismatch=true`
- **THEN** an accessible warning explains the difference while preserving the returned workflow status.

#### Scenario: Mismatch fields disagree
- **WHEN** mismatch boolean and difference do not form a coherent server projection
- **THEN** runtime validation raises a contract/dependency state instead of inventing a correction.

### Requirement: Resubmission uses current positive version
RESUBMIT SHALL be available only from `allowed_actions` and SHALL call `POST /api/buyer-portal/order-evidence/:id/resubmit` with current positive `expected_version`, Amazon order number, required valid date-only `amazon_order_date`, integer final paid JPY, exactly one verified screenshot, optional note, and a fresh logical-operation idempotency key. Every resubmit creates a new immutable evidence version carrying its own date.

#### Scenario: Requested changes are resubmitted
- **WHEN** status is CHANGES_REQUESTED, public reason is shown, and the Buyer submits before the change deadline
- **THEN** the returned pending evidence replaces old detail and instruction state is refreshed.

#### Scenario: Version or change deadline conflicts
- **WHEN** another update wins or the resubmission deadline is reached
- **THEN** the UI keeps entered non-sensitive values where safe, refreshes authoritative facts, and never silently retries or overwrites.

### Requirement: Withdrawal uses current allowed action
WITHDRAW SHALL be offered only when present in `allowed_actions` and SHALL call `POST /api/buyer-portal/order-evidence/:id/withdraw` with latest positive `expected_version` and a fresh logical-operation idempotency key after explicit confirmation.

#### Scenario: Pending evidence is withdrawn
- **WHEN** the Buyer confirms an allowed withdrawal
- **THEN** returned WITHDRAWN detail is shown and precisely related queries are invalidated.

#### Scenario: Withdrawal is unavailable or conflicts
- **WHEN** the action is absent, version changed, or evidence is terminal
- **THEN** no destructive-looking control is shown or the server conflict requires refresh without automatic retry.

### Requirement: Evidence file reading uses dedicated trusted intent creation
Readable evidence files SHALL expose `file_entity_link_id`, positive `version`, and `allowed_actions` containing only CREATE_READ_INTENT. `BuyerOrderEvidenceFileReadIntentAdapter` SHALL construct `POST /api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent` from validated submission/link IDs and send only positive `expected_file_version`; no DTO/API string may be forwarded arbitrarily. The endpoint SHALL require current Buyer submission ownership, current visible file membership, exact version, and explicit-audience or current formal-file authorization; concealed scope misses SHALL be 404. Its safe response SHALL contain `read_intent_id`, `file_object_id`, nullable `access_token`, `access_token_available`, `expires_at`, and `replayed`, with replay never reissuing a token. Content SHALL continue through the existing Buyer file-read-intents byte endpoint and Wave14A header/token/Object-URL lifecycle.

#### Scenario: New authoritative evidence file is viewed
- **WHEN** current DTO link/version/action facts authorize the dedicated intent and its first response supplies a token
- **THEN** the existing bounded content flow displays ephemeral bytes and releases its Object URL without exposing storage authority.

#### Scenario: Historical metadata or read denial remains safe
- **WHEN** a historical record cannot be authoritatively backfilled with link/version/action facts, the version mismatches, the token is unavailable, or scope/read fails
- **THEN** the page shows metadata or a safe restart/denial state without fabricating a version, permanent URL, object key, token, or preview capability.
