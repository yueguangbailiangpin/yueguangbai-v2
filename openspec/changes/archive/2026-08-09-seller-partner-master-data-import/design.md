# Design

## Source contract

The importer accepts a manifest whose rows carry an explicit folder ID, source record ID, and source locator. Folder IDs are validated against the four frozen IDs and resolve to the frozen default channel. An optional row channel alias is normalized through the five-channel map; an unknown alias or a conflict with a folder default is quarantined. File names are never used for routing.

The manifest hash covers the canonical normalized input and is the idempotency identity for commit. A second commit of the same hash is a replay; a different manifest cannot reuse the same batch ID.

## Identity and grouping

`group_key = source_folder_id + ":" + normalized_wechat`. This preserves separate organizations for the same WeChat in different folders while coalescing multiple product rows in one folder. Each group receives a system-allocated formal seller code from the channel sequence. Historical source seller codes such as `SELLER-TMP-*` are stored only as source metadata and are never used as formal identifiers.

The migration adds `identity_subject_type` to claims and makes the active/reserved global unique index buyer-only. Seller claims remain unique per identity subject and may repeat across independent seller organizations. Existing rows are backfilled from `customer_identity_subjects`; new seller claim statements must write the explicit subject type.

## Product and reservation layers

`standard_products` is unique by `(marketplace_code, asin_normalized)` and owns canonical ASIN/product facts. `seller_product_offerings` links a seller organization/store to that standard product and carries seller-specific cooperation/status facts. `product_reservation_openings` is a separate projection. Import may mark an offering `ELIGIBLE` only when at least one source row for that exact seller-and-ASIN offering says both currently cooperating and currently reservable; facts from another ASIN in the same seller group cannot make it eligible. It never creates an `OPEN` demand or `product_reservations` row. Existing `products` and reservation tables remain intact for the established reviewed workflow.

## Commit and rollback

Preview is pure and has zero database writes. Commit writes the import batch, source rows, organizations/members/claims, disabled stores, standard products, offerings, and eligibility projection in one database batch. Quarantined rows are recorded but produce no master-data rows. Replaying a committed manifest returns the stored result without new rows.

Rollback is a local operator command in the runbook: only a committed batch with no downstream facts may be marked rolled back, and only its newly created import-owned rows may be removed in dependency order. The migration itself is forward-only in D1; migration rollback means restore from the verified backup before applying the migration, not down-migration.

## Permissions and external boundaries

The importer is an internal Staff `SELLER_MANAGE` operation in the eventual application boundary. This implementation exposes only a local service used by tests/fixtures. It does not call Tencent Docs, Feishu, Drive, Cloudflare, D1 remote, R2, MCP, secrets, or invitation/message APIs.
