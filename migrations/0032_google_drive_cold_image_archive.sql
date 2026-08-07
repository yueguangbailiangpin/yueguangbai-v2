PRAGMA foreign_keys = ON;

-- M7: Google Drive cold archive facts. All timestamps are UTC milliseconds.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=31
) THEN 1 ELSE 0 END;

CREATE TABLE order_archive_closures (
  formal_order_id TEXT PRIMARY KEY REFERENCES formal_orders(id),
  review_state TEXT NOT NULL CHECK (review_state IN ('COMPLETED','NOT_APPLICABLE')),
  buyer_refund_state TEXT NOT NULL CHECK (buyer_refund_state IN ('COMPLETED','NOT_APPLICABLE')),
  seller_principal_state TEXT NOT NULL CHECK (seller_principal_state IN ('COMPLETED','NOT_APPLICABLE')),
  seller_service_fee_state TEXT NOT NULL CHECK (seller_service_fee_state IN ('COMPLETED','NOT_APPLICABLE')),
  status TEXT NOT NULL CHECK (status IN ('CLOSED','REOPENED')),
  business_closed_at INTEGER NOT NULL CHECK (typeof(business_closed_at)='integer' AND business_closed_at>=0),
  archive_due_at INTEGER NOT NULL CHECK (typeof(archive_due_at)='integer' AND archive_due_at>=business_closed_at),
  reopened_at INTEGER CHECK (reopened_at IS NULL OR (typeof(reopened_at)='integer' AND reopened_at>=business_closed_at)),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 2000),
  version INTEGER NOT NULL CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  CHECK (
    (status='CLOSED' AND reopened_at IS NULL)
    OR (status='REOPENED' AND reopened_at IS NOT NULL AND reason IS NOT NULL)
  )
) STRICT;
CREATE INDEX idx_order_archive_closures_due
ON order_archive_closures(status,archive_due_at,formal_order_id);

CREATE TRIGGER trg_order_archive_closure_insert_guard
BEFORE INSERT ON order_archive_closures
WHEN NEW.status<>'CLOSED' OR NEW.version<>1 OR NEW.created_at<>NEW.updated_at
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED' AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id AND entry.created_at>NEW.business_closed_at)
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL' AND payable.derived_status='PAID'
      AND NOT EXISTS (SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id AND allocation.created_at>NEW.business_closed_at)
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE' AND payable.derived_status='PAID'
      AND NOT EXISTS (SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id AND allocation.created_at>NEW.business_closed_at)
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;

CREATE TRIGGER trg_order_archive_closure_update_guard
BEFORE UPDATE ON order_archive_closures
WHEN NOT (NEW.formal_order_id IS OLD.formal_order_id)
  OR NOT (NEW.review_state IS OLD.review_state)
  OR NOT (NEW.buyer_refund_state IS OLD.buyer_refund_state)
  OR NOT (NEW.seller_principal_state IS OLD.seller_principal_state)
  OR NOT (NEW.seller_service_fee_state IS OLD.seller_service_fee_state)
  OR NOT (NEW.business_closed_at IS OLD.business_closed_at)
  OR NOT (NEW.archive_due_at IS OLD.archive_due_at)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR OLD.status<>'CLOSED' OR NEW.status<>'REOPENED'
  OR NEW.reopened_at IS NULL OR NEW.reason IS NULL
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_invalid_transition');
END;
CREATE TRIGGER trg_order_archive_closures_no_delete
BEFORE DELETE ON order_archive_closures
BEGIN SELECT RAISE(ABORT,'order_archive_closures_are_immutable'); END;

CREATE TABLE drive_archive_controls (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  copy_enabled INTEGER NOT NULL DEFAULT 0 CHECK (copy_enabled IN (0,1)),
  proxy_read_enabled INTEGER NOT NULL DEFAULT 0 CHECK (proxy_read_enabled IN (0,1)),
  r2_delete_enabled INTEGER NOT NULL DEFAULT 0 CHECK (r2_delete_enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=0),
  CHECK (r2_delete_enabled=0 OR (copy_enabled=1 AND proxy_read_enabled=1))
) STRICT;
INSERT INTO drive_archive_controls(singleton_id,updated_at)
VALUES(1,CAST(unixepoch('now') AS INTEGER)*1000);
CREATE TRIGGER trg_drive_archive_controls_update_guard
BEFORE UPDATE ON drive_archive_controls
WHEN NEW.singleton_id<>OLD.singleton_id OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN SELECT RAISE(ABORT,'drive_archive_controls_invalid_update'); END;
CREATE TRIGGER trg_drive_archive_controls_no_delete
BEFORE DELETE ON drive_archive_controls
BEGIN SELECT RAISE(ABORT,'drive_archive_controls_are_required'); END;

