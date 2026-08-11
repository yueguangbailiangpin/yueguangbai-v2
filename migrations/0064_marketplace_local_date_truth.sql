PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=63
) THEN 1 ELSE 0 END;

-- 0058 initially used the China reporting date as a compatibility fallback for
-- non-+09 marketplaces. That value is not evidence of the Marketplace-local
-- date. Before AMAZON_US becomes a live formal-order writer, clear only the
-- compatibility-shaped value so historical ambiguity is represented as NULL,
-- never as a fabricated local date. New non-JP writers are already required by
-- 0060 to persist marketplace_business_date explicitly.
UPDATE formal_orders
SET marketplace_business_date=NULL
WHERE canonical_marketplace_code='AMAZON_US'
  AND marketplace_business_date=confirmed_business_date;

DROP VIEW IF EXISTS formal_order_effective_dates;
CREATE VIEW formal_order_effective_dates AS
SELECT formal_order.id AS formal_order_id,
  formal_order.canonical_marketplace_code,
  formal_order.confirmed_business_date AS reporting_business_date,
  COALESCE(
    formal_order.marketplace_business_date,
    CASE formal_order.canonical_marketplace_code
      WHEN 'AMAZON_JP' THEN date(formal_order.confirmed_at/1000,'unixepoch','+9 hours')
      WHEN 'RAKUTEN_JP' THEN date(formal_order.confirmed_at/1000,'unixepoch','+9 hours')
      WHEN 'TIKTOK_JP' THEN date(formal_order.confirmed_at/1000,'unixepoch','+9 hours')
      WHEN 'COUPANG_KR' THEN date(formal_order.confirmed_at/1000,'unixepoch','+9 hours')
      ELSE NULL
    END
  ) AS marketplace_business_date,
  runtime.business_timezone,
  runtime.reporting_timezone
FROM formal_orders formal_order
JOIN marketplace_runtime_config runtime
  ON runtime.marketplace_code=formal_order.canonical_marketplace_code;

-- The persisted table is a reporting/index mirror of the typed Marketplace
-- registry. Runtime business code must not mutate it ad hoc; a future timezone
-- or currency change is an explicit versioned migration plus contract change.
CREATE TRIGGER trg_marketplace_runtime_config_no_update
BEFORE UPDATE ON marketplace_runtime_config
BEGIN SELECT RAISE(ABORT,'marketplace_runtime_config_requires_versioned_migration'); END;
CREATE TRIGGER trg_marketplace_runtime_config_no_delete
BEFORE DELETE ON marketplace_runtime_config
BEGIN SELECT RAISE(ABORT,'marketplace_runtime_config_requires_versioned_migration'); END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='view' AND name='formal_order_effective_dates')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_marketplace_runtime_config_no_update')
  AND NOT EXISTS(
    SELECT 1 FROM formal_orders
    WHERE canonical_marketplace_code='AMAZON_US'
      AND marketplace_business_date=confirmed_business_date
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=64,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=63;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
