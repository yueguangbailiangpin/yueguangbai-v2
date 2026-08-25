-- 0024 cold archive bundle model (stage 5, D-055).
-- Supersedes the per-file Drive archive model (drive_archive_controls,
-- file_drive_archives, file_drive_archive_{events,manifests,reconciliations},
-- file_drive_rehydrations) which is removed below; order_archive_closures and
-- the scheduled-operations tables are retained unchanged.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=23 THEN 1 ELSE 0 END;

DROP TABLE file_drive_archive_reconciliations;
DROP TABLE file_drive_archive_manifests;
DROP TABLE file_drive_archive_events;
DROP TABLE file_drive_rehydrations;
DROP TABLE file_drive_archives;
DROP TABLE drive_archive_controls;

CREATE TABLE archive_runtime_controls (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  selector_enabled INTEGER NOT NULL DEFAULT 0 CHECK (selector_enabled IN (0,1)),
  drive_upload_enabled INTEGER NOT NULL DEFAULT 0 CHECK (drive_upload_enabled IN (0,1)),
  hot_delete_enabled INTEGER NOT NULL DEFAULT 0 CHECK (hot_delete_enabled IN (0,1)),
  restore_worker_enabled INTEGER NOT NULL DEFAULT 0 CHECK (restore_worker_enabled IN (0,1)),
  shadow_copy_only INTEGER NOT NULL DEFAULT 1 CHECK (shadow_copy_only IN (0,1)),
  drive_max_concurrency INTEGER NOT NULL DEFAULT 3 CHECK (drive_max_concurrency BETWEEN 1 AND 10),
  queue_batch_size INTEGER NOT NULL DEFAULT 5 CHECK (queue_batch_size BETWEEN 1 AND 5),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=0),
  CHECK (hot_delete_enabled=0 OR (drive_upload_enabled=1 AND shadow_copy_only=0))
) STRICT;