CREATE TABLE file_drive_archives (
  file_object_id TEXT PRIMARY KEY REFERENCES file_objects(id),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'R2_HOT','DRIVE_COPYING','DRIVE_VERIFIED','R2_DELETE_PENDING','DRIVE_ARCHIVED'
  )),
  archive_due_at INTEGER NOT NULL CHECK (typeof(archive_due_at)='integer' AND archive_due_at>=0),
  drive_file_id TEXT CHECK (drive_file_id IS NULL OR length(drive_file_id) BETWEEN 1 AND 500),
  drive_folder_id TEXT CHECK (drive_folder_id IS NULL OR length(drive_folder_id) BETWEEN 1 AND 500),
  owner_account_key TEXT CHECK (owner_account_key IS NULL OR length(owner_account_key) BETWEEN 1 AND 120),
  resumable_session_key TEXT CHECK (resumable_session_key IS NULL OR length(resumable_session_key) BETWEEN 1 AND 500),
  uploaded_byte_size INTEGER CHECK (uploaded_byte_size IS NULL OR uploaded_byte_size>=0),
  uploaded_mime TEXT CHECK (uploaded_mime IS NULL OR uploaded_mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  uploaded_sha256 TEXT CHECK (uploaded_sha256 IS NULL OR (length(uploaded_sha256)=64 AND uploaded_sha256 NOT GLOB '*[^0-9a-f]*')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  next_retry_at INTEGER CHECK (next_retry_at IS NULL OR next_retry_at>=0),
  last_failure_category TEXT CHECK (last_failure_category IS NULL OR last_failure_category IN (
    'adapter_unavailable','authorization_failed','upload_failed','read_back_failed',
    'manifest_mismatch','d1_conflict','r2_delete_failed','drive_missing'
  )),
  lease_token TEXT,
  lease_expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  verified_at INTEGER,
  r2_deleted_at INTEGER,
  archived_at INTEGER,
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  CHECK (
    (status='R2_HOT' AND drive_file_id IS NULL AND drive_folder_id IS NULL
      AND owner_account_key IS NULL AND verified_at IS NULL
      AND r2_deleted_at IS NULL AND archived_at IS NULL)
    OR (status='DRIVE_COPYING'
      AND ((drive_file_id IS NULL AND drive_folder_id IS NULL AND owner_account_key IS NULL)
        OR (drive_file_id IS NOT NULL AND drive_folder_id IS NOT NULL AND owner_account_key IS NOT NULL))
      AND verified_at IS NULL AND r2_deleted_at IS NULL AND archived_at IS NULL)
    OR (status IN ('DRIVE_VERIFIED','R2_DELETE_PENDING')
      AND drive_file_id IS NOT NULL AND drive_folder_id IS NOT NULL
      AND owner_account_key IS NOT NULL AND uploaded_byte_size IS NOT NULL
      AND uploaded_mime IS NOT NULL AND uploaded_sha256 IS NOT NULL
      AND verified_at IS NOT NULL AND r2_deleted_at IS NULL AND archived_at IS NULL)
    OR (status='DRIVE_ARCHIVED' AND drive_file_id IS NOT NULL
      AND drive_folder_id IS NOT NULL AND owner_account_key IS NOT NULL
      AND uploaded_byte_size IS NOT NULL AND uploaded_mime IS NOT NULL
      AND uploaded_sha256 IS NOT NULL AND verified_at IS NOT NULL
      AND r2_deleted_at IS NOT NULL AND archived_at IS NOT NULL)
  ),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL))
) STRICT;
CREATE INDEX idx_file_drive_archives_due
ON file_drive_archives(status,next_retry_at,archive_due_at,file_object_id);
CREATE INDEX idx_file_drive_archives_lease
ON file_drive_archives(lease_expires_at,file_object_id);
CREATE TRIGGER trg_file_drive_archive_insert_guard
BEFORE INSERT ON file_drive_archives
WHEN NEW.status<>'R2_HOT' OR NEW.version<>1 OR NOT EXISTS (
  SELECT 1 FROM file_objects object JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  WHERE object.id=NEW.file_object_id AND object.status='VERIFIED' AND intent.status='VERIFIED'
    AND object.purpose=NEW.purpose
)
BEGIN SELECT RAISE(ABORT,'file_drive_archive_source_mismatch'); END;

