# Design: Historical Order Master and Chat Screenshot Migration

## Baseline and Source Boundary

The implementation is based on the freshly fetched `origin/main` commit `904c154b66d4acad099c89c0e3719c67837975fe`. The source file is `/Users/yueguangbai/Downloads/数据订单汇总.xlsx` with SHA-256 `c7d0ae7a7169337ed8929f59e7cb78beac4e57be098a5f086970446e6269b937`. Only `数据母表` is read. `进线出单统计` and `进线总计` are excluded by contract.

The generator uses read-only workbook iteration and reads only XLSX drawing XML metadata for image anchors. It does not open `xl/drawings/media/*`, decode image bytes, write the source workbook or call any remote service.

## Manifest and Stable Identity

The output is newline-delimited JSON with exactly one record per non-empty source row. `historical-order-source:data-master:row:<6-digit source row>` is the stable row key. Each row retains normalized and raw source fields, its source worksheet/row, and an `historical-order-line:<source row>` line key. Order identity is marketplace-aware: `(marketplace_code, platform_order_identifier)` is hashed only after classification, while raw identifiers and normalization basis remain in provenance. `order_number_key` identifies every recognized order; `duplicate_group_key` is the same stable identity only when group size is greater than one and is `null` for unique orders. Repeated platform orders retain separate lines. Exact duplicate source facts are quarantined with their source row keys rather than deleted.

The summary includes the manifest SHA-256, source SHA-256, counts, mapping categories, refund counts, image conservation and all external-write counters. A future importer must use the source hash, row key and an import batch marker for idempotency, checkpoint replay and rollback.

## Order, Product and Seller Projection

The structural candidate boundary requires a valid source date, customer number, store, marketplace-aware product identifier, recognized marketplace-aware order identifier and mapped refund status, excluding exact duplicate source facts. Candidate status never means production eligibility. Amazon accepts `^\d{3}-\d{7}-\d{7}$`; Rakuten accepts owner-confirmed `^\d{6}-\d{8}-\d{10}$`; TikTok Japan accepts the source-confirmed owner rule `^585\d{15}$` (10 rows). `^\d{3}-\d{14}$` is deterministically normalized to 3-7-7 with raw value retained and basis `NORMALIZED_MISSING_SEPARATOR`. The 17-digit pure-numeric outlier remains unrecognized.

Products are marketplace-aware. Amazon ASINs remain `JP_AMAZON:<ASIN>`; Rakuten identifiers are retained as `JP_RAKUTEN:<identifier>` and are never forced into ASIN semantics. TikTok's ten blank source product values use owner-confirmed manual identifier `tiktokDLP2555Q`, canonical `TIKTOKDLP2555Q`, local key `JP_TIKTOK:TIKTOKDLP2555Q`, and provenance `OWNER_CONFIRMED`; the owner-confirmed store is `Philips` and Seller Organization is `ygbceping:ls381048211`. The production registry currently supports only `AMAZON_JP`, `AMAZON_US` and `COUPANG_KR`, so TikTok and Rakuten remain local canonical candidates and are never production eligible in this Change. Every Rakuten/TikTok order records its stable `MARKETPLACE_REGISTRY_UNSUPPORTED_*` blocker, every corresponding product records `LOCAL_CANONICAL_CANDIDATE_REGISTRY_UNSUPPORTED`, and every H-image plan records the same marketplace blocker. The latest current-product reference tables remain evidence only. Cross-seller binding fails closed and no production formal binding is created.

## Refund and Lifecycle Projection

Refund mapping has two independent statuses: buyer customer and seller principal. The frozen order-number overrides run before legacy text. `已返款`, cancellation, self-pay, owner-confirmed partial-refund labels, seller non-refund, the 8-7 label, seller-not-refunded text and ordinary wait-refund text each retain their declared basis. All `催评` variants ending in `催评` map to both sides `PENDING`, `MAPPED`, `ACTIVE`, basis `OWNER_RULE`. A blank raw status is mapped by the order-date cutoff: before `2026-01-01` means buyer and seller `REFUNDED`; on or after `2026-01-01` means buyer and seller `PENDING`; the exact boundary `2026-01-01` is inclusive. A date-valid blank row is not isolated for blank status alone. A blank row with an unparseable/missing order date remains isolated by the existing date reason and records an unresolved cutoff basis without guessing. Date prefixes remain raw labels only and never become an imported payment date.

Seller-principal values and statuses are marked as historical source snapshots. The generator does not apply Migration 0041's current rate policy, does not claim Migration 0041 ran, and does not invent a historical financial table.

## Chat Screenshot Plan

H-column image anchors map to the existing `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` purpose and business label `聊天截图`. A candidate row with a valid order gets a deferred association plan; no file link is created until a formal order exists and Seller Organization, Store, Audience and marketplace-registry checks pass. Rakuten and TikTok plans carry their stable unsupported-registry blockers; the ten TikTok rows additionally retain the owner-confirmed `Philips`/product/organization scope. An isolated row remains isolated. The existing short read-intent and Seller lazy-load boundary is named as the future consume path. K-column images are counted for conservation and marked `IGNORE_DO_NOT_MODEL_DO_NOT_IMPORT`. Order, review and refund screenshots are never relabeled as chat screenshots.

### Future R2 Import Plan (Planning Only)

The future H-column importer, if separately approved, SHALL run as a local batch tool using the R2 S3-compatible API. It SHALL NOT use browser automation or one-by-one manual upload. Worker concurrency SHALL be a runtime-configurable setting; the initial suggestion is 8–16 workers as an operational starting point, not a Cloudflare fixed concurrency limit. Each source row/image anchor SHALL derive a stable object key and idempotency identity. The importer SHALL calculate a per-object SHA-256, upload with bounded retries, verify the response with an object `HEAD`/metadata receipt and SHA-256 comparison, persist checkpoints before advancing, exponentially back off 429/5xx responses, record retry-exhaustion compensation, and never expose a permanent URL. Formal-order association and Seller Audience authorization remain separate guarded steps after object verification. No part of this plan executes in the current Change.

## Migration, Rollback and External Boundary

This Change has no Migration and no production importer. A later reviewed Change must first decide marketplace registry/schema/API/UI support for Rakuten and TikTok, then implement any required Migration separately. Any importer must use source-hash/row-key idempotency, exact-duplicate policy, image fingerprint guards, deterministic checkpoints, batch-scoped rollback and cross-Seller rejection. Until those decisions and approvals exist, production import remains `NOT_EXECUTED` and the independent historical financial storage decision remains open.

All dry-run counters for external calls, Tencent Docs, database, R2, image-byte extraction, Migration and deployment are explicit zero. Local output is the only allowed write. The repository entry uses Python 3 standard-library XLSX ZIP/XML parsing and has no third-party runtime dependency.