CREATE TABLE archive_bundles (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  bundle_type TEXT NOT NULL CHECK (bundle_type IN (
    'ORDER','BUYER_REFUND_PAYMENT','SELLER_SETTLEMENT_PAYMENT'
  )),
  ref_id TEXT NOT NULL CHECK (length(ref_id) BETWEEN 1 AND 200),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  bundle_version INTEGER NOT NULL CHECK (bundle_version>=1),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  state TEXT NOT NULL DEFAULT 'ONLINE' CHECK (state IN (
    'ONLINE','ARCHIVED','RESTORE_REQUESTED','RESTORING','RESTORED_TEMPORARILY','RESTORE_FAILED'
  )),
  eligibility_at INTEGER NOT NULL CHECK (typeof(eligibility_at)='integer' AND eligibility_at>=0),
  sealed_at INTEGER CHECK (sealed_at IS NULL OR (typeof(sealed_at)='integer' AND sealed_at>=0)),
  manifest_version INTEGER CHECK (manifest_version IS NULL OR manifest_version=1),
  manifest_sha256 TEXT CHECK (manifest_sha256 IS NULL OR (
    length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),
  manifest_file_count INTEGER CHECK (manifest_file_count IS NULL OR (
    typeof(manifest_file_count)='integer' AND manifest_file_count>=0)),
  manifest_total_bytes INTEGER CHECK (manifest_total_bytes IS NULL OR (
    typeof(manifest_total_bytes)='integer' AND manifest_total_bytes>=0)),
  zip_byte_size INTEGER CHECK (zip_byte_size IS NULL OR (
    typeof(zip_byte_size)='integer' AND zip_byte_size>=0)),
  zip_mime TEXT CHECK (zip_mime IS NULL OR zip_mime='application/zip'),
  zip_sha256 TEXT CHECK (zip_sha256 IS NULL OR (
    length(zip_sha256)=64 AND zip_sha256 NOT GLOB '*[^0-9a-f]*')),
  temp_zip_object_key TEXT CHECK (temp_zip_object_key IS NULL OR (
    length(temp_zip_object_key) BETWEEN 20 AND 1024)),
  drive_file_id TEXT CHECK (drive_file_id IS NULL OR length(drive_file_id) BETWEEN 1 AND 500),
  drive_folder_id TEXT CHECK (drive_folder_id IS NULL OR length(drive_folder_id) BETWEEN 1 AND 500),
  drive_session_key TEXT CHECK (drive_session_key IS NULL OR length(drive_session_key) BETWEEN 1 AND 500),
  drive_uploaded_at INTEGER CHECK (drive_uploaded_at IS NULL OR (
    typeof(drive_uploaded_at)='integer' AND drive_uploaded_at>=0)),
  drive_verified_at INTEGER CHECK (drive_verified_at IS NULL OR (
    typeof(drive_verified_at)='integer' AND drive_verified_at>=0)),
  hot_files_total INTEGER CHECK (hot_files_total IS NULL OR (
    typeof(hot_files_total)='integer' AND hot_files_total>=0)),
  hot_files_deleted INTEGER CHECK (hot_files_deleted IS NULL OR (
    typeof(hot_files_deleted)='integer' AND hot_files_deleted>=0 AND hot_files_deleted<=hot_files_total)),
  hot_delete_completed_at INTEGER CHECK (hot_delete_completed_at IS NULL OR (
    typeof(hot_delete_completed_at)='integer' AND hot_delete_completed_at>=0)),
  archived_at INTEGER CHECK (archived_at IS NULL OR (
    typeof(archived_at)='integer' AND archived_at>=0)),
  shadow_completed_at INTEGER CHECK (shadow_completed_at IS NULL OR (
    typeof(shadow_completed_at)='integer' AND shadow_completed_at>=0)),
  restore_expires_at INTEGER CHECK (restore_expires_at IS NULL OR (
    typeof(restore_expires_at)='integer' AND restore_expires_at>=0)),
  superseded_by_version INTEGER CHECK (superseded_by_version IS NULL OR (
    typeof(superseded_by_version)='integer' AND superseded_by_version>bundle_version)),
  last_failure_category TEXT CHECK (last_failure_category IS NULL OR last_failure_category IN (
    'file_integrity_mismatch','manifest_superseded','storage_stream_unavailable','temp_zip_failed',
    'drive_authorization_failed','drive_rate_limited','drive_unavailable','drive_session_conflict',
    'drive_not_found','drive_verification_failed','hot_delete_failed','restore_verify_failed',
    'restore_extract_failed','cleanup_failed','job_poison_message','dependency_unavailable'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(attempt_count)='integer' AND attempt_count>=0),
  next_retry_at INTEGER CHECK (next_retry_at IS NULL OR (
    typeof(next_retry_at)='integer' AND next_retry_at>=0)),
  lease_token TEXT,
  lease_expires_at INTEGER,
  trace_id TEXT CHECK (trace_id IS NULL OR length(trace_id) BETWEEN 8 AND 120),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  UNIQUE (bundle_type, ref_id, bundle_version),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK ((bundle_type='ORDER' AND ref_id=formal_order_id) OR bundle_type<>'ORDER'),
  CHECK (is_current=0 OR superseded_by_version IS NULL),
  CHECK (
    -- Sealing implies a complete manifest; archive finality implies sealing,
    -- a verified Drive copy, and (outside shadow mode) completed hot deletes.
    (manifest_sha256 IS NULL) = (manifest_version IS NULL)
    AND (manifest_sha256 IS NULL) = (sealed_at IS NULL)
    AND (manifest_sha256 IS NULL) = (manifest_file_count IS NULL)
    AND (manifest_sha256 IS NULL) = (manifest_total_bytes IS NULL)
    AND (manifest_file_count IS NULL OR manifest_file_count<=5000)
  ),
  CHECK (
    (zip_sha256 IS NULL) = (zip_byte_size IS NULL)
    AND (zip_sha256 IS NULL) = (zip_mime IS NULL)
    AND (zip_sha256 IS NULL) = (temp_zip_object_key IS NULL)
    AND (zip_sha256 IS NOT NULL OR archived_at IS NULL)
  ),
  CHECK (
    drive_file_id IS NULL
    OR (drive_folder_id IS NOT NULL AND drive_uploaded_at IS NOT NULL)
  ),
  CHECK (
    archived_at IS NULL
    OR (drive_file_id IS NOT NULL AND drive_verified_at IS NOT NULL
      AND drive_folder_id IS NOT NULL AND zip_sha256 IS NOT NULL
      AND (hot_delete_completed_at IS NOT NULL OR shadow_completed_at IS NOT NULL)
      AND manifest_sha256 IS NOT NULL)
  ),
  CHECK (
    (state='ONLINE' AND archived_at IS NULL AND restore_expires_at IS NULL)
    OR (state='ARCHIVED' AND archived_at IS NOT NULL AND restore_expires_at IS NULL)
    OR (state='RESTORE_REQUESTED' AND archived_at IS NOT NULL)
    OR (state='RESTORING' AND archived_at IS NOT NULL)
    OR (state='RESTORED_TEMPORARILY' AND archived_at IS NOT NULL
      AND restore_expires_at IS NOT NULL)
    OR (state='RESTORE_FAILED' AND archived_at IS NOT NULL
      AND restore_expires_at IS NULL AND last_failure_category IS NOT NULL)
  ),
  CHECK (state<>'RESTORED_TEMPORARILY' OR hot_delete_completed_at IS NOT NULL OR shadow_completed_at IS NOT NULL)
) STRICT;

CREATE UNIQUE INDEX uq_archive_bundles_current
ON archive_bundles (bundle_type, ref_id) WHERE is_current=1;

CREATE INDEX idx_archive_bundles_scan
ON archive_bundles (is_current, state, next_retry_at, eligibility_at, id);

CREATE INDEX idx_archive_bundles_lease
ON archive_bundles (lease_expires_at, id);

CREATE TABLE archive_bundle_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  bundle_id TEXT NOT NULL REFERENCES archive_bundles(id),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  entry_index INTEGER NOT NULL CHECK (typeof(entry_index)='integer' AND entry_index>=0),
  safe_name TEXT NOT NULL CHECK (
    length(safe_name) BETWEEN 6 AND 200
    AND safe_name GLOB '[0-9][0-9][0-9][0-9]-[0-9a-f]*.*'
    AND safe_name NOT GLOB '*[^0-9a-zA-Z._-]*'),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF','ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'image/jpeg','image/png','image/webp','application/pdf'
  )),
  byte_size INTEGER NOT NULL CHECK (typeof(byte_size)='integer' AND byte_size>=0),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  source_etag TEXT CHECK (source_etag IS NULL OR length(source_etag) BETWEEN 1 AND 256),
  source_version INTEGER NOT NULL CHECK (typeof(source_version)='integer' AND source_version>=1),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'PRODUCT_APPLICATION','PRODUCT_VERSION','ORDER_INSTRUCTION_VERSION','ORDER',
    'ORDER_EVIDENCE_SUBMISSION','REVIEW','BUYER_REFUND','SELLER_SETTLEMENT','SUPPORT_CASE'
  )),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  source_created_at INTEGER NOT NULL CHECK (typeof(source_created_at)='integer' AND source_created_at>=0),
  delete_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (delete_state IN ('PENDING','DELETED')),
  deleted_at INTEGER CHECK (
    (delete_state='PENDING' AND deleted_at IS NULL)
    OR (delete_state='DELETED' AND typeof(deleted_at)='integer' AND deleted_at>=0)
  ),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (bundle_id, file_object_id),
  UNIQUE (bundle_id, safe_name)
) STRICT;

