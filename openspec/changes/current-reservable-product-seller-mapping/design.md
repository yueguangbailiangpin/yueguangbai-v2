## Local projection boundary

本 Change 只修改当前预约产品/卖家本地预览逻辑，不改变 D1 schema 或预约 API。当前两个工作表是白名单来源；历史文件只用于卖家与来源留痕。

归一化后应用 owner-confirmed availability overlay：暂停行和飞利浦空白异常行返回 `EXCLUDED`；Somiso JP 的实时四行若携带 `B0GR5C43PG` 则按产品键去重；`B0GRMRV64K` 的 `dDUYsBOrYoEk:shiguo0317` 只进入 `excludedSellerOfferings`，不进入可用供给。

实时刷新后的精确行号、定位和完整 manifest hash 尚未在本地提供，不在此处虚构。

## Staging import plan boundary

`staging-import-plan.ts` consumes the read-only live manifest and emits a
deterministic JSON plan only. It includes all current standard products (the
observed live manifest yields 92), but creates an eligible candidate for each
current source row only when the seller is mapped, the current row is active,
and `orderTotal` is a positive integer. Same-ASIN rows are never merged when
their order totals or review requirements differ. Missing mappings and
invalid/empty totals are listed with explicit reasons.

The plan carries stable, idempotent IDs for seller organizations, stores,
standard products, offerings, product versions, and each source-row task. It
also carries legacy reservation runtime fields (`openAt`, reservation
deadline, order deadline, organization/store keys, product version, status).
The two `JP_RAKUTEN` identities (`R-1` and `S-1`) remain in
`platformProductIdentities` as source data, but are explicitly marked
`UNSUPPORTED_RUNTIME_MARKETPLACE` and produce no legacy product, version,
offering, or reservation task because the old runtime requires ten-character
Amazon ASINs.
Review requirements are parsed as image-only → `IMAGE`, text-only → `TEXT`,
explicit `n单图评/n单文评` → two tasks, and otherwise a marked conservative
`TEXT` fallback. No database or Cloudflare write is performed.

`staging-import-sql.ts` emits, but never executes, an idempotent D1 SQL
transaction. It writes all Amazon `standard_products`, only mapped Amazon
offerings and their legacy product/version rows, and published demand batch
plus product/demand/audit traces. Rakuten emits only
`platform_product_identities`. Seller identities use stable imported IDs and
a reserved high sequence range; `seller_channels.next_sequence` is never
updated, so rerunning the plan does not allocate another seller.
