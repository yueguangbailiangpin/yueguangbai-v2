-- 0025 historical order import (stage 6, D-054 lossless-import obligation).
-- Read-only sources stay outside the repository; these tables hold import
-- provenance, the 30-column source snapshots, image plans and quarantine
-- rows. Live formal_orders is never written by the importer.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=24 THEN 1 ELSE 0 END;

CREATE TABLE historical_import_batches (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  source_system TEXT NOT NULL CHECK (source_system IN ('HISTORICAL_ORDER_CSV','HISTORICAL_ORDER_JSONL')),
  source_files_json TEXT NOT NULL CHECK (length(source_files_json)<=8000),
  source_files_sha256 TEXT NOT NULL CHECK (length(source_files_sha256)=64 AND source_files_sha256 NOT GLOB '*[^0-9a-f]*'),
  parser_version TEXT NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 40),
  mapping_version TEXT NOT NULL CHECK (length(mapping_version) BETWEEN 1 AND 40),
  mode TEXT NOT NULL CHECK (mode IN ('DRY_RUN','APPLY_LOCAL')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED','ABANDONED')),
  checkpoint_row_key TEXT,
  source_row_count INTEGER NOT NULL DEFAULT 0 CHECK (source_row_count>=0),
  valid_row_count INTEGER NOT NULL DEFAULT 0 CHECK (valid_row_count>=0),
  quarantined_row_count INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_row_count>=0),
  imported_row_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_row_count>=0),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
  created_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  finished_at INTEGER CHECK (finished_at IS NULL OR (typeof(finished_at)='integer' AND finished_at>=created_at)),
  UNIQUE (source_system, source_files_sha256, parser_version, mapping_version, mode),
  CHECK (source_row_count = valid_row_count + quarantined_row_count),
  CHECK ((status IN ('COMPLETED','FAILED') AND finished_at IS NOT NULL)
    OR (status IN ('RUNNING','ABANDONED') AND finished_at IS NULL))
) STRICT;

CREATE INDEX idx_historical_import_batches_source
ON historical_import_batches (source_system, source_files_sha256, status, id);

