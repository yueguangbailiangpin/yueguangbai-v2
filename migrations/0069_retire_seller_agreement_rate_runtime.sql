PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=68
) THEN 1 ELSE 0 END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM pragma_integrity_check WHERE integrity_check='ok')=1
  AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)
THEN 1 ELSE 0 END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM sqlite_schema WHERE name IN (
    'seller_agreement_rate_versions',
    'seller_agreement_rate_events',
    'seller_agreement_currency_rate_versions',
    'formal_order_financial_snapshots',
    'formal_order_marketplace_money_snapshots',
    'trg_formal_order_financial_snapshot_guard',
    'trg_formal_order_marketplace_money_legacy_insert',
    'trg_formal_order_marketplace_money_source_guard',
    'trg_seller_agreement_currency_rate_legacy_insert',
    'trg_seller_agreement_currency_rate_legacy_update',
    'internal_order_finance_positions',
    'internal_finance_exceptions'
  ))=12
THEN 1 ELSE 0 END;

-- This retirement is authorized only for an empty legacy business stock.
-- Any configured agreement rate, immutable rate event, formal order, or
-- dependent snapshot requires a separately approved reconciliation plan.
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM seller_agreement_rate_versions)=0
  AND (SELECT COUNT(*) FROM seller_agreement_rate_events)=0
  AND (SELECT COUNT(*) FROM seller_agreement_currency_rate_versions)=0
  AND (SELECT COUNT(*) FROM formal_orders)=0
  AND (SELECT COUNT(*) FROM formal_order_financial_snapshots)=0
  AND (SELECT COUNT(*) FROM formal_order_marketplace_money_snapshots)=0
  AND (SELECT COUNT(*) FROM seller_principal_rate_snapshots)=0
  AND (SELECT COUNT(*) FROM formal_order_events)=0
  AND (SELECT COUNT(*) FROM review_cases)=0
  AND (SELECT COUNT(*) FROM review_events)=0
  AND (SELECT COUNT(*) FROM seller_payables)=0
  AND (SELECT COUNT(*) FROM buyer_refund_obligations)=0
  AND (SELECT COUNT(*) FROM buyer_advance_principal_entries)=0
  AND (SELECT COUNT(*) FROM order_archive_closures)=0
  AND NOT EXISTS(
    SELECT 1 FROM audit_events
    WHERE aggregate_type IN (
      'SELLER_AGREEMENT_RATE','SELLER_AGREEMENT_CURRENCY_RATE'
    )
  )
  AND NOT EXISTS(
    SELECT 1 FROM integration_outbox
    WHERE aggregate_type IN (
      'SELLER_AGREEMENT_RATE','SELLER_AGREEMENT_CURRENCY_RATE'
    )
      OR event_type LIKE 'SELLER_AGREEMENT_RATE_%'
      OR event_type LIKE 'SELLER_AGREEMENT_CURRENCY_RATE_%'
  )
  AND NOT EXISTS(
    SELECT 1 FROM command_idempotency_records
    WHERE action IN (
      'SUBMIT_SELLER_AGREEMENT_RATE',
      'CONFIRM_SELLER_AGREEMENT_RATE',
      'REJECT_SELLER_AGREEMENT_RATE',
      'SUBMIT_SELLER_AGREEMENT_CURRENCY_RATE',
      'CONFIRM_SELLER_AGREEMENT_CURRENCY_RATE'
    )
  )
THEN 1 ELSE 0 END;

-- SQLite implements DROP COLUMN by rebuilding the table. Dropping only the
-- two owning triggers that mention the obsolete columns keeps every external
-- FK, view and cross-table trigger continuously resolvable during the rebuild.
DROP TRIGGER trg_formal_order_financial_snapshot_guard;
DROP TRIGGER trg_formal_order_marketplace_money_legacy_insert;
ALTER TABLE formal_order_financial_snapshots
  DROP COLUMN seller_rate_version_id;
ALTER TABLE formal_order_financial_snapshots
  DROP COLUMN seller_rate_version_no;
ALTER TABLE formal_order_financial_snapshots
  DROP COLUMN seller_rate_effective_from;
ALTER TABLE formal_order_financial_snapshots
  DROP COLUMN seller_rate_confirmed_at;
