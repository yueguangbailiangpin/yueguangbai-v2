# JP / JPY / Amazon Dependency Inventory

Inventory baseline: `e444e19d0d514a1b45fee0acc1e730c9f142d119`.
Command used: `rg -n "JP|JPY|Amazon|cny_per_jpy_e8|final_paid_jpy|amazon_order" migrations packages apps docs openspec`.

## Schema and constraints

- `migrations/0003_customer_master_data.sql`: legacy `marketplaces` permits only `JP`; Buyer and Seller Organization store that legacy key.
- `migrations/0005_seller_stores_products.sql`: Store/Product Marketplace foreign keys and Marketplace+ASIN uniqueness.
- `migrations/0007_product_applications.sql`, `0008_demand_batches.sql`, `0009_reservations.sql`: JP Marketplace is propagated through the catalog-to-reservation chain.
- `migrations/0011_pricing_rules.sql`: `cny_per_jpy_e8`, JPY-only buyer daily and seller agreement lineages, CNY-fen service fee lineage.
- `migrations/0013_order_evidence.sql`, `0014_formal_orders.sql`, `0021_order_instructions.sql`: explicit `CHECK (marketplace_code='JP')`, Amazon identifiers, `final_paid_jpy` and JPY self-pay facts.
- `migrations/0016_review_workflow.sql` through `0026_financial_export_audit.sql`: CNY-fen refund, seller payable/payment, internal reporting and export facts derived from the locked JP snapshot.
- `migrations/0020_staff_assignment_rules.sql`: Marketplace-keyed assignment fallbacks and cursors.
- `migrations/0028_buyer_amazon_order_date.sql`: Amazon date-only fact and JP source guards.

Historical migrations remain unchanged. Migration 0029 introduces canonical sidecars and exact JP backfill because rebuilding the legacy parent key would require rebuilding almost the complete foreign-key graph and every dependent trigger in one release.

## Contracts and domain

- Legacy Marketplace literals occur in Buyer/Seller portal, order evidence, formal order, refund, review, settlement and staff DTO contracts.
- `packages/domain/src/pricing/fixed-point.ts` is the existing exact JPY→CNY implementation.
- `packages/domain/src/identity/asin.ts` and `amazon-order-number.ts` are Amazon-specific validators.
- Migration 0029 adds stable Marketplace/Currency/Money/Rate/Fee contracts and a platform Adapter boundary while retaining the legacy `JP`, `final_paid_jpy` and `cny_per_jpy_e8` projections for API compatibility.

## API and services

- Buyer contexts, demand/reservation, evidence, formal order, reviews and refunds carry JP scope.
- Seller catalog/store, product application, demand, portal, review and settlement services carry JP scope.
- Existing Pricing services maintain JPY/CNY rates and CNY fees, and compatibility triggers mirror every JP rate/decision into canonical lineages. Canonical commands additionally submit and owner-confirm USD/CNY buyer rates, Seller Organization+currency agreement rates and Organization+Marketplace+Review Type CNY fees.
- Existing formal order and evidence insertions are mirrored into immutable canonical Marketplace/Money snapshots by database triggers. The canonical snapshot command validates Buyer/Store scope, Marketplace currency, confirmed rate/fee versions and BigInt rounding before locking future USD facts.
- Buyer correction has one Staff-only route and requires both `owner` and `BUYER_IDENTITY_HIGH_RISK_MANAGE`. There is no Buyer route and no ordinary-Staff path. Application conditions and a database fact guard reject updates after any Reservation, Evidence, Formal Order, Review or canonical financial snapshot.

## UI

- Buyer and Seller pages are Chinese and display the existing JP/JPY/CNY DTO fields.
- This foundation does not expose US/KR customer workflows or change visible financial labels. No UI route or layout change is required; therefore visual behavior remains the Module 1 baseline.
- Future UI conversion must consume the canonical Money DTO before showing USD/KRW and must be a separately accepted site-opening change.

## Compatibility boundary

- `JP` aliases only to `AMAZON_JP`.
- Existing JP API fields and calculations remain byte/value compatible.
- `AMAZON_US` is registry/Adapter ready but does not imply remote site deployment.
- `COUPANG_KR` is `DISABLED` and its Adapter is `UNAVAILABLE`; all validation fails closed.