CREATE INDEX idx_archive_bundle_files_file
ON archive_bundle_files (file_object_id, delete_state, id);

CREATE INDEX idx_archive_bundle_files_pending_delete
ON archive_bundle_files (bundle_id, delete_state, entry_index);

CREATE TABLE archive_bundle_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  bundle_id TEXT NOT NULL REFERENCES archive_bundles(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'BUNDLE_CREATED','MANIFEST_SEALED','MANIFEST_SUPERSEDED','ZIP_STREAM_STARTED',
    'ZIP_STREAMED','DRIVE_UPLOAD_STARTED','DRIVE_UPLOAD_RESUMED','DRIVE_UPLOADED',
    'DRIVE_READBACK_VERIFIED','HOT_DELETE_STARTED','HOT_FILE_DELETED','HOT_DELETE_COMPLETED',
    'ARCHIVE_FINALIZED','SHADOW_COPY_COMPLETED','RESTORE_REQUESTED','RESTORE_STARTED',
    'RESTORE_COMPLETED','RESTORE_FAILED','RESTORE_RETRY_REQUESTED','RESTORE_EXPIRED',
    'ARCHIVE_ATTEMPT_FAILED','SUPERSEDED'
  )),
  bundle_version INTEGER NOT NULL CHECK (bundle_version>=1),
  phase TEXT CHECK (phase IS NULL OR phase IN (
    'MANIFEST','ZIP_STREAMING','DRIVE_UPLOADING','DRIVE_READBACK_VERIFY','HOT_DELETING',
    'ARCHIVE_FINALIZE','RESTORE_DOWNLOAD','RESTORE_VERIFY','RESTORE_EXTRACT','RESTORE_FINALIZE',
    'CLEANUP_SCAN','CLEANUP_DELETE'
  )),
  previous_state TEXT CHECK (previous_state IS NULL OR previous_state IN (
    'ONLINE','ARCHIVED','RESTORE_REQUESTED','RESTORING','RESTORED_TEMPORARILY','RESTORE_FAILED'
  )),
  next_state TEXT CHECK (next_state IS NULL OR next_state IN (
    'ONLINE','ARCHIVED','RESTORE_REQUESTED','RESTORING','RESTORED_TEMPORARILY','RESTORE_FAILED'
  )),
  failure_category TEXT CHECK (failure_category IS NULL OR failure_category IN (
    'file_integrity_mismatch','manifest_superseded','storage_stream_unavailable','temp_zip_failed',
    'drive_authorization_failed','drive_rate_limited','drive_unavailable','drive_session_conflict',
    'drive_not_found','drive_verification_failed','hot_delete_failed','restore_verify_failed',
    'restore_extract_failed','cleanup_failed','job_poison_message','dependency_unavailable'
  )),
  metadata_json TEXT NOT NULL CHECK (length(metadata_json)<=2000),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0)
) STRICT;

