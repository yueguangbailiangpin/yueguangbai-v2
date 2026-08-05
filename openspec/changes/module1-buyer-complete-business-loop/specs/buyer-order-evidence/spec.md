# Buyer Order Evidence Capability

## ADDED Requirements

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
- **WHEN** the selected screenshot passes intent, upload, HEAD verification, and complete
- **THEN** its single verified `file_object_id` becomes the only file in the business command.

#### Scenario: Zero, multiple, PDF, expired, or unverified files
- **WHEN** selection or verification does not yield exactly one allowed verified screenshot
- **THEN** the business submit remains blocked and no extra file identifier enters the command.

### Requirement: Initial evidence submission follows the Contract
Initial submission SHALL call `POST /api/buyer-portal/order-evidence` with `reservation_id`, `expected_version=0`, normalized-input Amazon order number, integer `final_paid_jpy`, exactly one `file_object_ids` entry, optional Buyer note, and one logical-operation idempotency key.

#### Scenario: Initial submission succeeds
- **WHEN** the current instruction window accepts the command
- **THEN** the returned evidence detail becomes authoritative and related eligibility, list/detail, reservation instruction state, dashboard, and file views are precisely refreshed.

#### Scenario: Order number, deadline, file, or state conflicts
- **WHEN** the API returns hidden not-found, duplicate order number, state conflict, unverified file, or deadline/version conflict
- **THEN** the UI displays only the safe code/message/request ID and does not reveal another Buyer or order.

### Requirement: Evidence list and detail preserve server facts
The order-evidence list/detail SHALL display reservation summary, Amazon order number, final paid JPY, self-pay basis points and JPY, refundable principal JPY, price mismatch and difference, status, versions, public change reason, files, timestamps, and `allowed_actions` from the DTO.

#### Scenario: Evidence detail loads
- **WHEN** a valid evidence DTO is returned
- **THEN** every displayed financial and workflow fact is sourced directly and actions match `allowed_actions`.

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
RESUBMIT SHALL be available only from `allowed_actions` and SHALL call `POST /api/buyer-portal/order-evidence/:id/resubmit` with current positive `expected_version`, Amazon order number, integer final paid JPY, exactly one verified screenshot, optional note, and a fresh logical-operation idempotency key.

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

### Requirement: Evidence file reading uses safe references
Evidence file viewing SHALL construct a `SafeFileReference` only from DTO `file_object_id`, current verified file version supplied by an authoritative projection, purpose ORDER_EVIDENCE, and visibility BUYER_VISIBLE, then use the Wave14A read flow. If the current DTO cannot supply the required positive file version, preview SHALL be recorded as unavailable rather than guessed.

#### Scenario: Authoritative file version is available
- **WHEN** a safe evidence file reference can be formed from returned server data
- **THEN** the short read-intent/content flow displays ephemeral bytes and releases its Object URL.

#### Scenario: DTO lacks file version or read is denied
- **WHEN** the evidence DTO lacks `file_version`, the generic route cannot authorize a link, or read fails
- **THEN** the page shows file metadata without fabricating a version, permanent URL, or preview capability.
