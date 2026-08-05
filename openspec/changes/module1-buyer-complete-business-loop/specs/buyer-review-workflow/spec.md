# Buyer Review Workflow Capability

## ADDED Requirements

### Requirement: Review eligibility is server-defined
The review area SHALL page `GET /api/buyer-portal/reviews/eligible-orders` and use each order, `current_review`, and `allowed_actions` as the only authority for SUBMIT or RESUBMIT entry. Initial submission SHALL start from `/buyer/reviews/new?formal_order_id=<id>`; the required safe identifier SHALL be validated and matched against a fresh eligibility read on load, refresh, and direct link. Navigation state is only a display hint and Session storage SHALL NOT restore the source ID.

#### Scenario: Eligible formal order is returned
- **WHEN** the query-bound formal order is returned and `allowed_actions` contains SUBMIT or RESUBMIT
- **THEN** the matching form entry shows returned order context and current review version when present.

#### Scenario: Eligibility is absent or stale
- **WHEN** the query identifier is missing/invalid, an order is not returned, action is absent, or mutation rejects current state
- **THEN** the UI exposes no form or inferred action and returns safely to the owning list/NotFound or refreshes authoritative eligibility/detail.

### Requirement: Review upload and business file limits remain distinct
The form SHALL use the Wave14A `buyerReviewEvidence` upload workflow, while the review business command SHALL accept only one to three distinct VERIFIED evidence files. Each command file SHALL include the authoritative positive `expected_file_version` from Complete output.

#### Scenario: Up to three evidence files verify
- **WHEN** one, two, or three selected evidence files complete verification
- **THEN** only their object IDs and verified versions enter the review command.

#### Scenario: Zero, more than three, duplicate, or unverified files
- **WHEN** selection violates the business limit despite the generic uploader supporting more files
- **THEN** review submit remains blocked without weakening the generic Client or sending extra file identifiers.

### Requirement: Initial review submission follows the Contract
Initial submission SHALL call `POST /api/buyer-portal/reviews` with `formal_order_id`, `expected_version=0`, exact `review_type`, nullable `review_url`, one-to-three `evidence_files`, optional Buyer note, and one logical-operation idempotency key.

#### Scenario: Review submission succeeds
- **WHEN** the returned formal order is eligible and the command is accepted
- **THEN** the returned review detail becomes authoritative and eligibility, review list/detail, dashboard, and related file state are precisely refreshed.

#### Scenario: Review type, order, file, or existing-review conflict
- **WHEN** the API returns validation, hidden not-found, state conflict, existing review, or file conflict
- **THEN** the UI shows only the safe error/request ID and never leaks another Buyer, Seller, or storage fact.

### Requirement: Review list and detail preserve states and public facts
The review list/detail SHALL display order summary including the distinct nullable-read-model `amazon_order_date`, review type, PENDING_REVIEW, CHANGES_REQUESTED, REJECTED, WITHDRAWN, or APPROVED, versions, submit/update/approval times, public change reason, review URL, refund due, file count/files, and `allowed_actions` from the DTO. Historical NULL date remains unknown; it is never replaced with confirmation/submission timestamps or `confirmed_business_date`.

#### Scenario: Review detail loads
- **WHEN** a valid DTO is returned
- **THEN** status text, public reason, files, due fact, and allowed actions are rendered exactly from it.

#### Scenario: Approved/due or state/action projection is malformed
- **WHEN** runtime validation finds incoherent approval, due, file, or action fields
- **THEN** the page fails closed instead of fabricating an action or financial state.

### Requirement: CHANGES_REQUESTED drives resubmission
RESUBMIT SHALL be offered only when present in `allowed_actions`; the page SHALL display `public_change_reason` before editing and call `POST /api/buyer-portal/reviews/:id/resubmit` with the latest positive expected version and complete current form payload.

#### Scenario: Requested review changes are resubmitted
- **WHEN** the Buyer addresses the public reason and submits a valid current payload
- **THEN** the returned PENDING_REVIEW detail replaces the old state and precisely related queries refresh.

#### Scenario: Reason is absent or version conflicts
- **WHEN** a CHANGES_REQUESTED DTO lacks its public reason or another change wins
- **THEN** the UI fails closed or refetches without silent overwrite or automatic mutation retry.

### Requirement: Review withdrawal follows allowed actions
WITHDRAW SHALL be offered only when present in `allowed_actions` and SHALL call `POST /api/buyer-portal/reviews/:id/withdraw` with latest positive `expected_version`, a fresh logical-operation idempotency key, and explicit Buyer confirmation.

#### Scenario: Pending review is withdrawn
- **WHEN** the Buyer confirms an allowed withdrawal
- **THEN** returned WITHDRAWN detail is shown and eligibility/list/dashboard keys are precisely invalidated.

#### Scenario: Withdrawal is unavailable or conflicts
- **WHEN** action is absent, status is terminal, or version changed
- **THEN** the control is absent or the conflict requires refresh without duplicate submission.

### Requirement: Review files use the specialized read-intent route
Each review file SHALL use `BuyerReviewFileReadIntentAdapter` with validated review ID, `file_entity_link_id`, positive `version`, and CREATE_READ_INTENT action. The adapter SHALL construct `POST /api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent` from those entity IDs and send `expected_file_version`; it SHALL NOT accept or forward an arbitrary DTO path. Only intent creation changes; the short token is consumed through the existing Wave14A bounded content/header/401/Object-URL transport.

#### Scenario: Review evidence is viewed
- **WHEN** the specialized read intent returns a first-use token
- **THEN** the file is displayed from ephemeral bytes and its Object URL is released at lifecycle end.

#### Scenario: Version, audience, token, or bytes fail
- **WHEN** the API returns conflict/not-found/forbidden or content validation fails
- **THEN** no permanent URL, storage object key, or retained token is exposed and the documented explicit restart path is used.

### Requirement: Approved review shows immutable refund due
An APPROVED review SHALL display `buyer_refund_due.amount_cny_fen` and `became_due_at` as a read-only server fact and provide a contextual refund-list link. It SHALL not present payment controls or infer current refund balance.

#### Scenario: Approved review has due fact
- **WHEN** the DTO contains a valid refund due
- **THEN** the amount is formatted as CNY from integer fen and linked only to the separately loaded refund area.

#### Scenario: Non-approved review or missing refund object
- **WHEN** status is not APPROVED or no separate refund obligation is returned
- **THEN** no due/payment state is invented and review content remains readable.