CREATE INDEX idx_archive_bundle_events_bundle
ON archive_bundle_events (bundle_id, created_at, id);

CREATE TABLE archive_jobs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  dedupe_key TEXT NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 16 AND 300),
  job_type TEXT NOT NULL CHECK (job_type IN (
    'ARCHIVE_BUNDLE','RESTORE_BUNDLE','CLEANUP_EXPIRED_RESTORE'
  )),
  bundle_id TEXT CHECK (bundle_id IS NULL OR length(bundle_id) BETWEEN 16 AND 120),
  bundle_version INTEGER CHECK (bundle_version IS NULL OR bundle_version>=1),
  phase TEXT CHECK (phase IS NULL OR phase IN (
    'MANIFEST','ZIP_STREAMING','DRIVE_UPLOADING','DRIVE_READBACK_VERIFY','HOT_DELETING',
    'ARCHIVE_FINALIZE','RESTORE_DOWNLOAD','RESTORE_VERIFY','RESTORE_EXTRACT','RESTORE_FINALIZE',
    'CLEANUP_SCAN','CLEANUP_DELETE'
  )),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN (
    'PENDING','LEASED','SUCCEEDED','FAILED_RETRYABLE','DEAD_LETTERED','CANCELLED'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(attempt_count)='integer' AND attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
  lease_token TEXT,
  lease_expires_at INTEGER,
  next_retry_at INTEGER CHECK (next_retry_at IS NULL OR (
    typeof(next_retry_at)='integer' AND next_retry_at>=0)),
  trace_id TEXT CHECK (trace_id IS NULL OR length(trace_id) BETWEEN 8 AND 120),
  queue_message_id TEXT CHECK (queue_message_id IS NULL OR length(queue_message_id) BETWEEN 1 AND 200),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN (
    'file_integrity_mismatch','manifest_superseded','storage_stream_unavailable','temp_zip_failed',
    'drive_authorization_failed','drive_rate_limited','drive_unavailable','drive_session_conflict',
    'drive_not_found','drive_verification_failed','hot_delete_failed','restore_verify_failed',
    'restore_extract_failed','cleanup_failed','job_poison_message','dependency_unavailable'
  )),
  error_summary TEXT CHECK (error_summary IS NULL OR length(error_summary) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  finished_at INTEGER CHECK (finished_at IS NULL OR (
    typeof(finished_at)='integer' AND finished_at>=created_at)),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK ((bundle_id IS NULL)=(bundle_version IS NULL)),
  CHECK (job_type='CLEANUP_EXPIRED_RESTORE' OR bundle_id IS NOT NULL),
  CHECK (
    (state IN ('SUCCEEDED','DEAD_LETTERED','CANCELLED') AND finished_at IS NOT NULL)
    OR (state IN ('PENDING','LEASED','FAILED_RETRYABLE') AND finished_at IS NULL)
  ),
  CHECK (state<>'DEAD_LETTERED' OR error_category IS NOT NULL),
  FOREIGN KEY (bundle_id) REFERENCES archive_bundles(id)
) STRICT;

CREATE INDEX idx_archive_jobs_ready
ON archive_jobs (state, next_retry_at, created_at, id);

CREATE INDEX idx_archive_jobs_bundle
ON archive_jobs (bundle_id, job_type, state, id);

