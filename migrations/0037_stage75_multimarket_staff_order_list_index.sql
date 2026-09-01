-- Stage 7.5 multi-market go-live preparation: make the existing Staff order
-- list scope a leading key in the same order as its marketplace filter and
-- confirmed_at/id keyset sort. This is a forward-only performance index;
-- it does not enable a market, alter registry/configuration, or change the
-- Staff endpoint contract.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=36 THEN 1 ELSE 0 END;

CREATE INDEX idx_formal_orders_market_confirmed_id
ON formal_orders (marketplace_code, confirmed_at DESC, id DESC);

UPDATE app_schema_state
SET
  schema_version=37,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=36;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=37
  AND EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='index'
      AND name='idx_formal_orders_market_confirmed_id'
      AND lower(sql) LIKE '%marketplace_code, confirmed_at desc, id desc%'
  )
THEN 1 ELSE 0 END;
