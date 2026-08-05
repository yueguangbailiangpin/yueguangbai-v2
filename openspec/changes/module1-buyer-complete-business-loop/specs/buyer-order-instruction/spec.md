# Buyer Order Instruction Capability

## ADDED Requirements

### Requirement: Instruction state is loaded before instruction content
Reservation detail SHALL read `GET /api/buyer-portal/reservations/:id/order-instruction/state` and treat its status, deadlines, evidence status, `can_submit_evidence`, `can_read_images`, and `content_updated` as server authority. Full instruction content SHALL be requested only when the state permits it.

#### Scenario: Active instruction is readable
- **WHEN** state is `ACTIVE` with `can_read_images=true`
- **THEN** the page loads the full instruction and presents current content and allowed next step.

#### Scenario: Instruction is unavailable or terminal
- **WHEN** state is UNPUBLISHED, EXPIRED, CANCELLED, or COMPLETED, or content returns 409/410
- **THEN** the exact unavailable/terminal presentation is shown without exposing a submit action or stale images.

### Requirement: Instruction content uses the Buyer-safe DTO
The instruction page SHALL display product name, store display name, color specification mode, public notes, self-pay estimates, `content_updated`, initial and resubmission deadlines, main image handle, and keyword image handles ordered by `position`. It SHALL not display internal identifiers beyond safe handles or forbidden product/storage fields.

#### Scenario: Current content loads
- **WHEN** a valid active instruction DTO is returned
- **THEN** its main image and ordered keyword placeholders, notes, amounts, and deadlines are rendered from that DTO.

#### Scenario: Content is malformed or updated
- **WHEN** image order/shape violates the Contract or `content_updated=true`
- **THEN** malformed content fails closed, while a valid update is clearly announced rather than merged with cached old content.

### Requirement: Initial and resubmission deadlines remain distinct
The UI SHALL label `initial_deadline_at` as 初始提交期限 and `resubmission_deadline_at` as 修改资料期限. Evidence submission SHALL depend on `can_submit_evidence` and the matching current server deadline, not the demand order deadline alone.

#### Scenario: Initial or change window is active
- **WHEN** the state allows initial submission or CHANGES_REQUESTED resubmission
- **THEN** only the applicable deadline and action are emphasized.

#### Scenario: Deadline is absent or reached
- **WHEN** the applicable deadline is null or current time reaches it
- **THEN** the submit action is unavailable and a refetch is required before any later action.

### Requirement: Instruction images use short read intents
Each image SHALL call only its returned `read_intent_path` with an operation-scoped idempotency key, then consume the resulting token through the Wave14A File Read Client. Access tokens SHALL remain private memory, bytes SHALL stay out of Query cache, and Object URLs SHALL be revoked on replacement, close, unmount, cancellation, or failure.

#### Scenario: Buyer views an authorized image
- **WHEN** a first read intent returns a usable token and bounded bytes
- **THEN** an ephemeral Object URL displays the image and is revoked when its lifecycle ends.

#### Scenario: Read is replayed, expired, denied, or malformed
- **WHEN** no token is available, authorization changes, bytes/header validation fails, or the instruction becomes unreadable
- **THEN** no permanent URL or storage object key is exposed and only the documented explicit restart/retry path is offered.

### Requirement: Instruction cache follows reservation scope
Instruction state and content SHALL use reservation-scoped Buyer Query keys. State SHALL be refreshed after reservation, evidence submit/resubmit/withdraw, and relevant navigation focus without globally invalidating unrelated Buyer data.

#### Scenario: Related evidence changes
- **WHEN** evidence mutation succeeds for a reservation
- **THEN** that reservation's instruction state/content and related dashboard keys are invalidated precisely.

#### Scenario: Another reservation changes
- **WHEN** an unrelated reservation or file operation completes
- **THEN** cached instruction data for other reservation identifiers is not removed without a documented shared dependency.
