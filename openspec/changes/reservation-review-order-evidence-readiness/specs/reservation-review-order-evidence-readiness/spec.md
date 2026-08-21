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

### Requirement: returning to a mounted Staff tab does not replace the page with session loading

The Staff session MUST still be verified on the first protected mount, and explicit session invalidation MUST still clear protected state. Merely returning focus to an already mounted Staff tab MUST NOT refetch the session or replace the current page with a full-screen loading state.

#### Scenario: Staff switches away and returns to the tab

- **WHEN** an authenticated Staff tab loses focus and later regains focus without a session-invalidated event
- **THEN** the mounted Staff page remains visible and no additional session request is issued.

### Requirement: newly saved sellers remain visible before portal registration

Saving a new Seller customer MUST create the Seller organization once and MUST expose that organization in the Seller customer directory even when no Seller portal member has registered yet. A repeated save for the same WeChat and marketplace MUST explain that the customer already exists instead of presenting a generic save failure.

#### Scenario: Staff saves a new Seller and has not issued or completed registration

- **WHEN** the Seller Lead and linked Seller organization are committed without an active Seller member
- **THEN** the Seller directory shows that organization with website account status “未开通”.

#### Scenario: Staff opens the website account from the Seller directory

- **WHEN** Staff selects “生成卖家开通链接” for an unregistered Seller
- **THEN** the system either returns a new one-time registration link or requires the existing unrecoverable active invitation to be revoked before a replacement link is generated.

### Requirement: Seller stores can be authorized before the first product application

Every active Seller member MUST be able to create an ACTIVE Store only inside their own Seller organization. Active Staff whose effective permissions contain `SELLER_MANAGE` MUST be able to create a Store for a Seller organization inside their current Marketplace and Seller scope. Store creation MUST retain idempotency, authoritative organization scope, audit and duplicate-name protection.

#### Scenario: Seller creates the first Store

- **WHEN** a Seller member has no authorized Store and creates one before the first product application
- **THEN** the Store becomes selectable in that Seller organization and the product application form is shown with the only available Store selected automatically.

#### Scenario: Staff creates a Store from the Seller directory

- **WHEN** scoped Staff with effective `SELLER_MANAGE` creates a Store for a Seller directory record
- **THEN** the Store belongs to that exact Seller organization and becomes visible to its Seller members after refresh.

#### Scenario: Seller has no authorized Store

- **WHEN** a Seller member opens the product application page with no selectable Store
- **THEN** the page does not present an unusable product form and instead provides Store creation to that Seller member.

### Requirement: every image and evidence entry supports the same selection interactions

Every current Buyer, Seller and Staff image or evidence file entry MUST support file-picker selection, drag and drop, clipboard image paste, selected-file preview and individual removal. The shared interaction MUST preserve the entry's existing MIME, maximum byte size, maximum file count and business submission rules, and MUST NOT bypass the existing upload intent, verification, authorization or compensation flow.

#### Scenario: a user pastes or drags an allowed image

- **WHEN** the user focuses an image entry and pastes a clipboard image, or drags an allowed image onto that entry
- **THEN** the image is selected exactly as if it came from the native file picker and is shown in the removable preview list.

#### Scenario: an unsupported or excessive file is supplied

- **WHEN** the file MIME, byte size or resulting file count exceeds that entry's existing policy
- **THEN** the file is rejected or bounded before upload and the user receives an explicit local message without starting the upload workflow for the rejected file.

### Requirement: mounted Buyer primary navigation remains interactive

The mounted Buyer portal MUST keep the bottom navigation interactive across repeated route changes and window focus changes. Every lazy route transition MUST receive a fresh route boundary so stale loading or error state cannot retain the previous page.

#### Scenario: Buyer alternates between Tasks and Me

- **WHEN** an authenticated Buyer selects Tasks, Me, Tasks, and Me without reloading the browser
- **THEN** each selected page is rendered and returning window focus does not issue an additional session request.

### Requirement: rebuilt staging has an explicit Staff assignment fallback

The isolated staging first-Owner bootstrap MUST explicitly configure its single active Owner as the `JP` assignment fallback in the same atomic and idempotent batch. It MUST NOT create a Marketplace Scope, infer an arbitrary Owner, change production initialization or weaken work-item integrity.

#### Scenario: the first Seller product application creates a review task

- **WHEN** staging has been rebuilt, only the bootstrapped Owner exists, and a Seller submits a valid product application
- **THEN** the application and its review work item are committed atomically with the explicit staging Owner fallback as assignee.

#### Scenario: bootstrap fails after preparing the fallback

- **WHEN** any later statement in the staging first-Owner bootstrap batch fails
- **THEN** the Owner, role, email identity, assignment fallback, synthetic Buyer channel, authorization event and audit fact are all rolled back together.
