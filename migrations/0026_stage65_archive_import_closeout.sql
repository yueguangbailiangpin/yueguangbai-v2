-- 0026 stage 6.5 closeout: multi-line order contract, identity override audit
-- linkage, and read-only image inventory facts. Forward-append only; the
-- 0001-0025 chain is never rewritten.
--
-- 1. historical_import_quarantine.exception_code gains
--    MULTI_LINE_ORDER_REQUIRES_MAPPING (same source_order_id with differing
--    product/amount/fee facts must HOLD for an explicit business mapping —
--    never fold, never first/last, never auto-sum). SQLite CHECK constraints
--    cannot be altered in place, so the table is rebuilt shape-identically.
-- 2. historical_import_identity_overrides gains import_batch_id so a manual
--    override records original value (source_key), resolved value
--    (resolved_id), operator, reason, time AND the import run it adjudicates.
-- 3. Three read-only-image-inventory tables (batch provenance, per-file
--    facts, reconciliation findings). The source directory itself is never
--    written by any tool that uses these tables.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=25 THEN 1 ELSE 0 END;

-- 1. Rebuild historical_import_quarantine with the extended code list.

ALTER TABLE historical_import_quarantine RENAME TO historical_import_quarantine_stage65_rebuild;

-- The 0025 index still owns its name while attached to the renamed table.
DROP INDEX idx_historical_import_quarantine_batch;

CREATE TABLE historical_import_quarantine (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  import_batch_id TEXT NOT NULL REFERENCES historical_import_batches(id),
  source_row_key TEXT NOT NULL,
  source_order_id TEXT CHECK (source_order_id IS NULL OR length(source_order_id) BETWEEN 1 AND 200),
  exception_code TEXT NOT NULL CHECK (exception_code IN (
    'UNKNOWN_MARKETPLACE','INVALID_ORDER_NUMBER','MISSING_REQUIRED_COLUMN','NON_INTEGER_AMOUNT',
    'INVALID_DATE','IDENTITY_CONFLICT','IDENTITY_UNMATCHED','DUPLICATE_SOURCE_ORDER',
    'MISSING_FINANCIAL_FIELDS','RATE_SPREAD_MISMATCH','CONFLICTING_DUPLICATE_GROUP',
    'MULTI_LINE_ORDER_REQUIRES_MAPPING',
    'FILE_MISSING','FILE_CORRUPT','FILE_ORPHAN','MULTI_SELLER_AMBIGUOUS'
  )),
  detail_json TEXT NOT NULL CHECK (length(detail_json)<=2000),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (import_batch_id, source_row_key, exception_code)
) STRICT;

INSERT INTO historical_import_quarantine
SELECT id, import_batch_id, source_row_key, source_order_id, exception_code, detail_json, created_at
FROM historical_import_quarantine_stage65_rebuild;

DROP TABLE historical_import_quarantine_stage65_rebuild;

CREATE INDEX idx_historical_import_quarantine_batch
ON historical_import_quarantine (import_batch_id, exception_code, id);

CREATE TRIGGER trg_historical_quarantine_no_delete
BEFORE DELETE ON historical_import_quarantine
BEGIN SELECT RAISE(ABORT,'historical_quarantine_are_immutable'); END;

-- 2. Identity override audit linkage to the adjudicated import run.

ALTER TABLE historical_import_identity_overrides
ADD COLUMN import_batch_id TEXT REFERENCES historical_import_batches(id);

-- 3. Read-only image inventory facts.

CREATE TABLE historical_image_inventory_batches (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  source_root TEXT NOT NULL CHECK (length(source_root) BETWEEN 1 AND 1000),
  source_listing_sha256 TEXT NOT NULL CHECK (length(source_listing_sha256)=64
    AND source_listing_sha256 NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED','ABANDONED')),
  checkpoint_relative_path TEXT CHECK (checkpoint_relative_path IS NULL
    OR (length(checkpoint_relative_path) BETWEEN 1 AND 1000
      AND checkpoint_relative_path NOT LIKE '/%'
      AND checkpoint_relative_path NOT LIKE '%..%')),
  scanned_files INTEGER NOT NULL DEFAULT 0 CHECK (scanned_files>=0),
  scanned_bytes INTEGER NOT NULL DEFAULT 0 CHECK (scanned_bytes>=0),
  read_failed_files INTEGER NOT NULL DEFAULT 0 CHECK (read_failed_files>=0),
  unrecognized_mime_files INTEGER NOT NULL DEFAULT 0 CHECK (unrecognized_mime_files>=0),
  duplicate_content_groups INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_content_groups>=0),
  created_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  finished_at INTEGER CHECK (finished_at IS NULL
    OR (typeof(finished_at)='integer' AND finished_at>=created_at)),
  UNIQUE (source_root, source_listing_sha256),
  CHECK ((status IN ('COMPLETED','FAILED') AND finished_at IS NOT NULL)
    OR (status IN ('RUNNING','ABANDONED') AND finished_at IS NULL))
) STRICT;

