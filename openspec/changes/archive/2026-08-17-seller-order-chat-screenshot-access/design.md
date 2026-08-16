# Design: Seller Formal-Order Chat Screenshot Access

## Existing Authority

`formal_orders` is the authoritative order resource. Its immutable `order_evidence_submission_id` is the existing namespace used by `order_evidence_internal_files` and is unique per formal order. New attachment commands first read the formal order and derive the submission id; clients never provide an organization, Store, owner, audience or scope.

The file flow remains `upload intent → upload → VERIFIED → entity link/audience → short read intent`. The link keeps the existing `ORDER_EVIDENCE_SUBMISSION` namespace because the current D1 CHECK contract already binds this purpose to that entity type; `order_evidence_internal_files` supplies the formal-order binding. The new row is `SELLER_VISIBLE`, `EXPLICIT_AUDIENCES`, one slot per order, with one Seller Organization grant.

## Staff Attach Command

`POST /api/staff/formal-orders/:id/chat-screenshot` accepts exactly `file_object_id` and `expected_file_version`, plus `Idempotency-Key`. It requires current `ORDER_CONFIRM`, current Staff Data Scope for the order's Seller Organization, an owned VERIFIED image with the fixed purpose/visibility, and no existing attachment. In one D1 batch it creates the explicit file link, the Seller Organization grant, the existing attachment row, audit/outbox evidence and idempotency completion assertions.

The Staff upload-intent route is fixed to `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` + `SELLER_VISIBLE`. Staff upload permission remains `ORDER_CONFIRM`; the upload route does not accept a client-selected purpose or visibility.

## Seller Read Boundary

The formal-order list/detail projection includes `chat_screenshot.status` (`AVAILABLE` or `NONE`) and the opaque current `file_version` needed for optimistic concurrency. The UI displays only the business status; a Seller does not receive an object key, URL, reusable token or a file identifier in the list. The dedicated read-intent route resolves the formal order, checks the current Seller actor and Store scope, resolves the current Seller-visible row, then calls the existing read service with the exact link id. It returns the existing one-time token shape only.

Explicit Seller reads require all of the following at both read-intent creation and byte consumption:

- active Customer account and identity subject;
- active Seller member and organization;
- the current organization grant and non-revoked link;
- OWNER access to an active organization Store, or an active member Store scope for the order's Store;
- current formal-order/file facts and an unexpired, ISSUED read intent.

This keeps access dynamic after member disable, Store-scope revocation, organization disable, audience revocation or file/link revocation. All concealed resource failures use the existing 404/forbidden behavior and never enumerate another organization or Store.

## Seller Web

`订单与业务完成` keeps the existing business-completion fields and adds a `聊天截图` status field. Each order card shows `已上传` or `暂无聊天截图`; an available item mounts `查看聊天截图` only after the Seller expands that order's screenshot area, and only clicking that protected action invokes the formal-order-specific read-intent route. The existing `FileReadController` owns the ephemeral Object URL and immediately releases it on collapse/unmount. The order list does not issue read intents or download image bytes, preserving lazy loading and identity-scoped query keys.

## Rejected Alternatives

- No new `ARRIVAL_IMAGE` or other screenshot Purpose: the approved purpose already exists and must remain stable for the future H-column mapping.
- No generic Link/Grant route: it would let a caller rebind an opaque file to an arbitrary order or audience.
- No permanent URL or R2 key projection: the existing read-intent boundary already provides the required single-use and no-store semantics.
- No mass migration/backfill: it would touch production business data and is not required for historical orders to render `暂无聊天截图`.