CREATE TABLE archive_restores (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  bundle_id TEXT NOT NULL REFERENCES archive_bundles(id),
  bundle_version INTEGER NOT NULL CHECK (bundle_version>=1),
  requested_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  state TEXT NOT NULL CHECK (state IN (
    'REQUESTED','RESTORING','COMPLETED','FAILED','EXPIRED','CLEANED'
  )),
  restore_expires_at INTEGER NOT NULL CHECK (typeof(restore_expires_at)='integer' AND restore_expires_at>=0),
  temp_zip_object_key TEXT CHECK (temp_zip_object_key IS NULL OR (
    length(temp_zip_object_key) BETWEEN 20 AND 1024)),
  member_prefix TEXT CHECK (member_prefix IS NULL OR (
    length(member_prefix) BETWEEN 10 AND 256
    AND member_prefix GLOB 'archive-restore/[0-9a-f-]*/')),
  restored_file_count INTEGER CHECK (restored_file_count IS NULL OR (
    typeof(restored_file_count)='integer' AND restored_file_count>=0)),
  restored_bytes INTEGER CHECK (restored_bytes IS NULL OR (
    typeof(restored_bytes)='integer' AND restored_bytes>=0)),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN (
    'drive_not_found','drive_verification_failed','restore_verify_failed',
    'restore_extract_failed','storage_stream_unavailable','drive_unavailable',
    'drive_rate_limited','drive_authorization_failed','drive_session_conflict',
    'dependency_unavailable'
  )),
  request_id TEXT CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 200),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  completed_at INTEGER CHECK (completed_at IS NULL OR (
    typeof(completed_at)='integer' AND completed_at>=created_at)),
  cleaned_at INTEGER CHECK (cleaned_at IS NULL OR (
    typeof(cleaned_at)='integer' AND cleaned_at>=created_at)),
  UNIQUE (requested_by_staff_id, idempotency_key),
  CHECK (
    (state='REQUESTED' AND completed_at IS NULL AND cleaned_at IS NULL
      AND error_category IS NULL AND restored_file_count IS NULL)
    OR (state='RESTORING' AND completed_at IS NULL AND cleaned_at IS NULL
      AND error_category IS NULL)
    OR (state='COMPLETED' AND completed_at IS NOT NULL AND cleaned_at IS NULL
      AND error_category IS NULL AND restored_file_count IS NOT NULL
      AND temp_zip_object_key IS NOT NULL AND member_prefix IS NOT NULL)
    OR (state='FAILED' AND completed_at IS NOT NULL AND cleaned_at IS NULL
      AND error_category IS NOT NULL)
    OR (state='EXPIRED' AND completed_at IS NOT NULL AND cleaned_at IS NULL)
    OR (state='CLEANED' AND completed_at IS NOT NULL AND cleaned_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_archive_restores_expiry
ON archive_restores (state, restore_expires_at, id);

CREATE TABLE archive_restore_members (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  restore_id TEXT NOT NULL REFERENCES archive_restores(id),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  expected_sha256 TEXT NOT NULL CHECK (length(expected_sha256)=64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'),
  temp_object_key TEXT NOT NULL CHECK (length(temp_object_key) BETWEEN 20 AND 1024),
  byte_size INTEGER NOT NULL CHECK (typeof(byte_size)='integer' AND byte_size>=0),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (restore_id, file_object_id),
  UNIQUE (temp_object_key)
) STRICT;

CREATE INDEX idx_archive_restore_members_file
ON archive_restore_members (file_object_id, restore_id);

-- Selector lookups at 20k-order scale: the covered/current bundle lookup by
-- unit key must be an index seek, not a table scan over every bundle.
CREATE INDEX idx_archive_bundles_unit
ON archive_bundles (bundle_type, ref_id, bundle_version, is_current);

CREATE TRIGGER trg_archive_runtime_controls_no_delete
BEFORE DELETE ON archive_runtime_controls
BEGIN SELECT RAISE(ABORT,'archive_runtime_controls_are_required'); END;

CREATE TRIGGER trg_archive_runtime_controls_update_guard
BEFORE UPDATE ON archive_runtime_controls
WHEN NEW.singleton_id<>OLD.singleton_id OR NEW.version<>OLD.version+1
  OR NEW.updated_at<=OLD.updated_at
BEGIN SELECT RAISE(ABORT,'archive_runtime_controls_invalid_update'); END;

CREATE TRIGGER trg_archive_bundles_no_delete
BEFORE DELETE ON archive_bundles
BEGIN SELECT RAISE(ABORT,'archive_bundles_are_immutable'); END;

CREATE TRIGGER trg_archive_bundles_insert_guard
BEFORE INSERT ON archive_bundles
WHEN NEW.version<>1 OR NEW.state<>'ONLINE' OR NEW.is_current<>1
  OR NEW.attempt_count<>0 OR NEW.sealed_at IS NOT NULL OR NEW.manifest_sha256 IS NOT NULL
  OR NEW.zip_sha256 IS NOT NULL OR NEW.drive_file_id IS NOT NULL
  OR NEW.archived_at IS NOT NULL OR NEW.shadow_completed_at IS NOT NULL
  OR NEW.hot_delete_completed_at IS NOT NULL OR NEW.superseded_by_version IS NOT NULL
  OR (NEW.lease_token IS NULL)!=(NEW.lease_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT,'archive_bundle_invalid_insert'); END;

CREATE TRIGGER trg_archive_bundles_update_guard
BEFORE UPDATE ON archive_bundles
WHEN NEW.id IS NOT OLD.id OR NEW.bundle_type IS NOT OLD.bundle_type
  OR NEW.ref_id IS NOT OLD.ref_id OR NEW.formal_order_id IS NOT OLD.formal_order_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.bundle_version IS NOT OLD.bundle_version
  OR NEW.eligibility_at IS NOT OLD.eligibility_at
  -- One-way facts: once written they may never change, only appear (NULL->value).
  OR (NEW.sealed_at IS NOT OLD.sealed_at AND OLD.sealed_at IS NOT NULL)
  OR (NEW.manifest_version IS NOT OLD.manifest_version AND OLD.manifest_version IS NOT NULL)
  OR (NEW.manifest_sha256 IS NOT OLD.manifest_sha256 AND OLD.manifest_sha256 IS NOT NULL)
  OR (NEW.manifest_file_count IS NOT OLD.manifest_file_count AND OLD.manifest_file_count IS NOT NULL)
  OR (NEW.manifest_total_bytes IS NOT OLD.manifest_total_bytes AND OLD.manifest_total_bytes IS NOT NULL)
  OR (NEW.zip_byte_size IS NOT OLD.zip_byte_size AND OLD.zip_byte_size IS NOT NULL)
  OR (NEW.zip_mime IS NOT OLD.zip_mime AND OLD.zip_mime IS NOT NULL)
  OR (NEW.zip_sha256 IS NOT OLD.zip_sha256 AND OLD.zip_sha256 IS NOT NULL)
  OR (NEW.temp_zip_object_key IS NOT OLD.temp_zip_object_key AND OLD.temp_zip_object_key IS NOT NULL)
  OR (NEW.drive_uploaded_at IS NOT OLD.drive_uploaded_at AND OLD.drive_uploaded_at IS NOT NULL)
  OR (NEW.drive_verified_at IS NOT OLD.drive_verified_at AND OLD.drive_verified_at IS NOT NULL)
  OR (NEW.hot_delete_completed_at IS NOT OLD.hot_delete_completed_at AND OLD.hot_delete_completed_at IS NOT NULL)
  OR (NEW.archived_at IS NOT OLD.archived_at AND OLD.archived_at IS NOT NULL)
  OR (NEW.shadow_completed_at IS NOT OLD.shadow_completed_at AND OLD.shadow_completed_at IS NOT NULL)
  OR (NEW.hot_files_total IS NOT OLD.hot_files_total AND OLD.hot_files_total IS NOT NULL)
  -- Drive identity is one-way once recorded; the session key may be set and cleared.
  OR (NEW.drive_file_id IS NOT OLD.drive_file_id AND OLD.drive_file_id IS NOT NULL)
  OR (OLD.superseded_by_version IS NOT NULL AND NEW.superseded_by_version IS NOT OLD.superseded_by_version)
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT (
    (OLD.state='ONLINE' AND NEW.state IN ('ONLINE','ARCHIVED'))
    OR (OLD.state='ARCHIVED' AND NEW.state IN ('ARCHIVED','RESTORE_REQUESTED'))
    OR (OLD.state='RESTORE_REQUESTED' AND NEW.state IN ('RESTORE_REQUESTED','RESTORING','ARCHIVED'))
    OR (OLD.state='RESTORING' AND NEW.state IN ('RESTORING','RESTORED_TEMPORARILY','RESTORE_FAILED'))
    OR (OLD.state='RESTORED_TEMPORARILY' AND NEW.state IN ('RESTORED_TEMPORARILY','ARCHIVED'))
    OR (OLD.state='RESTORE_FAILED' AND NEW.state IN ('RESTORE_FAILED','RESTORE_REQUESTED'))
  )
  OR (NEW.state='ARCHIVED' AND NEW.archived_at IS NULL)
  OR (NEW.state='ARCHIVED' AND OLD.state<>'ARCHIVED' AND NOT EXISTS (
    SELECT 1 FROM archive_jobs job
    WHERE job.bundle_id=NEW.id AND job.bundle_version=NEW.bundle_version
      AND job.job_type='ARCHIVE_BUNDLE' AND job.state='SUCCEEDED'
  ))
  OR (NEW.state='RESTORED_TEMPORARILY' AND NEW.restore_expires_at IS NULL)
  OR (NEW.state='ARCHIVED' AND OLD.state='RESTORED_TEMPORARILY' AND NEW.restore_expires_at IS NOT NULL)
  OR (OLD.is_current=1 AND NEW.is_current=0 AND NEW.superseded_by_version IS NULL)
  OR (NEW.hot_files_deleted>COALESCE(NEW.hot_files_total,NEW.hot_files_deleted))
  OR (NEW.hot_delete_completed_at IS NOT NULL AND NEW.hot_files_deleted IS NOT NULL
    AND NEW.hot_files_total IS NOT NULL AND NEW.hot_files_deleted<>NEW.hot_files_total)
BEGIN SELECT RAISE(ABORT,'archive_bundle_invalid_transition'); END;

CREATE TRIGGER trg_archive_bundle_events_no_update
BEFORE UPDATE ON archive_bundle_events
BEGIN SELECT RAISE(ABORT,'archive_bundle_events_are_immutable'); END;

CREATE TRIGGER trg_archive_bundle_events_no_delete
BEFORE DELETE ON archive_bundle_events
BEGIN SELECT RAISE(ABORT,'archive_bundle_events_are_immutable'); END;

CREATE TRIGGER trg_archive_bundle_files_no_delete
BEFORE DELETE ON archive_bundle_files
WHEN EXISTS (
  SELECT 1 FROM archive_bundles bundle
  WHERE bundle.id=OLD.bundle_id AND bundle.sealed_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'sealed_manifest_entries_are_immutable'); END;

CREATE TRIGGER trg_archive_bundle_files_insert_guard
BEFORE INSERT ON archive_bundle_files
WHEN NOT EXISTS (
  SELECT 1 FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN archive_bundles bundle ON bundle.id=NEW.bundle_id
  WHERE object.id=NEW.file_object_id AND object.status='VERIFIED'
    AND intent.status='VERIFIED' AND object.purpose=NEW.purpose
    AND object.visibility=NEW.visibility
    AND object.detected_mime=NEW.mime_type
    AND object.uploaded_byte_size=NEW.byte_size
    AND object.uploaded_sha256=NEW.sha256
    AND object.version=NEW.source_version
    AND bundle.sealed_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'archive_bundle_file_source_mismatch'); END;

CREATE TRIGGER trg_archive_bundle_files_update_guard
BEFORE UPDATE ON archive_bundle_files
WHEN NEW.id IS NOT OLD.id OR NEW.bundle_id IS NOT OLD.bundle_id
  OR NEW.file_object_id IS NOT OLD.file_object_id OR NEW.entry_index IS NOT OLD.entry_index
  OR NEW.safe_name IS NOT OLD.safe_name OR NEW.purpose IS NOT OLD.purpose
  OR NEW.visibility IS NOT OLD.visibility OR NEW.mime_type IS NOT OLD.mime_type
  OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256
  OR NEW.source_etag IS NOT OLD.source_etag OR NEW.source_version IS NOT OLD.source_version
  OR NEW.entity_type IS NOT OLD.entity_type OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.source_created_at IS NOT OLD.source_created_at
  OR NEW.created_at IS NOT OLD.created_at
  OR NOT (
    (OLD.delete_state='PENDING' AND NEW.delete_state IN ('PENDING','DELETED'))
    OR (OLD.delete_state='DELETED' AND NEW.delete_state='DELETED')
  )
  OR (NEW.delete_state='DELETED' AND NEW.deleted_at IS NULL)
  OR (NEW.delete_state='PENDING' AND NEW.deleted_at IS NOT NULL)
  OR (NEW.delete_state='DELETED' AND NOT EXISTS (
    SELECT 1 FROM archive_bundles bundle
    WHERE bundle.id=NEW.bundle_id AND bundle.drive_verified_at IS NOT NULL
  ))
BEGIN SELECT RAISE(ABORT,'archive_bundle_file_invalid_transition'); END;

CREATE TRIGGER trg_archive_jobs_no_delete
BEFORE DELETE ON archive_jobs
BEGIN SELECT RAISE(ABORT,'archive_jobs_are_immutable'); END;

CREATE TRIGGER trg_archive_jobs_update_guard
BEFORE UPDATE ON archive_jobs
WHEN NEW.id IS NOT OLD.id OR NEW.dedupe_key IS NOT OLD.dedupe_key
  OR NEW.job_type IS NOT OLD.job_type OR NEW.bundle_id IS NOT OLD.bundle_id
  OR NEW.bundle_version IS NOT OLD.bundle_version OR NEW.created_at IS NOT OLD.created_at
  OR NEW.max_attempts IS NOT OLD.max_attempts OR NEW.trace_id IS NOT OLD.trace_id
  OR NEW.queue_message_id IS NOT OLD.queue_message_id
  OR NEW.updated_at<OLD.updated_at
  OR NOT (
    (OLD.state='PENDING' AND NEW.state IN ('PENDING','LEASED','SUCCEEDED','CANCELLED'))
    OR (OLD.state='LEASED' AND NEW.state IN ('LEASED','SUCCEEDED','FAILED_RETRYABLE','PENDING','DEAD_LETTERED'))
    OR (OLD.state='FAILED_RETRYABLE' AND NEW.state IN ('FAILED_RETRYABLE','LEASED','DEAD_LETTERED','CANCELLED'))
    OR (OLD.state='SUCCEEDED' AND NEW.state='SUCCEEDED')
    OR (OLD.state='DEAD_LETTERED' AND NEW.state='DEAD_LETTERED')
    OR (OLD.state='CANCELLED' AND NEW.state='CANCELLED')
  )
  OR (NEW.state IN ('PENDING','FAILED_RETRYABLE') AND NEW.lease_token IS NOT NULL)
  OR (NEW.state='LEASED' AND (NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL))
  OR (NEW.state='SUCCEEDED' AND NEW.finished_at IS NULL)
  OR (NEW.state='DEAD_LETTERED' AND (NEW.finished_at IS NULL OR NEW.error_category IS NULL))
  OR (NEW.state='FAILED_RETRYABLE' AND NEW.next_retry_at IS NULL)
  OR (NEW.attempt_count<OLD.attempt_count)
BEGIN SELECT RAISE(ABORT,'archive_job_invalid_transition'); END;

CREATE TRIGGER trg_archive_restores_no_delete
BEFORE DELETE ON archive_restores
BEGIN SELECT RAISE(ABORT,'archive_restores_are_immutable'); END;

CREATE TRIGGER trg_archive_restores_update_guard
BEFORE UPDATE ON archive_restores
WHEN NEW.id IS NOT OLD.id OR NEW.bundle_id IS NOT OLD.bundle_id
  OR NEW.bundle_version IS NOT OLD.bundle_version
  OR NEW.requested_by_staff_id IS NOT OLD.requested_by_staff_id
  OR NEW.request_hash IS NOT OLD.request_hash OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.restore_expires_at IS NOT OLD.restore_expires_at
  -- member_prefix is one-way: written once at completion, then fixed.
  OR (NEW.member_prefix IS NOT OLD.member_prefix AND OLD.member_prefix IS NOT NULL)
  OR (NEW.temp_zip_object_key IS NOT OLD.temp_zip_object_key AND OLD.temp_zip_object_key IS NOT NULL)
  OR NEW.request_id IS NOT OLD.request_id OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT (
    (OLD.state='REQUESTED' AND NEW.state IN ('REQUESTED','RESTORING','FAILED'))
    OR (OLD.state='RESTORING' AND NEW.state IN ('RESTORING','COMPLETED','FAILED'))
    OR (OLD.state='COMPLETED' AND NEW.state IN ('COMPLETED','EXPIRED'))
    OR (OLD.state='EXPIRED' AND NEW.state IN ('EXPIRED','CLEANED'))
    OR (OLD.state='FAILED' AND NEW.state='FAILED')
    OR (OLD.state='CLEANED' AND NEW.state='CLEANED')
  )
  OR (NEW.state='COMPLETED' AND NEW.completed_at IS NULL)
  OR (NEW.state='FAILED' AND NEW.completed_at IS NULL)
  OR (NEW.state='EXPIRED' AND (NEW.completed_at IS NULL OR NEW.cleaned_at IS NOT NULL))
  OR (NEW.state='CLEANED' AND NEW.cleaned_at IS NULL)
BEGIN SELECT RAISE(ABORT,'archive_restore_invalid_transition'); END;

CREATE TRIGGER trg_archive_restore_members_no_update
BEFORE UPDATE ON archive_restore_members
BEGIN SELECT RAISE(ABORT,'archive_restore_members_are_immutable'); END;

CREATE TRIGGER trg_archive_restore_members_no_delete
BEFORE DELETE ON archive_restore_members
BEGIN SELECT RAISE(ABORT,'archive_restore_members_are_immutable'); END;

INSERT INTO archive_runtime_controls (
  singleton_id, selector_enabled, drive_upload_enabled, hot_delete_enabled,
  restore_worker_enabled, shadow_copy_only, drive_max_concurrency,
  queue_batch_size, version, updated_at
) VALUES (
  1, 0, 0, 0, 0, 1, 3, 5, 1, 1787661495000
);

UPDATE app_schema_state
SET
  schema_version=24,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
