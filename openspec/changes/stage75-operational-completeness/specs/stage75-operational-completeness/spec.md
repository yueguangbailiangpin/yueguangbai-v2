# stage75-operational-completeness Specification

## ADDED Requirements

### Requirement: Staff formal order cursor list

`GET /api/staff/formal-orders` MUST support two modes. When the query string contains exactly the single parameter `amazon_order_number`, the endpoint MUST behave identically to the current order-number lookup (resolve the order and return the unified detail aggregate). In every other case the endpoint MUST return a lightweight list page `{ items, next_cursor }` using stable keyset pagination ordered by `confirmed_at DESC, id DESC` with a default page size of 20 and a maximum of 100, without OFFSET. The list MUST support filtering by Amazon order number prefix, buyer customer number, seller organization, store, business stage, exception state, responsible staff, and confirmed-at date range, and MUST reject unknown or repeated parameters with 400. The cursor MUST embed the filter echo and the server MUST reject with 400 a cursor replayed against different filters. List item amounts MUST come from backend authoritative integer snapshot values as decimal strings and MUST NOT be computed by the client.

#### Scenario: Legacy order-number lookup is preserved

- **WHEN** `GET /api/staff/formal-orders?amazon_order_number=<existing>` is called by an authorized staff member
- **THEN** the response is the unified order detail aggregate for that order, identical in shape to `GET /api/staff/formal-orders/:id`.

#### Scenario: Cursor pagination has no duplicates or gaps

- **WHEN** a staff member pages through the full list by following `next_cursor` until it is null
- **THEN** the union of all pages equals the visible order set exactly once per order, in `confirmed_at DESC, id DESC` order.

#### Scenario: Cursor replayed with different filters is rejected

- **WHEN** a cursor obtained under filter set A is sent together with filter set B
- **THEN** the endpoint responds 400 and returns no items.

#### Scenario: Capacity at 20,000 orders

- **WHEN** the list is queried against a database seeded with 20,000 historical orders plus 200 same-day orders across representative filter combinations
- **THEN** first page, deep cursor pages, and filtered queries all return correct results, and `EXPLAIN QUERY PLAN` for each query shows index-driven access without a full table scan of `formal_orders`.

### Requirement: Order visibility follows fixed assignments

The staff order list and the unified order detail MUST enforce the same visibility: the owner sees all orders; a `pre_sales` staff member sees only orders of buyers with an ACTIVE `BUYER_PRE_SALES_OWNER` assignment to that staff member; a `buyer_refund` staff member sees only orders of buyers with an ACTIVE `BUYER_REFUND_OWNER` assignment; a `seller_ops` staff member sees only orders of seller organizations with an ACTIVE `SELLER_ACCOUNT_MANAGER` assignment. Marketplace scope applies in addition. A staff member whose `ORDER_VIEW` permission is denied by Personal DENY receives 403. Orders outside the caller's scope MUST be concealed as 404 on the detail endpoint and simply absent from the list. There MUST NOT be any public pool, claiming, rotation, fallback, or auto-assignment interaction.

#### Scenario: Pre-sales sees only assigned buyers' orders

- **WHEN** a pre-sales staff member lists orders while assigned to buyer X but not buyer Y
- **THEN** the list contains orders of buyer X and no orders of buyer Y, and `GET /api/staff/formal-orders/<Y-order-id>` responds 404.

#### Scenario: Owner sees all orders

- **WHEN** the owner lists orders
- **THEN** orders across all buyers and seller organizations are returned.

#### Scenario: Personal DENY blocks order access

- **WHEN** a staff member with an ACTIVE Personal DENY on `ORDER_VIEW` calls the list or detail endpoint
- **THEN** the endpoint responds 403.

### Requirement: Authoritative order responsibility projection

The unified order detail MUST include a `responsibility` section computed authoritatively by the backend: current business stage (`BUYER_REFUND` while any buyer refund obligation is outstanding, `SELLER_SETTLEMENT` once the buyer side is settled and any seller payable is outstanding, `COMPLETED` when both sides are settled), current responsible staff (from the fixed assignment matching the stage) with public name, responsible role, next action code, next action due time, overdue flag, exception reason for open exceptions, and the action codes the caller may execute. The staff order detail UI MUST render this as a clear "当前负责人 / 下一步" area without duplicating existing title or identity information, and MUST NOT guess any of these values client-side.

#### Scenario: Stage follows refund then settlement

- **WHEN** an order's buyer refund obligation is outstanding
- **THEN** the stage is `BUYER_REFUND` and the responsible staff is the buyer's fixed refund owner; after the refund is fully paid while seller payables remain outstanding, the stage is `SELLER_SETTLEMENT` and the responsible staff is the seller organization's fixed account manager.