CREATE INDEX idx_hist_img_batches_root
ON historical_image_inventory_batches (source_root, status, id);

CREATE TABLE historical_image_inventory_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  inventory_batch_id TEXT NOT NULL REFERENCES historical_image_inventory_batches(id),
  relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 1000
    AND relative_path NOT LIKE '/%'
    AND relative_path NOT LIKE '%..%'
    AND relative_path NOT LIKE '%\%'),
  logical_file_id TEXT NOT NULL CHECK (length(logical_file_id)=72
    AND logical_file_id LIKE 'histimg-%'
    AND substr(logical_file_id,9) NOT GLOB '*[^0-9a-f]*'),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size>=0),
  sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  mime_type TEXT CHECK (mime_type IS NULL OR mime_type IN (
    'image/jpeg','image/png','image/webp','image/gif','application/pdf'
  )),
  extension TEXT CHECK (extension IS NULL OR length(extension) BETWEEN 1 AND 16),
  read_status TEXT NOT NULL CHECK (read_status IN ('READ_OK','READ_FAILED')),
  extension_mime_consistent INTEGER NOT NULL CHECK (extension_mime_consistent IN (0,1)),
  business_relation TEXT CHECK (business_relation IS NULL OR business_relation IN (
    'LINKED','ORPHAN','QUARANTINE'
  )),
  business_import_batch_id TEXT REFERENCES historical_import_batches(id),
  business_order_id TEXT CHECK (business_order_id IS NULL OR length(business_order_id) BETWEEN 1 AND 200),
  business_purpose TEXT CHECK (business_purpose IS NULL OR business_purpose IN (
    'ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF','ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
  )),
  business_audience TEXT CHECK (business_audience IS NULL OR business_audience IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (inventory_batch_id, relative_path)
) STRICT;

CREATE INDEX idx_hist_img_files_sha
ON historical_image_inventory_files (inventory_batch_id, sha256, relative_path)
WHERE sha256 IS NOT NULL;

CREATE INDEX idx_hist_img_files_relation
ON historical_image_inventory_files (inventory_batch_id, business_relation, relative_path)
WHERE business_relation IS NOT NULL;

CREATE TABLE historical_image_inventory_findings (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  inventory_batch_id TEXT NOT NULL REFERENCES historical_image_inventory_batches(id),
  relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 1200),
  finding_code TEXT NOT NULL CHECK (finding_code IN (
    'READ_FAILED','UNRECOGNIZED_MIME','EXTENSION_MIME_MISMATCH','DUPLICATE_CONTENT',
    'ORPHAN_FILE','REFERENCED_MISSING','UNRESOLVED_BUSINESS_RELATION','UNRESOLVED_AUDIENCE',
    'UNSAFE_ENTRY'
  )),
  detail_json TEXT NOT NULL CHECK (length(detail_json)<=2000),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (inventory_batch_id, relative_path, finding_code)
) STRICT;

CREATE INDEX idx_hist_img_findings_batch
ON historical_image_inventory_findings (inventory_batch_id, finding_code, relative_path);

CREATE TRIGGER trg_hist_img_batches_no_delete
BEFORE DELETE ON historical_image_inventory_batches
BEGIN SELECT RAISE(ABORT,'historical_image_inventory_batches_are_immutable'); END;

CREATE TRIGGER trg_hist_img_files_no_delete
BEFORE DELETE ON historical_image_inventory_files
BEGIN SELECT RAISE(ABORT,'historical_image_inventory_files_are_immutable'); END;

-- Byte-level facts (path/hash/size/mime) are immutable once written; only the
-- reconciliation-owned business_* columns may ever change.
CREATE TRIGGER trg_hist_img_files_update_guard
BEFORE UPDATE ON historical_image_inventory_files
WHEN NEW.id<>OLD.id OR NEW.inventory_batch_id<>OLD.inventory_batch_id
  OR NEW.relative_path<>OLD.relative_path OR NEW.logical_file_id<>OLD.logical_file_id
  OR NEW.byte_size<>OLD.byte_size OR NEW.sha256<>OLD.sha256 OR NEW.mime_type<>OLD.mime_type
  OR NEW.extension<>OLD.extension OR NEW.read_status<>OLD.read_status
  OR NEW.extension_mime_consistent<>OLD.extension_mime_consistent
  OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'historical_image_inventory_facts_are_immutable'); END;

CREATE TRIGGER trg_hist_img_findings_no_delete
BEFORE DELETE ON historical_image_inventory_findings
BEGIN SELECT RAISE(ABORT,'historical_image_inventory_findings_are_immutable'); END;

UPDATE app_schema_state
SET
  schema_version=26,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