CREATE TABLE file_drive_archive_manifests (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_drive_archives(file_object_id),
  drive_file_id TEXT NOT NULL CHECK (length(drive_file_id) BETWEEN 1 AND 500),
  drive_folder_id TEXT NOT NULL CHECK (length(drive_folder_id) BETWEEN 1 AND 500),
  owner_account_key TEXT NOT NULL CHECK (length(owner_account_key) BETWEEN 1 AND 120),
  byte_size INTEGER NOT NULL CHECK (byte_size>=0),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  verified_at INTEGER NOT NULL CHECK (typeof(verified_at)='integer' AND verified_at>=0),
  created_at INTEGER NOT NULL CHECK (created_at=verified_at)
) STRICT;
CREATE TRIGGER trg_file_drive_archive_manifests_no_update
BEFORE UPDATE ON file_drive_archive_manifests
BEGIN SELECT RAISE(ABORT,'file_drive_archive_manifests_are_immutable'); END;
CREATE TRIGGER trg_file_drive_archive_manifests_no_delete
BEFORE DELETE ON file_drive_archive_manifests
BEGIN SELECT RAISE(ABORT,'file_drive_archive_manifests_are_immutable'); END;

CREATE TRIGGER trg_file_drive_archive_transition_guard
BEFORE UPDATE ON file_drive_archives
WHEN NOT (NEW.file_object_id IS OLD.file_object_id)
  OR NOT (NEW.purpose IS OLD.purpose)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT (
    (OLD.status='R2_HOT' AND NEW.status IN ('R2_HOT','DRIVE_COPYING'))
    OR (OLD.status='DRIVE_COPYING' AND NEW.status IN ('R2_HOT','DRIVE_COPYING','DRIVE_VERIFIED'))
    OR (OLD.status='DRIVE_VERIFIED' AND NEW.status IN ('DRIVE_VERIFIED','R2_DELETE_PENDING'))
    OR (OLD.status='R2_DELETE_PENDING' AND NEW.status IN ('R2_DELETE_PENDING','DRIVE_ARCHIVED'))
    OR (OLD.status='DRIVE_ARCHIVED' AND NEW.status='DRIVE_ARCHIVED')
  )
  OR (NEW.status IN ('DRIVE_VERIFIED','R2_DELETE_PENDING','DRIVE_ARCHIVED') AND NOT EXISTS (
    SELECT 1 FROM file_drive_archive_manifests manifest
    WHERE manifest.file_object_id=NEW.file_object_id
      AND manifest.drive_file_id=NEW.drive_file_id
      AND manifest.drive_folder_id=NEW.drive_folder_id
      AND manifest.owner_account_key=NEW.owner_account_key
      AND manifest.byte_size=NEW.uploaded_byte_size
      AND manifest.mime_type=NEW.uploaded_mime
      AND manifest.sha256=NEW.uploaded_sha256
      AND manifest.verified_at=NEW.verified_at
  ))
BEGIN
  SELECT RAISE(ABORT,'file_drive_archive_invalid_transition');
END;
CREATE TRIGGER trg_file_drive_archives_no_delete
BEFORE DELETE ON file_drive_archives
BEGIN SELECT RAISE(ABORT,'file_drive_archives_are_immutable'); END;

