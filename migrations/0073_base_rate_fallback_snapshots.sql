-- 0073: base-rate fallback for missing order dates.  A confirmation may now
-- freeze the most recent already-effective confirmed rate when the Amazon
-- order date itself has none (weekends / holidays).  The three snapshot
-- guards previously required the frozen rate's business date to EQUAL the
-- order date; they now require it to be on or before the order date, which
-- is the invariant the fallback resolver maintains.  Historical rows are
-- untouched.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=72 THEN 1 ELSE 0 END;

DROP TRIGGER trg_seller_principal_rate_snapshot_guard;
CREATE TRIGGER trg_seller_principal_rate_snapshot_guard
BEFORE INSERT ON seller_principal_rate_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM formal_orders formal_order
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.amazon_order_date=NEW.platform_order_date
    AND formal_order.final_paid_jpy=NEW.payment_amount_minor
    AND (
      (NEW.policy_scope_type='CURRENCY_PAIR_DEFAULT'
        AND NEW.policy_seller_organization_id IS NULL)
      OR (NEW.policy_scope_type='SELLER_ORGANIZATION'
        AND NEW.policy_seller_organization_id IS formal_order.seller_organization_id)
    )
)
OR NEW.base_rate_business_date>NEW.platform_order_date
OR NOT EXISTS (
  SELECT 1 FROM buyer_daily_currency_rate_versions rate
  WHERE rate.id=NEW.base_rate_version_id
    AND rate.business_date=NEW.base_rate_business_date
    AND rate.source_currency_code=NEW.payment_currency_code
    AND rate.quote_currency_code='CNY'
    AND rate.status='CONFIRMED'
    AND rate.rate_value=NEW.base_rate_value
    AND rate.rate_scale=NEW.base_rate_scale
    AND rate.confirmed_at=NEW.base_rate_confirmed_at
    AND rate.confirmed_at<=NEW.created_at
)
OR NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_versions policy
  WHERE policy.id=NEW.policy_version_id
    AND policy.scope_type=NEW.policy_scope_type
    AND policy.seller_organization_id IS NEW.policy_seller_organization_id
    AND policy.version_no=NEW.policy_version_no
    AND policy.source_currency_code=NEW.payment_currency_code
    AND policy.quote_currency_code='CNY'
    AND policy.status='CONFIRMED'
    AND policy.markup_rate_value=NEW.markup_rate_value
    AND policy.rate_scale=NEW.markup_rate_scale
    AND policy.effective_from=NEW.policy_effective_from
    AND policy.confirmed_at=NEW.policy_confirmed_at
    AND policy.effective_from<=NEW.created_at
    AND policy.confirmed_at<=NEW.created_at
)
OR NEW.final_rate_value<>NEW.base_rate_value+NEW.markup_rate_value
OR NEW.base_rate_value > 9007199254740991-NEW.markup_rate_value
OR CASE
  /*
   * HALF_UP(payment * final_rate / 1,000,000), without multiplying the two
   * large SQLite INTEGER operands directly.  Split both operands into
   * quotient/remainder parts and reject every intermediate overflow before
   * evaluating the corresponding product.
   */
  WHEN (NEW.payment_amount_minor / 1000000)
      > (9007199254740991 / NEW.final_rate_value) THEN 1
  WHEN (NEW.final_rate_value / 1000000) > 0
    AND (NEW.payment_amount_minor % 1000000)
      > (9007199254740991 / (NEW.final_rate_value / 1000000)) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
      > 9007199254740991
        - ((NEW.payment_amount_minor % 1000000)
          * (NEW.final_rate_value / 1000000)) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
    + ((NEW.payment_amount_minor % 1000000)
      * (NEW.final_rate_value / 1000000))
    > 9007199254740991
      - (((NEW.payment_amount_minor % 1000000)
        * (NEW.final_rate_value % 1000000) + 500000) / 1000000) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
    + ((NEW.payment_amount_minor % 1000000)
      * (NEW.final_rate_value / 1000000))
    + (((NEW.payment_amount_minor % 1000000)
      * (NEW.final_rate_value % 1000000) + 500000) / 1000000)
    <> NEW.seller_expected_principal_amount_minor THEN 1
  ELSE 0
END=1
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshot_source_mismatch');
END;

