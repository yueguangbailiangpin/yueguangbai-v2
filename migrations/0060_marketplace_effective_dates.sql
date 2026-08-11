PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=59
) THEN 1 ELSE 0 END;

-- Current JP orders predate the canonical local-date column, so their effective
-- marketplace date can be derived exactly from confirmed_at. Future non-JP
-- formal-order writers must persist the local marketplace date explicitly.
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
      ELSE formal_order.confirmed_business_date
    END
  ) AS marketplace_business_date,
  runtime.business_timezone,
  runtime.reporting_timezone
FROM formal_orders formal_order
JOIN marketplace_runtime_config runtime
  ON runtime.marketplace_code=formal_order.canonical_marketplace_code;

CREATE TRIGGER trg_formal_order_non_jp_local_date_required
BEFORE INSERT ON formal_orders
WHEN COALESCE(NEW.canonical_marketplace_code,'AMAZON_JP')<>'AMAZON_JP'
  AND NEW.marketplace_business_date IS NULL
BEGIN
  SELECT RAISE(ABORT,'formal_order_marketplace_business_date_required');
END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='view' AND name='formal_order_effective_dates')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_formal_order_non_jp_local_date_required')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=60,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=59;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
