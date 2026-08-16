# Change Proposal: Seller Formal-Order Chat Screenshot Access

## Why

Seller staff currently have a historical `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` file purpose, but the only attachment command binds it to an order-evidence submission as `INTERNAL_ONLY`. The Seller formal-order portal therefore cannot show the approved business fact that a concrete formal order has a chat screenshot, nor can it safely read that image.

## What Changes

- Reuse `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` as the single business purpose and display it as `聊天截图`.
- Reuse the existing one-slot `order_evidence_internal_files` ledger, but make its new Staff attachment command target an immutable `formal_orders` row and create a `SELLER_VISIBLE` explicit Seller Organization audience.
- Expose a purpose-bound Staff upload-intent route and a formal-order-specific attach command; no generic Link/Grant endpoint is added.
- Add Seller-safe formal-order screenshot status, a dedicated short-lived read-intent route, and lazy inline image loading in `订单与业务完成`.
- Recalculate Seller Organization membership, active Store scope and file Audience at read-intent creation and byte consumption; conceal cross-organization, cross-store and missing-file probes.

## Out of Scope

- 到货图、任何新截图 Purpose、全量聊天导入、真实母表导入或生产数据写入。
- 金额、订单、结算、评论、Buyer DTO、其他 evidence purpose、Staff MCP、飞书、Drive、Cloudflare production resources or deployment.
- General-purpose file Link/Grant APIs or a Seller upload UI for associating arbitrary files.

## Migration

No new Migration is required. The current schema already has the immutable `formal_orders` ↔ `order_evidence_submission_id` relationship, the one-slot `order_evidence_internal_files` attachment ledger, explicit file audiences and single-use read intents. The implementation uses the formal-order row as the command authority and the existing submission key only as the historical file namespace. Existing `INTERNAL_ONLY` historical rows are not rewritten or mass-promoted; orders without a current Seller-visible row remain `暂无聊天截图`.

## Rollback

Disable the new routes and Seller projection/UI, then restore the previous code. Existing formal orders, uploaded objects, attachment rows, audience events, audit events and idempotency records remain immutable and are not deleted. No remote Migration or resource mutation is part of this Change.
