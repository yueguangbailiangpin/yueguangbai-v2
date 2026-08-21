# Reservation review and order evidence readiness

## ADDED Requirements

### Requirement: assigned Staff can identify the reservation buyer

The reservation review context MUST return the buyer internal ID, display name, nullable customer number, and nullable active WeChat only after the existing assignment and seller-organization scope checks succeed. The UI MUST explain that a missing customer number is generated after the first formal order.

#### Scenario: new buyer has no customer number

- **WHEN** an authorized assigned Staff member opens a reservation for a buyer whose customer number is null
- **THEN** the review shows the buyer name, WeChat and internal ID, and shows “首次正式订单后生成” instead of a fabricated number.

#### Scenario: unrelated Staff cannot read buyer identity

- **WHEN** a Staff member lacks the assigned work item or seller-organization scope
- **THEN** the existing not-found or forbidden response is preserved and no buyer identity fields are returned.

### Requirement: successful reservation decisions do not become false failures

After a reservation decision succeeds, the frontend MUST close the current work item locally and refresh the queue without refetching completed reservation-review facts. A real API failure MUST show its safe error code and request ID when available.

#### Scenario: approval creates the next workflow item

- **WHEN** the reservation decision command succeeds and completes the review work item
- **THEN** the current panel closes, the queue refreshes, and a follow-up 404 cannot replace the success with an error.

### Requirement: order evidence begins only after instruction publication

The buyer eligible-reservation read model MUST require an `ACTIVE` order instruction bound to the same reservation, buyer customer, and marketplace. The submission command MUST retain its authoritative instruction checks.

#### Scenario: instruction is not published

- **WHEN** a reservation is approved but its instruction is `UNPUBLISHED`, `EXPIRED`, or `CANCELLED`
- **THEN** the reservation is absent from the buyer's eligible order-evidence list.

#### Scenario: instruction is active

- **WHEN** an approved reservation has a matching `ACTIVE` instruction and no final evidence submission
- **THEN** it is visible with the allowed submit or resubmit action.

### Requirement: staging can generate validated keyword PNG assets

The staging main Worker MUST call a private service-bound generator authenticated by a separate shared secret. The generator MUST load its CJK font from staging R2, return PNG only, expose a bounded generator version, and send no keyword plaintext to a third-party service. Existing application-side PNG, hash, metadata and storage validation MUST remain authoritative.

#### Scenario: generator dependencies are present

- **WHEN** Staff prepares assets for an unpublished instruction with configured keywords
- **THEN** the internal generator returns one validated PNG per ordered keyword and the asset batch becomes ready.

#### Scenario: binding, secret or font is unavailable

- **WHEN** any generator dependency is missing or invalid
- **THEN** preparation fails closed without publishing the instruction or exposing keyword plaintext.

### Requirement: customer intake explains and scopes site selection

The customer-intake form MUST derive selectable sites from channels available to the current role. It MUST restrict the channel selector to the selected site. When no channel is available, it MUST show an explicit setup message and disable submission instead of rendering an unexplained blank selector.

#### Scenario: rebuilt staging has no acquisition channel

- **WHEN** an authorized Staff member opens customer intake before a matching acquisition channel is configured
- **THEN** the site selector shows “暂无可用站点”, the page explains that a channel must be configured, and the save action is disabled.

#### Scenario: multiple sites have intake channels

- **WHEN** Staff changes the selected site
- **THEN** the channel selector contains only channels bound to that site.
