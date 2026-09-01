-- Baseline 0014 internal_finance_exports (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=13 THEN 1 ELSE 0 END;

CREATE TABLE financial_export_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  export_type TEXT NOT NULL CHECK (export_type IN (
    'ORDER_DETAIL','SELLER_SUMMARY','STORE_SUMMARY','PRODUCT_SUMMARY',
    'ASIN_SUMMARY','MONTHLY_SUMMARY','CASH_FLOW','FINANCIAL_EXCEPTIONS'
  )),
  requested_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  filter_json TEXT NOT NULL CHECK (length(filter_json) BETWEEN 2 AND 65536),
  filter_hash TEXT NOT NULL CHECK (
    length(filter_hash)=64 AND filter_hash NOT GLOB '*[^0-9a-f]*'
  ),
  data_as_of INTEGER NOT NULL CHECK (typeof(data_as_of)='integer' AND data_as_of>=0),
  row_count INTEGER NOT NULL CHECK (
    typeof(row_count)='integer' AND row_count BETWEEN 0 AND 50000
  ),
  output_byte_length INTEGER NOT NULL CHECK (
    typeof(output_byte_length)='integer'
    AND output_byte_length BETWEEN 1 AND 26214400
  ),
  output_sha256 TEXT NOT NULL CHECK (
    length(output_sha256)=64 AND output_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  generated_at INTEGER NOT NULL CHECK (
    typeof(generated_at)='integer' AND generated_at>=0
  ),
  created_at INTEGER NOT NULL CHECK (created_at=generated_at)
) STRICT;

CREATE INDEX idx_financial_export_events_filter_hash
ON financial_export_events (filter_hash, generated_at, id);

CREATE INDEX idx_financial_export_events_staff_generated
ON financial_export_events (requested_by_staff_id, generated_at, id);

CREATE INDEX idx_financial_export_events_type_generated
ON financial_export_events (export_type, generated_at, id);

CREATE TRIGGER trg_financial_export_events_no_delete
BEFORE DELETE ON financial_export_events
BEGIN
  SELECT RAISE(ABORT, 'financial_export_events_are_immutable');
END;

CREATE TRIGGER trg_financial_export_events_no_update
BEFORE UPDATE ON financial_export_events
BEGIN
  SELECT RAISE(ABORT, 'financial_export_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=14,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
