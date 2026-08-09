# Change Proposal: Historical Order Master and Chat Screenshot Migration

## Why

The historical order master contains auditable order-line, refund, product and screenshot facts, but it is not a production import manifest. A local, deterministic boundary is required before any future order or file import can be reviewed. The existing current-product/seller mapping is only a current whitelist projection and does not prove that every historical shop/product row belongs to the same Seller Organization or Store.

## What Changes

- Add a local-only generator for the `数据母表` worksheet of `数据订单汇总.xlsx`, guarded by the frozen SHA-256.
- Emit one complete JSONL record for every one of the 16,304 non-empty source rows, with stable row keys, raw text provenance, order/order-line identity, refund dual status, lifecycle status, product and current-mapping result, seller-binding guard, chat-image plan and isolation reasons.
- Reconcile marketplace-aware valid order rows, unique `(marketplace_code, platform_order_identifier)` identities, conflicting duplicate groups and exact duplicate source facts without silently deduplicating order lines.
- Keep `order_number_key` on every recognized order, but emit `duplicate_group_key` only when the marketplace-aware group has more than one source row; unique orders use `null`.
- Apply the owner-confirmed platform rules: Amazon `^\d{3}-\d{7}-\d{7}$`, Rakuten `^\d{6}-\d{8}-\d{10}$`, TikTok Japan `^585\d{15}$`, and deterministic Amazon `^\d{3}-\d{14}$` normalization with retained raw value and `NORMALIZED_MISSING_SEPARATOR` provenance. Pure-numeric 17-digit outliers remain unresolved.
- Keep Rakuten and TikTok product identifiers marketplace-aware. TikTok's ten source rows receive the owner-confirmed `tiktokDLP2555Q` product override, canonical `TIKTOKDLP2555Q`, store `Philips`, and Seller Organization `ygbceping:ls381048211`. Both Rakuten and TikTok are local-only candidates: order import, product schema and H-image association plans carry their stable unsupported-registry blockers until a separate marketplace Change is approved.
- Apply the newly frozen blank-refund date cutoff: a blank raw status with order date before `2026-01-01` maps both sides to `REFUNDED`; a date on or after `2026-01-01` maps both sides to `PENDING`; the raw blank remains provenance and does not itself quarantine a date-valid row.
- Map all 51 `催评` rows to buyer `PENDING`, seller `PENDING`, `MAPPED`, `ACTIVE`, basis `OWNER_RULE`, while retaining the raw label in provenance.
- Reuse the latest `current-reservable-product-seller-mapping` reference tables only as a candidate mapping evidence source; unresolved and multi-seller results remain closed.
- Treat H-column media as future `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` / `聊天截图` plans only. Do not extract media bytes. Ignore K-column arrival images permanently for this Change.
- Add local dry-run and negative tests with explicit zero external writes.

## Future Image Import Planning (Not Implemented)

If a later Change is separately approved to import H-column chat images, its local importer SHALL use an S3-compatible client against the R2 endpoint rather than browser-driven one-by-one uploads. Concurrency MUST be configurable; an initial operational suggestion is 8–16 workers, not a Cloudflare fixed limit. Each object SHALL use a stable object key and idempotency guard, upload-time SHA-256 plus post-upload `HEAD`/metadata receipt verification, durable checkpointing, exponential backoff for 429/5xx, retry-exhaustion compensation, and zero permanent URLs. This is planning only; this Change performs no R2 call.

## Out of Scope

- No production import, D1/R2 write, Tencent Docs write, Excel write, image extraction/upload, Migration execution, deployment, account creation, invitation, provider call, real secret or production-data call.
- No historical order API, Contract, UI or financial authority change.
- No recalculation under seller-principal Migration 0041. Historical monetary values remain source snapshots and the independent historical financial storage decision is deferred to control review.

## Migration

No Migration is created or executed by this Change. The generated manifest is a review artifact, not a D1 import. A later import Change must separately decide and implement marketplace registry/schema/API/UI support for Rakuten and TikTok, resolve the authoritative historical financial representation and formal-order relation, then decide whether a Migration is required.

## Impact

- Adds a Python read-only generator, an OpenSpec capability and repository npm entry points.
- Writes only caller-selected local dry-run output under an ignored directory.
- Leaves the main worktree, remote branch, production resources and source workbook unchanged.