ALTER TABLE formal_order_financial_snapshots
  DROP COLUMN seller_cny_per_jpy_e8;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN (SELECT COUNT(*) FROM formal_order_financial_snapshots)=0
THEN 1 ELSE 0 END;

CREATE TRIGGER trg_formal_order_financial_snapshot_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.confirmed_business_date=NEW.buyer_rate_business_date
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

-- The generic projection keeps the common Buyer/payment/fee facts and points
-- to the sole Seller principal authority by formal_order_id instead of copying
-- a second Seller rate lineage.
DROP TRIGGER trg_formal_order_marketplace_money_source_guard;
ALTER TABLE formal_order_marketplace_money_snapshots
  DROP COLUMN seller_rate_version_id;
ALTER TABLE formal_order_marketplace_money_snapshots
  DROP COLUMN seller_rate_version_no;
ALTER TABLE formal_order_marketplace_money_snapshots
  DROP COLUMN seller_rate_effective_from;
ALTER TABLE formal_order_marketplace_money_snapshots
  DROP COLUMN seller_rate_confirmed_at;
ALTER TABLE formal_order_marketplace_money_snapshots
  DROP COLUMN seller_rate_value;
ALTER TABLE formal_order_marketplace_money_snapshots
  DROP COLUMN seller_rate_scale;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM formal_order_marketplace_money_snapshots)=0
THEN 1 ELSE 0 END;

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
      AND formal_order.amazon_order_number_normalized=
        NEW.platform_order_identifier
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
    JOIN currencies currency
      ON currency.code=marketplace.transaction_currency_code
    WHERE marketplace.code=NEW.marketplace_code
      AND marketplace.status='ACTIVE'
      AND marketplace.adapter_status='AVAILABLE'
      AND marketplace.transaction_currency_code=NEW.payment_currency_code
      AND currency.exponent=NEW.payment_currency_exponent
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_daily_currency_rate_versions rate
    WHERE rate.id=NEW.buyer_rate_version_id
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
      AND principal.seller_expected_principal_amount_minor=
        NEW.seller_expected_principal_amount_minor
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

-- Remove the compatibility projection before its legacy parent, then retire
-- the original immutable event/version pair. Their table triggers and indexes
-- disappear with the owning tables.
DROP TRIGGER trg_seller_agreement_currency_rate_legacy_insert;
DROP TRIGGER trg_seller_agreement_currency_rate_legacy_update;
DROP TABLE seller_agreement_currency_rate_versions;
DROP TABLE seller_agreement_rate_events;
DROP TABLE seller_agreement_rate_versions;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table'
    AND name='formal_order_financial_snapshots')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table'
    AND name='formal_order_marketplace_money_snapshots')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_formal_order_financial_snapshot_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_formal_order_marketplace_money_source_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_review_event_identity_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_seller_payable_source_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_seller_principal_rate_snapshot_confirmation_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_advance_principal_full_payment_amount_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_buyer_marketplace_assignment_fact_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='view'
    AND name='internal_order_finance_positions')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='view'
    AND name='internal_finance_exceptions')
  AND NOT EXISTS(SELECT 1 FROM sqlite_schema
    WHERE name IN (
      'seller_agreement_rate_versions',
      'seller_agreement_rate_events',
      'seller_agreement_currency_rate_versions',
      'trg_formal_order_marketplace_money_legacy_insert'
    ))
  AND NOT EXISTS(
    SELECT 1 FROM pragma_table_info('formal_order_financial_snapshots')
    WHERE name IN (
      'seller_rate_version_id','seller_rate_version_no',
      'seller_rate_effective_from','seller_rate_confirmed_at',
      'seller_cny_per_jpy_e8'
    )
  )
  AND NOT EXISTS(
    SELECT 1 FROM pragma_table_info('formal_order_marketplace_money_snapshots')
    WHERE name IN (
      'seller_rate_version_id','seller_rate_version_no',
      'seller_rate_effective_from','seller_rate_confirmed_at',
      'seller_rate_value','seller_rate_scale'
    )
  )
  AND (SELECT COUNT(*) FROM pragma_integrity_check
    WHERE integrity_check='ok')=1
  AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=69,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=68;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