#### Scenario: Open exception surfaces with reason

- **WHEN** an order has an exception operational event that is not followed by a `RESOLVED` event
- **THEN** the responsibility section reports exception state OPEN with the latest exception reason and prioritizes the exception next action.

#### Scenario: Overdue flag is authoritative

- **WHEN** the next action due time is in the past
- **THEN** `is_overdue` is true and the UI renders the overdue marker from the backend value only.

### Requirement: Work item SLA metadata and workbench summary

The staff work item read model MUST expose, per item, `sla_due_at` (from the source obligation due date for refund processing, otherwise `created_at` plus the per-type SLA hours published in the domain package), `is_overdue`, `overdue_since`, `next_action`, `responsible_role`, `responsible_staff` (id and display name), and a backend-computed `priority`. A `GET /api/staff/me/work-items/summary` endpoint MUST return the caller's open count, due-today count, overdue count, exception order count, recent work items, and today's due refund amount as a backend-computed integer string visible only to the owner and buyer refund roles (null for others). The workbench UI MUST render these metrics from the endpoint and MUST NOT compute SLA or financial amounts client-side.

#### Scenario: Refund summary restricted to owner and buyer refund

- **WHEN** a pre-sales or seller-ops staff member requests the workbench summary
- **THEN** `refund_due_today_cny_fen` is null and no refund amount is rendered.

#### Scenario: Overdue work item surfaces in workbench

- **WHEN** a visible open work item's SLA due time is in the past
- **THEN** the workbench summary counts it in `overdue_count` and the work item list renders the overdue SLA marker from backend values.

### Requirement: Product primary contact exposure

The existing product primary-contact model (single column on the product, `seller_product_primary_contact_events` audit, `POST /api/staff/products/:id/primary-contact`) MUST remain the only model. Staff catalog product list and detail DTOs and Seller portal product DTOs MUST include `primary_contact_member_id` and `primary_contact_member_name` (nullable). Only an ACTIVE member of the same seller organization may be set; transfer and clear MUST be supported with idempotency key, expected version, and audit events. The primary contact is a responsibility marker only and MUST NOT reduce organization-wide product visibility for seller organization members. Cross-organization access MUST be concealed 404. Owner and the seller organization's assigned seller-ops staff may operate; the Seller portal is read-only for this field.

#### Scenario: Contact restricted to same-organization ACTIVE members

- **WHEN** a staff member sets a product's primary contact to a member of another organization or a non-ACTIVE member
- **THEN** the endpoint responds 409 and the product's contact is unchanged.

#### Scenario: Visibility is not narrowed

- **WHEN** a product has a primary contact set and an ordinary ACTIVE member of the same seller organization browses the seller portal product list
- **THEN** the product remains visible with its primary contact displayed.

#### Scenario: Version conflict on concurrent transfer

- **WHEN** two transfers carry the same expected version
- **THEN** one succeeds and the other responds 409 VERSION_CONFLICT.

### Requirement: Stage-scoped buyer contacts with company service channels

The company public service channel configuration (codes `BUYER_PRE_SALES` and `BUYER_AFTER_SALES`) MUST be stored independently of any staff login identity with public display name, optional WeChat id, and optional QR file reference, seeded with empty values. Only the owner may modify channels, with idempotency, expected version, and audit. The buyer portal MUST expose the channel public fields and the buyer's fixed pre-sales and refund owner public display names (null when unassigned), and the buyer UI MUST show the pre-sales contact on reservation and order-material stages and the after-sales contact on order, review, and refund stages. Buyer DTOs MUST NOT contain staff login emails, internal staff ids, personal WeChat, permissions, or any internal field. When a channel is unconfigured, the UI MUST show the fallback guidance without leaking internal information.

#### Scenario: Unconfigured channel shows fallback

- **WHEN** a buyer views a stage contact card while the channel has an empty WeChat id
- **THEN** the card shows the responsible staff public name (or the unassigned fallback) and the fallback contact guidance, and no staff email, internal id, or personal WeChat appears anywhere in the response payload.

#### Scenario: Only owner can update channels

- **WHEN** a non-owner staff member calls the channel update endpoint
- **THEN** the endpoint responds 403.

#### Scenario: Stage picks the right contact

- **WHEN** a buyer opens a reservation page and then an order refund page
- **THEN** the reservation page shows the pre-sales owner public name with the pre-sales channel and the refund page shows the refund owner public name with the after-sales channel.

### Requirement: Immutable seller settlement batches

