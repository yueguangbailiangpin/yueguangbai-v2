# Seller Formal-Order Chat Screenshot Requirements

## ADDED Requirements

### Requirement: Chat screenshots reuse the approved purpose and bind to a formal order

The system SHALL use only `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` for this capability and SHALL display it as `聊天截图`. A new screenshot SHALL be attached only through a formal-order-specific command that derives the order's immutable evidence submission relation; no generic Link or Grant API SHALL accept the association.

#### Scenario: Staff attaches a verified screenshot to a formal order

- **WHEN** an authorized Staff submits an owned VERIFIED image with the exact purpose, `SELLER_VISIBLE` visibility, expected file version and Idempotency-Key to the formal-order chat-screenshot command
- **THEN** the command creates at most one attachment for that formal order, an explicit Seller Organization audience, audit/outbox evidence and idempotency completion in one transaction.

#### Scenario: Wrong order, file or duplicate

- **WHEN** the target is not a current formal order, the file is missing/unverified/wrong-purpose/wrong-visibility/not Staff-owned/stale, or the order already has an attachment
- **THEN** the command fails without a usable link, audience, attachment, audit or outbox side effect.

### Requirement: Seller access follows current organization and Store scope

Seller reads SHALL require the current active Seller account, identity subject, member, organization and explicit audience. OWNER members MAY read active Stores in their organization; other members MAY read only active Stores with a current active Store scope. The checks SHALL run at both read-intent creation and byte consumption.

#### Scenario: Authorized same-organization Store read

- **WHEN** a Seller member with current access to the formal order's Store requests the order's chat screenshot
- **THEN** the service returns a short-lived read intent and the existing protected read flow can return the image once.

#### Scenario: Cross-organization, cross-Store or revoked access

- **WHEN** another organization, an unscoped Store member, a disabled member/account/organization, or a member after Store-scope revocation requests or consumes the screenshot
- **THEN** no bytes are returned and the resource is concealed without disclosing file existence, object key or permanent URL.

### Requirement: File HTTP is purpose-bound and storage-safe

The system SHALL expose only the fixed Staff upload-intent route for this purpose with `SELLER_VISIBLE` visibility. Upload, completion, link and read operations SHALL derive all authority server-side, SHALL preserve existing compensation and idempotency behavior, and SHALL never expose an R2 object key, permanent URL, Drive id or reusable token.

#### Scenario: Fixed upload route

- **WHEN** Staff with current `ORDER_CONFIRM` invokes the chat-screenshot upload-intent route
- **THEN** the server creates an owned image intent for the approved purpose and fixed visibility; client purpose, visibility, owner and audience fields are not accepted.

#### Scenario: Generic or deferred route probe

- **WHEN** a client calls a generic Link/Grant endpoint or the removed submission-only internal route
- **THEN** no such route creates a business fact, and the request does not reveal another order's file metadata.

### Requirement: Read intents are short-lived, single-use and fresh-authorized

The Seller formal-order chat-screenshot read route SHALL require the current order scope, expected file version and Idempotency-Key, and SHALL use the existing one-time read token. Consumption SHALL require the same Seller actor, an unexpired ISSUED intent and fresh authorization.

#### Scenario: Expiry or replay

- **WHEN** a read intent is expired, consumed, revoked, used by another actor, or its current audience/scope is no longer valid
- **THEN** the service returns no image bytes and does not return a replacement reusable token.

### Requirement: Seller order lists are lazy and migration-tolerant

The Seller `订单与业务完成` projection SHALL include a per-order chat screenshot status without loading image bytes. The UI SHALL load the image only after an explicit detail/expand action, use identity-separated cache keys, and show `暂无聊天截图` for absent historical files without blocking order display.

#### Scenario: List and lazy detail

- **WHEN** the Seller opens the formal-order list
- **THEN** each visible order shows `聊天截图` status and no read-intent or image request is made; after expansion, only that order requests a protected read intent.

#### Scenario: Missing historical screenshot

- **WHEN** a formal order has no current Seller-visible chat screenshot
- **THEN** the list and expanded detail show `暂无聊天截图`, while all existing order and business-completion facts remain available.

### Requirement: Arrival images and unrelated business semantics remain unchanged

This Change SHALL NOT model, import, display or expose 到货图, and SHALL NOT change amount, order, settlement, review or other evidence semantics.

#### Scenario: Unrelated evidence and financial projection

- **WHEN** the Seller reads an order with other evidence or financial completion facts
- **THEN** those existing projections remain unchanged and no arrival-image field or second chat-screenshot purpose is present.