CREATE TABLE historical_orders (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  import_batch_id TEXT NOT NULL REFERENCES historical_import_batches(id),
  source_system TEXT NOT NULL,
  source_row_key TEXT NOT NULL CHECK (length(source_row_key) BETWEEN 6 AND 300),
  source_order_id TEXT NOT NULL CHECK (length(source_order_id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL CHECK (marketplace_code IN ('AMAZON_JP')),
  -- 30-column source snapshot (integer minor units, dates as TEXT, raw text
  -- preserved verbatim; nothing is recomputed from current policy).
  ordered_on TEXT CHECK (ordered_on GLOB '????-??-??' AND date(ordered_on)=ordered_on),
  status_snapshot_raw TEXT,
  buyer_customer_no_ref TEXT,
  buyer_wechat_ref TEXT,
  store_name_ref TEXT,
  platform_product_identifier TEXT,
  order_amount_source_minor INTEGER CHECK (order_amount_source_minor IS NULL OR (order_amount_source_minor>=0 AND order_amount_source_minor<=9007199254740991)),
  order_amount_currency TEXT CHECK (order_amount_currency IS NULL OR order_amount_currency IN ('JPY')),
  platform_order_number_raw TEXT,
  platform_order_number_normalized TEXT,
  review_submitted_on TEXT,
  review_approved_on TEXT,
  review_status_raw TEXT,
  review_url_raw TEXT,
  buyer_rate_source_e8 INTEGER CHECK (buyer_rate_source_e8 IS NULL OR (buyer_rate_source_e8>=0 AND buyer_rate_source_e8<=9007199254740991)),
  refunded_on TEXT,
  seller_rate_source_e8 INTEGER CHECK (seller_rate_source_e8 IS NULL OR (seller_rate_source_e8>=0 AND seller_rate_source_e8<=9007199254740991)),
  replenishment_submitted_on TEXT,
  service_fee_source_minor INTEGER CHECK (service_fee_source_minor IS NULL OR (service_fee_source_minor>=0 AND service_fee_source_minor<=9007199254740991)),
  settled_on TEXT,
  buyer_refund_amount_source_minor INTEGER CHECK (buyer_refund_amount_source_minor IS NULL OR (buyer_refund_amount_source_minor>=0 AND buyer_refund_amount_source_minor<=9007199254740991)),
  seller_principal_amount_source_minor INTEGER CHECK (seller_principal_amount_source_minor IS NULL OR (seller_principal_amount_source_minor>=0 AND seller_principal_amount_source_minor<=9007199254740991)),
  rate_spread_source_e8 INTEGER CHECK (rate_spread_source_e8 IS NULL OR (rate_spread_source_e8>=0 AND rate_spread_source_e8<=9007199254740991)),
  profit_source_minor INTEGER CHECK (profit_source_minor IS NULL OR (profit_source_minor>=0 AND profit_source_minor<=9007199254740991)),
  order_detail_note TEXT,
  row_sha256 TEXT NOT NULL CHECK (length(row_sha256)=64 AND row_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (import_batch_id, source_row_key),
  UNIQUE (import_batch_id, source_order_id)
) STRICT;

CREATE INDEX idx_historical_orders_order_id
ON historical_orders (source_system, source_order_id, id);

CREATE TABLE historical_order_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  import_batch_id TEXT NOT NULL REFERENCES historical_import_batches(id),
  historical_order_id TEXT NOT NULL REFERENCES historical_orders(id),
  source_row_key TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN (
    'ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF','ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
  )),
  audience TEXT NOT NULL CHECK (audience IN ('INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE')),
  source_column TEXT NOT NULL CHECK (length(source_column) BETWEEN 1 AND 60),
  source_ref TEXT CHECK (source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 500),
  source_ref_sha256 TEXT CHECK (source_ref_sha256 IS NULL OR (length(source_ref_sha256)=64 AND source_ref_sha256 NOT GLOB '*[^0-9a-f]*')),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR (length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
  mime_type TEXT CHECK (mime_type IS NULL OR mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size>=0),
  classification TEXT NOT NULL CHECK (classification IN (
    'HOT_R2','COLD_ARCHIVE_ELIGIBLE','QUARANTINE','MISSING','CORRUPT','ORPHAN'
  )),
  classification_reason TEXT CHECK (classification_reason IS NULL OR length(classification_reason) BETWEEN 1 AND 200),
  physical_dedup_key TEXT CHECK (physical_dedup_key IS NULL OR length(physical_dedup_key)=64),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (import_batch_id, historical_order_id, source_column, source_ref)
) STRICT;

CREATE INDEX idx_historical_order_files_batch
ON historical_order_files (import_batch_id, classification, id);

CREATE INDEX idx_historical_order_files_dedup
ON historical_order_files (physical_dedup_key, id) WHERE physical_dedup_key IS NOT NULL;

CREATE TABLE historical_import_quarantine (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  import_batch_id TEXT NOT NULL REFERENCES historical_import_batches(id),
  source_row_key TEXT NOT NULL,
  source_order_id TEXT CHECK (source_order_id IS NULL OR length(source_order_id) BETWEEN 1 AND 200),
  exception_code TEXT NOT NULL CHECK (exception_code IN (
    'UNKNOWN_MARKETPLACE','INVALID_ORDER_NUMBER','MISSING_REQUIRED_COLUMN','NON_INTEGER_AMOUNT',
    'INVALID_DATE','IDENTITY_CONFLICT','IDENTITY_UNMATCHED','DUPLICATE_SOURCE_ORDER',
    'MISSING_FINANCIAL_FIELDS','RATE_SPREAD_MISMATCH','CONFLICTING_DUPLICATE_GROUP',
    'FILE_MISSING','FILE_CORRUPT','FILE_ORPHAN','MULTI_SELLER_AMBIGUOUS'
  )),
  detail_json TEXT NOT NULL CHECK (length(detail_json)<=2000),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (import_batch_id, source_row_key, exception_code)
) STRICT;

CREATE INDEX idx_historical_import_quarantine_batch
ON historical_import_quarantine (import_batch_id, exception_code, id);

CREATE TABLE historical_import_identity_overrides (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  source_system TEXT NOT NULL,
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  resolved_kind TEXT NOT NULL CHECK (resolved_kind IN ('BUYER_CUSTOMER','SELLER_ORGANIZATION')),
  resolved_id TEXT NOT NULL CHECK (length(resolved_id) BETWEEN 1 AND 200),
  override_reason TEXT NOT NULL CHECK (length(override_reason) BETWEEN 1 AND 2000),
  overridden_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (source_system, source_key)
) STRICT;

CREATE TRIGGER trg_historical_import_batches_no_delete
BEFORE DELETE ON historical_import_batches
BEGIN SELECT RAISE(ABORT,'historical_import_batches_are_immutable'); END;

CREATE TRIGGER trg_historical_orders_no_delete
BEFORE DELETE ON historical_orders
BEGIN SELECT RAISE(ABORT,'historical_orders_are_immutable'); END;

CREATE TRIGGER trg_historical_orders_no_update
BEFORE UPDATE ON historical_orders
BEGIN SELECT RAISE(ABORT,'historical_orders_are_immutable'); END;

CREATE TRIGGER trg_historical_order_files_no_delete
BEFORE DELETE ON historical_order_files
BEGIN SELECT RAISE(ABORT,'historical_order_files_are_immutable'); END;

CREATE TRIGGER trg_historical_file_insert_guard
BEFORE INSERT ON historical_order_files
WHEN NEW.classification='COLD_ARCHIVE_ELIGIBLE'
  AND NOT EXISTS (
    SELECT 1 FROM historical_orders hist
    WHERE hist.id=NEW.historical_order_id
      AND hist.review_approved_on IS NOT NULL
      AND hist.refunded_on IS NOT NULL
      AND hist.settled_on IS NOT NULL
  )
BEGIN SELECT RAISE(ABORT,'historical_file_cold_requires_complete_closure'); END;

CREATE TRIGGER trg_historical_quarantine_no_delete
BEFORE DELETE ON historical_import_quarantine
BEGIN SELECT RAISE(ABORT,'historical_quarantine_are_immutable'); END;

UPDATE app_schema_state
SET
  schema_version=25,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