Seller settlement batches MUST be an append-only model on top of existing seller payables, payments, and reconciliation facts: draft batches select eligible payables; confirmation freezes membership, integer amounts, and key order snapshot references; cancelled batches release members via cancel events; payments continue through the existing payment ledger without any write-back to historical financial facts. A payable MUST NOT belong to two active batches simultaneously (enforced by a partial unique index). Batch status MUST be computed authoritatively by the backend: `DRAFT`, `CONFIRMED`, `PARTIALLY_PAID`, `PAID` derived from live payment facts, or `CANCELLED`. Every create, member add/remove, confirm, cancel, and export MUST be audited, idempotent (idempotency key with request-hash mismatch rejection), and guarded by expected version and state-machine checks. Confirmed batches MUST NOT silently change members or frozen amounts.

#### Scenario: One payable cannot enter two active batches

- **WHEN** a payable that is an active member of batch A is added to draft batch B
- **THEN** the add is rejected with a conflict and batch B remains unchanged; after batch A is cancelled and its members released, the same payable can join batch B.

#### Scenario: Confirmed batch membership is frozen

- **WHEN** a member add, member remove, or direct frozen-amount update targets a confirmed batch
- **THEN** the operation is rejected by the database and the API, and the frozen total equals the sum of frozen member amounts.

#### Scenario: Paid status is derived from the ledger

- **WHEN** all member payables of a confirmed batch become fully paid through the existing payment allocation ledger
- **THEN** the batch reads `PAID` with payment progress consistent with the ledger, without any status write-back.

#### Scenario: Idempotent confirm replay

- **WHEN** the same confirm request (same idempotency key and body) is replayed
- **THEN** the same batch state is returned without a second state transition or duplicate audit; a different body under the same key responds 409.

### Requirement: Settlement batch authorization and CSV export safety

Batch access MUST follow: owner globally; the seller organization's assigned seller-ops staff within scope for create, confirm, cancel, and export; Seller portal members read-only for their organization's non-draft, non-cancelled batches; buyers never see batches (concealed 404 or absent). Batch DTOs and CSV MUST NOT expose internal profit, buyer refund data, internal staff ids, internal notes, or object storage keys. CSV export MUST use a field whitelist, neutralize formula injection (cells beginning with `=`, `+`, `-`, `@`, TAB, or CR are prefixed), use the stable filename `seller-settlement-batch-{batchId}.csv`, enforce row-count and byte-size limits with an explicit error, and be generated by streaming without loading the full batch into Worker memory.

#### Scenario: Buyer cannot access settlement batches

- **WHEN** a buyer session calls any staff or seller settlement batch endpoint
- **THEN** the response is 401/404 and no batch data is exposed.

#### Scenario: Formula injection is neutralized

- **WHEN** an exported field value begins with `=`, `+`, `-`, `@`, TAB, or CR
- **THEN** the CSV cell is prefixed with a single quote before the value.

#### Scenario: Export limits are enforced

- **WHEN** a batch exceeds the export row or size limit
- **THEN** the export endpoint responds with the `EXPORT_TOO_LARGE` conflict and streams no file.

#### Scenario: Seller sees only safe fields

- **WHEN** a seller portal member opens a confirmed batch detail
- **THEN** the payload contains batch id, status, frozen totals, confirmation time, and per-member order number, type, frozen amount, and payment progress, and contains no profit, buyer, internal staff id, note, or storage key fields.

### Requirement: Residual scan stays clean

After all three batches, the repository runtime code MUST NOT contain public pool, task claiming/robbing, pending-claim centers, acquisition centers, dual chat-screenshot entries, or the retired order-integrity page. Frontend screenshots at 1440px, 1280px, and 390px MUST show no horizontal overflow, no error states impersonating normal states, and all images genuinely decoded.

#### Scenario: Residual scan finds nothing

- **WHEN** the repository runtime sources are scanned for the retired concepts
- **THEN** no runtime references remain outside of negative test assertions and historical archives.

#### Scenario: Responsive screenshots are clean

- **WHEN** the new pages are captured at 1440px, 1280px, and 390px
- **THEN** no horizontal overflow or unexpected error state appears and every rendered image is fully decoded.

## Compatibility note

The later `seller-settlement-read-boundary` Change is the authoritative
endpoint-level follow-up for Seller Portal settlement reads. It narrows the
five legacy financial read endpoints to active `OWNER`/`FINANCE`, preserves the
four-role Seller-safe batch reads, and fixes the Seller batch Buyer boundary to
concealed `404`. This note supersedes only the endpoint-level ambiguity in this
historical Stage 7.5 spec; it does not change the batch state machine, write
authorization, migration scope, or the historical acceptance record above.