DROP TRIGGER trg_formal_order_financial_snapshot_guard;
CREATE TRIGGER trg_formal_order_financial_snapshot_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND NEW.buyer_rate_business_date<=formal_order.amazon_order_date
      AND formal_order.confirmed_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_daily_exchange_rates rate
    WHERE rate.id=NEW.buyer_rate_version_id
      AND rate.business_date=NEW.buyer_rate_business_date
      AND rate.version_no=NEW.buyer_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.cny_per_jpy_e8=NEW.buyer_cny_per_jpy_e8
      AND rate.confirmed_at=NEW.buyer_rate_confirmed_at
      AND rate.confirmed_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    JOIN seller_service_fee_versions fee
      ON fee.organization_id=formal_order.seller_organization_id
      AND fee.review_type=formal_order.review_type
    WHERE formal_order.id=NEW.formal_order_id
      AND fee.id=NEW.service_fee_version_id
      AND fee.version_no=NEW.service_fee_version_no
      AND fee.status='CONFIRMED'
      AND fee.fee_cny_fen=NEW.service_fee_cny_fen
      AND fee.effective_from=NEW.service_fee_effective_from
      AND fee.confirmed_at=NEW.service_fee_confirmed_at
      AND fee.effective_from<=NEW.created_at
      AND fee.confirmed_at<=NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_financial_snapshot_source_mismatch');
END;

DROP TRIGGER trg_formal_order_marketplace_money_source_guard;
CREATE TRIGGER trg_formal_order_marketplace_money_source_guard
BEFORE INSERT ON formal_order_marketplace_money_snapshots
WHEN
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.buyer_customer_id=NEW.buyer_customer_id
      AND formal_order.seller_organization_id=NEW.seller_organization_id
      AND formal_order.store_id=NEW.store_id
      AND formal_order.review_type=NEW.review_type
      AND formal_order.amazon_order_number_normalized=NEW.platform_order_identifier
      AND formal_order.asin_normalized=NEW.platform_product_identifier
      AND formal_order.amazon_order_date=NEW.platform_order_date
      AND formal_order.final_paid_jpy=NEW.payment_amount_minor
      AND formal_order.confirmed_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_marketplace_assignments buyer
    WHERE buyer.buyer_customer_id=NEW.buyer_customer_id
      AND buyer.marketplace_code=NEW.marketplace_code
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_store_marketplaces store
    WHERE store.store_id=NEW.store_id
      AND store.seller_organization_id=NEW.seller_organization_id
      AND store.marketplace_code=NEW.marketplace_code
  )
  OR NOT EXISTS (
    SELECT 1 FROM marketplace_registry marketplace
    JOIN currencies currency ON currency.code=marketplace.transaction_currency_code
    WHERE marketplace.code=NEW.marketplace_code
      AND marketplace.status='ACTIVE'
      AND marketplace.adapter_status='AVAILABLE'
      AND marketplace.transaction_currency_code=NEW.payment_currency_code
      AND currency.exponent=NEW.payment_currency_exponent
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_daily_currency_rate_versions rate
    WHERE rate.id=NEW.buyer_rate_version_id
      AND rate.business_date<=NEW.platform_order_date
      AND rate.version_no=NEW.buyer_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.source_currency_code=NEW.source_currency_code
      AND rate.quote_currency_code=NEW.quote_currency_code
      AND rate.rate_value=NEW.buyer_rate_value
      AND rate.rate_scale=NEW.buyer_rate_scale
      AND rate.rounding_rule=NEW.rounding_rule
      AND rate.confirmed_at=NEW.buyer_rate_confirmed_at
      AND rate.confirmed_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_principal_rate_snapshots principal
    WHERE principal.formal_order_id=NEW.formal_order_id
      AND principal.platform_order_date=NEW.platform_order_date
      AND principal.payment_amount_minor=NEW.payment_amount_minor
      AND principal.payment_currency_code=NEW.payment_currency_code
      AND principal.rounding_rule=NEW.rounding_rule
      AND principal.seller_expected_principal_amount_minor=NEW.seller_expected_principal_amount_minor
      AND principal.created_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_service_fee_rule_versions fee
    WHERE fee.id=NEW.service_fee_rule_version_id
      AND fee.seller_organization_id=NEW.seller_organization_id
      AND fee.marketplace_code=NEW.marketplace_code
      AND fee.review_type=NEW.review_type
      AND fee.version_no=NEW.service_fee_rule_version_no
      AND fee.status='CONFIRMED'
      AND fee.fee_amount_minor=NEW.service_fee_amount_minor
      AND fee.fee_currency_code=NEW.service_fee_currency_code
      AND fee.effective_from=NEW.service_fee_effective_from
      AND fee.confirmed_at=NEW.service_fee_confirmed_at
      AND fee.effective_from<=NEW.created_at
      AND fee.confirmed_at<=NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_marketplace_money_source_mismatch');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type='trigger' AND name IN (
      'trg_seller_principal_rate_snapshot_guard',
      'trg_formal_order_financial_snapshot_guard',
      'trg_formal_order_marketplace_money_source_guard'))=3
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=73,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=72;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