CREATE TABLE file_drive_archive_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  file_object_id TEXT NOT NULL REFERENCES file_drive_archives(file_object_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ELIGIBILITY_RECORDED','COPY_STARTED','COPY_RESUMED','COPY_FAILED',
    'DRIVE_VERIFIED','R2_DELETE_REQUESTED','R2_DELETE_FAILED','DRIVE_ARCHIVED',
    'RECONCILIATION_FAILED','REHYDRATION_STARTED','REHYDRATION_COMPLETED','REHYDRATION_FAILED'
  )),
  previous_status TEXT,
  next_status TEXT NOT NULL CHECK (next_status IN (
    'R2_HOT','DRIVE_COPYING','DRIVE_VERIFIED','R2_DELETE_PENDING','DRIVE_ARCHIVED'
  )),
  archive_version INTEGER NOT NULL CHECK (archive_version>=1),
  failure_category TEXT,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0)
) STRICT;
CREATE INDEX idx_file_drive_archive_events_file
ON file_drive_archive_events(file_object_id,created_at,id);
CREATE TRIGGER trg_file_drive_archive_events_no_update
BEFORE UPDATE ON file_drive_archive_events
BEGIN SELECT RAISE(ABORT,'file_drive_archive_events_are_immutable'); END;
CREATE TRIGGER trg_file_drive_archive_events_no_delete
BEFORE DELETE ON file_drive_archive_events
BEGIN SELECT RAISE(ABORT,'file_drive_archive_events_are_immutable'); END;

CREATE TABLE file_drive_archive_reconciliations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  file_object_id TEXT NOT NULL REFERENCES file_drive_archives(file_object_id),
  result TEXT NOT NULL CHECK (result IN ('HEALTHY','FAILED')),
  failure_category TEXT CHECK (failure_category IS NULL OR failure_category IN (
    'authorization_failed','read_back_failed','manifest_mismatch','drive_missing'
  )),
  checked_byte_size INTEGER,
  checked_mime TEXT,
  checked_sha256 TEXT,
  checked_at INTEGER NOT NULL CHECK (typeof(checked_at)='integer' AND checked_at>=0),
  CHECK (
    (result='HEALTHY' AND failure_category IS NULL AND checked_byte_size IS NOT NULL
      AND checked_mime IS NOT NULL AND checked_sha256 IS NOT NULL)
    OR (result='FAILED' AND failure_category IS NOT NULL)
  )
) STRICT;
CREATE INDEX idx_file_drive_archive_reconciliations_file
ON file_drive_archive_reconciliations(file_object_id,checked_at,id);
CREATE TRIGGER trg_file_drive_archive_reconciliations_no_update
BEFORE UPDATE ON file_drive_archive_reconciliations
BEGIN SELECT RAISE(ABORT,'file_drive_archive_reconciliations_are_immutable'); END;
CREATE TRIGGER trg_file_drive_archive_reconciliations_no_delete
BEFORE DELETE ON file_drive_archive_reconciliations
BEGIN SELECT RAISE(ABORT,'file_drive_archive_reconciliations_are_immutable'); END;

CREATE TABLE file_drive_rehydrations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  file_object_id TEXT NOT NULL REFERENCES file_drive_archives(file_object_id),
  target_object_key TEXT NOT NULL CHECK (length(target_object_key) BETWEEN 1 AND 1024),
  status TEXT NOT NULL CHECK (status IN ('STARTED','COMPLETED','FAILED')),
  expected_sha256 TEXT NOT NULL CHECK (length(expected_sha256)=64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'),
  failure_category TEXT,
  requested_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  request_id TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  completed_at INTEGER,
  UNIQUE(requested_by_staff_id,idempotency_key)
) STRICT;
CREATE TRIGGER trg_file_drive_rehydration_update_guard
BEFORE UPDATE ON file_drive_rehydrations
WHEN NOT (NEW.id IS OLD.id) OR NOT (NEW.file_object_id IS OLD.file_object_id)
  OR NOT (NEW.target_object_key IS OLD.target_object_key) OR NOT (NEW.expected_sha256 IS OLD.expected_sha256)
  OR NOT (NEW.requested_by_staff_id IS OLD.requested_by_staff_id) OR NOT (NEW.request_id IS OLD.request_id)
  OR NOT (NEW.idempotency_key IS OLD.idempotency_key) OR NOT (NEW.created_at IS OLD.created_at)
  OR OLD.status<>'STARTED' OR NEW.status NOT IN ('COMPLETED','FAILED') OR NEW.completed_at IS NULL
BEGIN SELECT RAISE(ABORT,'file_drive_rehydration_invalid_transition'); END;
CREATE TRIGGER trg_file_drive_rehydrations_no_delete
BEFORE DELETE ON file_drive_rehydrations
BEGIN SELECT RAISE(ABORT,'file_drive_rehydrations_are_immutable'); END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='order_archive_closures')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_drive_archives')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_drive_archive_manifests')
  AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_file_drive_archive_transition_guard')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=32,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=31;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
