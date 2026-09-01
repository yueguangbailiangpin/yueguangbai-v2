-- Stage 7.5 (batch 1): staff formal-order cursor list indexes.
-- Keyset pagination (confirmed_at DESC, id DESC) plus the filter columns the
-- list endpoint exposes that earlier migrations do not already cover.
-- Existing coverage reused (not duplicated): buyer/seller/store
-- `idx_formal_orders_*_confirmed`, `idx_formal_order_operational_events_order`.
-- Append-only: no historical migration is modified.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=30 THEN 1 ELSE 0 END;

-- Keyset cursor primary scan for the unfiltered list (confirmed_at = created_at
-- per table CHECK; backward index scan yields DESC order).
CREATE INDEX idx_formal_orders_confirmed_id
ON formal_orders (confirmed_at, id);

-- Buyer customer number filter.
CREATE INDEX idx_formal_orders_buyer_no
ON formal_orders (buyer_customer_no);

-- Amazon order number prefix filter with keyset continuation.
CREATE INDEX idx_formal_orders_amazon_prefix
ON formal_orders (amazon_order_number_normalized, confirmed_at, id);

UPDATE app_schema_state
SET
  schema_version=31,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=30;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=31 THEN 1 ELSE 0 END;
