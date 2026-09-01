-- Baseline 0018 operations_archive_recovery (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=17 THEN 1 ELSE 0 END;

CREATE TABLE drive_archive_controls (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  copy_enabled INTEGER NOT NULL DEFAULT 0 CHECK (copy_enabled IN (0,1)),
  proxy_read_enabled INTEGER NOT NULL DEFAULT 0 CHECK (proxy_read_enabled IN (0,1)),
  r2_delete_enabled INTEGER NOT NULL DEFAULT 0 CHECK (r2_delete_enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=0),
  CHECK (r2_delete_enabled=0 OR (copy_enabled=1 AND proxy_read_enabled=1))
) STRICT;

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

CREATE TABLE file_drive_archive_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  file_object_id TEXT NOT NULL REFERENCES file_drive_archives(file_object_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ELIGIBILITY_RECORDED','COPY_STARTED','COPY_RESUMED','COPY_FAILED',
    'DRIVE_UPLOAD_RECORDED','DRIVE_VERIFIED','R2_DELETE_REQUESTED','R2_DELETE_FAILED','DRIVE_ARCHIVED',
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

CREATE TABLE file_drive_rehydrations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  file_object_id TEXT NOT NULL REFERENCES file_drive_archives(file_object_id),
  target_object_key TEXT NOT NULL CHECK (length(target_object_key) BETWEEN 1 AND 1024),
  status TEXT NOT NULL CHECK (status IN ('STARTED','COMPLETED','FAILED')),
  expected_sha256 TEXT NOT NULL CHECK (length(expected_sha256)=64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'),
  expected_archive_version INTEGER NOT NULL CHECK (expected_archive_version>=1),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  failure_category TEXT CHECK (failure_category IS NULL OR length(failure_category) BETWEEN 1 AND 100),
  requested_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  request_id TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  attempt_count INTEGER NOT NULL CHECK (attempt_count>=1),
  version INTEGER NOT NULL CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  completed_at INTEGER,
  UNIQUE(requested_by_staff_id,idempotency_key),
  CHECK (
    (status='STARTED' AND failure_category IS NULL AND completed_at IS NULL)
    OR (status='COMPLETED' AND failure_category IS NULL AND completed_at IS NOT NULL)
    OR (status='FAILED' AND failure_category IS NOT NULL AND completed_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE order_archive_closures (
  formal_order_id TEXT PRIMARY KEY REFERENCES formal_orders(id),
  review_state TEXT NOT NULL CHECK (review_state IN ('COMPLETED','NOT_APPLICABLE')),
  buyer_refund_state TEXT NOT NULL CHECK (buyer_refund_state IN ('COMPLETED','NOT_APPLICABLE')),
  seller_principal_state TEXT NOT NULL CHECK (seller_principal_state IN ('COMPLETED','NOT_APPLICABLE')),
  seller_service_fee_state TEXT NOT NULL CHECK (seller_service_fee_state IN ('COMPLETED','NOT_APPLICABLE')),
  status TEXT NOT NULL CHECK (status IN ('CLOSED','REOPENED')),
  business_closed_at INTEGER NOT NULL CHECK (typeof(business_closed_at)='integer' AND business_closed_at>=0),
  archive_due_at INTEGER NOT NULL CHECK (typeof(archive_due_at)='integer' AND archive_due_at>=business_closed_at),
  closed_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  close_reason TEXT NOT NULL CHECK (length(close_reason) BETWEEN 1 AND 2000),
  close_idempotency_key TEXT NOT NULL CHECK (length(close_idempotency_key) BETWEEN 8 AND 128),
  reopened_at INTEGER CHECK (reopened_at IS NULL OR (typeof(reopened_at)='integer' AND reopened_at>=business_closed_at)),
  reopened_by_staff_id TEXT REFERENCES staff_users(id),
  reopen_reason TEXT CHECK (reopen_reason IS NULL OR length(reopen_reason) BETWEEN 1 AND 2000),
  reopen_idempotency_key TEXT CHECK (reopen_idempotency_key IS NULL OR length(reopen_idempotency_key) BETWEEN 8 AND 128),
  version INTEGER NOT NULL CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=created_at),
  CHECK (
    (status='CLOSED' AND reopened_at IS NULL AND reopened_by_staff_id IS NULL
      AND reopen_reason IS NULL AND reopen_idempotency_key IS NULL)
    OR (status='REOPENED' AND reopened_at IS NOT NULL AND reopened_by_staff_id IS NOT NULL
      AND reopen_reason IS NOT NULL AND reopen_idempotency_key IS NOT NULL)
  )
) STRICT;

CREATE TABLE production_recovery_attestations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  release_sha TEXT NOT NULL CHECK (length(release_sha) BETWEEN 7 AND 64),
  schema_version INTEGER NOT NULL CHECK (schema_version>=1),
  d1_manifest_sha256 TEXT NOT NULL CHECK (length(d1_manifest_sha256)=64 AND d1_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  r2_manifest_sha256 TEXT NOT NULL CHECK (length(r2_manifest_sha256)=64 AND r2_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  restored_database_integrity_ok INTEGER NOT NULL CHECK (restored_database_integrity_ok=1),
  restored_foreign_keys_ok INTEGER NOT NULL CHECK (restored_foreign_keys_ok=1),
  r2_sample_readback_ok INTEGER NOT NULL CHECK (r2_sample_readback_ok=1),
  verified_at INTEGER NOT NULL CHECK (verified_at>=0),
  verified_by_staff_id TEXT REFERENCES staff_users(id),
  evidence_note TEXT NOT NULL CHECK (length(evidence_note) BETWEEN 8 AND 2000)
) STRICT;

CREATE TABLE "scheduled_alert_states" (
  signal_type TEXT NOT NULL CHECK (signal_type IN ('worker_5xx','job_stale','lease_stuck','backlog_sustained','file_failure','login_anomaly','external_adapter_failure')),
  job_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('worker','scheduler','file','auth','external')),
  severity TEXT NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  summary_code TEXT NOT NULL CHECK (summary_code IN ('WORKER_5XX_THRESHOLD','JOB_SUCCESS_STALE','JOB_LEASE_STUCK','JOB_BACKLOG_SUSTAINED','FILE_PROCESSING_FAILURE','LOGIN_ANOMALY_DETECTED','PRIMARY_ALERT_SINK_FAILURE')),
  status TEXT NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  first_seen_at INTEGER,
  last_seen_at INTEGER,
  consecutive_breach_count INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_breach_count>=0),
  consecutive_healthy_count INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_healthy_count>=0),
  window_started_at INTEGER NOT NULL CHECK (typeof(window_started_at)='integer' AND window_started_at>=0),
  window_count_value INTEGER NOT NULL DEFAULT 0 CHECK (window_count_value>=0),
  threshold_count INTEGER NOT NULL CHECK (threshold_count>=1),
  threshold_window_ms INTEGER NOT NULL CHECK (threshold_window_ms>=1),
  recovery_count INTEGER NOT NULL CHECK (recovery_count>=1),
  opened_at INTEGER,
  acknowledged_at INTEGER,
  resolved_at INTEGER,
  cooldown_until INTEGER,
  suppressed_until INTEGER,
  last_notification_at INTEGER,
  last_evaluated_at INTEGER NOT NULL CHECK (typeof(last_evaluated_at)='integer' AND last_evaluated_at>=0),
  incident_version INTEGER NOT NULL DEFAULT 0 CHECK (incident_version>=0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=0),
  PRIMARY KEY(signal_type,job_name,summary_code),
  CHECK ((status='RESOLVED' AND resolved_at IS NOT NULL) OR (status='OPEN' AND opened_at IS NOT NULL) OR (status='ACKNOWLEDGED' AND opened_at IS NOT NULL AND acknowledged_at IS NOT NULL))
) STRICT;

CREATE TABLE "scheduled_job_states" (
  job_name TEXT PRIMARY KEY CHECK (job_name IN (
    'reservation_expiry','instruction_expiry','outbox_delivery',
    'file_orphan_cleanup','drive_archive'
  )),
  cursor_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  lease_token TEXT,
  lease_expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  last_started_at INTEGER,
  last_succeeded_at INTEGER,
  last_failed_at INTEGER,
  last_failure_category TEXT,
  last_backlog_count INTEGER NOT NULL DEFAULT 0 CHECK (last_backlog_count>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=0)
);

CREATE TABLE "scheduled_dead_letters" (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL REFERENCES scheduled_job_states(job_name),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('OUTBOX','FILE')),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  failure_category TEXT NOT NULL CHECK (failure_category IN ('adapter_unavailable','delivery_failed','provider_rate_limited','provider_unavailable','contract_rejected','file_cleanup_deferred','job_item_failed','job_execution_failed')),
  attempt_count INTEGER NOT NULL CHECK (attempt_count>=1),
  quarantined_at INTEGER NOT NULL CHECK (typeof(quarantined_at)='integer' AND quarantined_at>=0),
  replay_status TEXT NOT NULL DEFAULT 'QUARANTINED' CHECK (replay_status IN ('QUARANTINED','PROCESSING','REPLAYED')),
  replay_lease_token TEXT,
  replay_lease_expires_at INTEGER,
  replay_version INTEGER NOT NULL DEFAULT 1 CHECK (replay_version>=1),
  replayed_at INTEGER,
  replayed_by_staff_id TEXT REFERENCES staff_users(id),
  replay_request_id TEXT,
  replay_idempotency_key TEXT,
  UNIQUE(job_name,source_kind,source_id),
  CHECK (
    (replay_status='QUARANTINED' AND replay_lease_token IS NULL
      AND replay_lease_expires_at IS NULL AND replayed_at IS NULL
      AND replayed_by_staff_id IS NULL)
    OR (replay_status='PROCESSING' AND replay_lease_token IS NOT NULL
      AND replay_lease_expires_at IS NOT NULL AND replayed_at IS NULL
      AND replayed_by_staff_id IS NULL)
    OR (replay_status='REPLAYED' AND replay_lease_token IS NULL
      AND replay_lease_expires_at IS NULL AND replayed_at IS NOT NULL
      AND replayed_by_staff_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE scheduled_job_runs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL REFERENCES scheduled_job_states(job_name),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('CRON','MANUAL')),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','PARTIAL','FAILED','SKIPPED','DISABLED')),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  succeeded_count INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  backlog_count INTEGER NOT NULL DEFAULT 0 CHECK (backlog_count >= 0),
  failure_category TEXT,
  request_id TEXT,
  started_at INTEGER NOT NULL CHECK (typeof(started_at)='integer' AND started_at >= 0),
  finished_at INTEGER NOT NULL CHECK (finished_at >= started_at)
);

CREATE TABLE scheduled_manual_commands (
  id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL CHECK (command_type IN ('RUN_JOB','REPLAY_DEAD_LETTER')),
  job_name TEXT NOT NULL REFERENCES scheduled_job_states(job_name),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 200),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('OPERATOR_RETRY','BACKLOG_RECOVERY','DEPENDENCY_RECOVERED','POISON_RECOVERY')),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  request_id TEXT,
  outcome TEXT CHECK (outcome IN ('SUCCEEDED','PARTIAL','FAILED','SKIPPED','DISABLED')),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  completed_at INTEGER,
  UNIQUE(staff_id,idempotency_key)
) STRICT;

CREATE TABLE "scheduled_operational_signals" (
  id TEXT PRIMARY KEY CHECK (length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'),
  signal_type TEXT NOT NULL CHECK (signal_type IN ('worker_5xx','job_stale','lease_stuck','backlog_sustained','file_failure','login_anomaly','external_adapter_failure')),
  category TEXT NOT NULL CHECK (category IN ('worker','scheduler','file','auth','external')),
  severity TEXT NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  summary_code TEXT NOT NULL CHECK (summary_code IN ('WORKER_5XX_THRESHOLD','JOB_SUCCESS_STALE','JOB_LEASE_STUCK','JOB_BACKLOG_SUSTAINED','FILE_PROCESSING_FAILURE','LOGIN_ANOMALY_DETECTED','PRIMARY_ALERT_SINK_FAILURE')),
  job_name TEXT REFERENCES scheduled_job_states(job_name),
  observation_state TEXT NOT NULL CHECK (observation_state IN ('BREACH','HEALTHY')),
  observed_at INTEGER NOT NULL CHECK (typeof(observed_at)='integer' AND observed_at>=0),
  count_value INTEGER NOT NULL CHECK (count_value>=0),
  evaluated_at INTEGER CHECK (evaluated_at IS NULL OR (typeof(evaluated_at)='integer' AND evaluated_at>=observed_at)),
  CHECK ((observation_state='BREACH' AND count_value>=1) OR (observation_state='HEALTHY' AND count_value=0))
) STRICT;

CREATE TABLE scheduled_operations_permission_catalog (
  permission_code TEXT PRIMARY KEY CHECK (permission_code='SCHEDULED_OPERATIONS_RUN'),
  default_role_code TEXT NOT NULL CHECK (default_role_code='owner'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0)
) STRICT;

CREATE INDEX idx_file_drive_archive_events_file
ON file_drive_archive_events(file_object_id,created_at,id);

CREATE INDEX idx_file_drive_archive_reconciliations_file
ON file_drive_archive_reconciliations(file_object_id,checked_at,id);

CREATE INDEX idx_file_drive_archives_due
ON file_drive_archives(status,next_retry_at,archive_due_at,file_object_id);

CREATE INDEX idx_file_drive_archives_lease
ON file_drive_archives(lease_expires_at,file_object_id);

CREATE INDEX idx_order_archive_closures_due
ON order_archive_closures(status,archive_due_at,formal_order_id);

CREATE INDEX idx_production_recovery_attestation_schema
ON production_recovery_attestations(schema_version DESC,verified_at DESC,id DESC);

CREATE INDEX idx_scheduled_job_runs_job_finished ON scheduled_job_runs(job_name, finished_at DESC);

CREATE INDEX idx_scheduled_operational_signals_lookup
ON scheduled_operational_signals(signal_type,job_name,observed_at);

CREATE TRIGGER trg_drive_archive_controls_no_delete
BEFORE DELETE ON drive_archive_controls
BEGIN SELECT RAISE(ABORT,'drive_archive_controls_are_required'); END;

CREATE TRIGGER trg_drive_archive_controls_update_guard
BEFORE UPDATE ON drive_archive_controls
WHEN NEW.singleton_id<>OLD.singleton_id OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN SELECT RAISE(ABORT,'drive_archive_controls_invalid_update'); END;

CREATE TRIGGER trg_file_drive_archive_events_no_delete
BEFORE DELETE ON file_drive_archive_events
BEGIN SELECT RAISE(ABORT,'file_drive_archive_events_are_immutable'); END;

CREATE TRIGGER trg_file_drive_archive_events_no_update
BEFORE UPDATE ON file_drive_archive_events
BEGIN SELECT RAISE(ABORT,'file_drive_archive_events_are_immutable'); END;

CREATE TRIGGER trg_file_drive_archive_insert_guard
BEFORE INSERT ON file_drive_archives
WHEN NEW.status<>'R2_HOT' OR NEW.version<>1 OR NOT EXISTS (
  SELECT 1 FROM file_objects object JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  WHERE object.id=NEW.file_object_id AND object.status='VERIFIED' AND intent.status='VERIFIED'
    AND object.purpose=NEW.purpose
)
BEGIN SELECT RAISE(ABORT,'file_drive_archive_source_mismatch'); END;

CREATE TRIGGER trg_file_drive_archive_manifests_no_delete
BEFORE DELETE ON file_drive_archive_manifests
BEGIN SELECT RAISE(ABORT,'file_drive_archive_manifests_are_immutable'); END;

CREATE TRIGGER trg_file_drive_archive_manifests_no_update
BEFORE UPDATE ON file_drive_archive_manifests
BEGIN SELECT RAISE(ABORT,'file_drive_archive_manifests_are_immutable'); END;

CREATE TRIGGER trg_file_drive_archive_reconciliations_no_delete
BEFORE DELETE ON file_drive_archive_reconciliations
BEGIN SELECT RAISE(ABORT,'file_drive_archive_reconciliations_are_immutable'); END;

CREATE TRIGGER trg_file_drive_archive_reconciliations_no_update
BEFORE UPDATE ON file_drive_archive_reconciliations
BEGIN SELECT RAISE(ABORT,'file_drive_archive_reconciliations_are_immutable'); END;

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

CREATE TRIGGER trg_file_drive_rehydration_insert_guard
BEFORE INSERT ON file_drive_rehydrations
WHEN NEW.status<>'STARTED' OR NEW.version<>1 OR NEW.attempt_count<>1
  OR NEW.updated_at<>NEW.created_at OR NEW.completed_at IS NOT NULL OR NEW.failure_category IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM file_drive_archives archive
    JOIN file_drive_archive_manifests manifest ON manifest.file_object_id=archive.file_object_id
    JOIN file_objects object ON object.id=archive.file_object_id
    WHERE archive.file_object_id=NEW.file_object_id AND archive.status='DRIVE_ARCHIVED'
      AND archive.version=NEW.expected_archive_version
      AND manifest.sha256=NEW.expected_sha256 AND object.object_key=NEW.target_object_key
  )
BEGIN SELECT RAISE(ABORT,'file_drive_rehydration_source_mismatch'); END;

CREATE TRIGGER trg_file_drive_rehydration_update_guard
BEFORE UPDATE ON file_drive_rehydrations
WHEN NOT (NEW.id IS OLD.id) OR NOT (NEW.file_object_id IS OLD.file_object_id)
  OR NOT (NEW.target_object_key IS OLD.target_object_key) OR NOT (NEW.expected_sha256 IS OLD.expected_sha256)
  OR NOT (NEW.expected_archive_version IS OLD.expected_archive_version)
  OR NOT (NEW.request_hash IS OLD.request_hash)
  OR NOT (NEW.requested_by_staff_id IS OLD.requested_by_staff_id) OR NOT (NEW.request_id IS OLD.request_id)
  OR NOT (NEW.idempotency_key IS OLD.idempotency_key) OR NOT (NEW.created_at IS OLD.created_at)
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT (
    (OLD.status='STARTED' AND NEW.status IN ('COMPLETED','FAILED')
      AND NEW.attempt_count=OLD.attempt_count AND NEW.completed_at IS NOT NULL)
    OR (OLD.status='STARTED' AND NEW.status='STARTED'
      AND NEW.attempt_count=OLD.attempt_count+1
      AND NEW.failure_category IS NULL AND NEW.completed_at IS NULL)
    OR (OLD.status='FAILED' AND NEW.status='STARTED'
      AND NEW.attempt_count=OLD.attempt_count+1
      AND NEW.failure_category IS NULL AND NEW.completed_at IS NULL)
  )
BEGIN SELECT RAISE(ABORT,'file_drive_rehydration_invalid_transition'); END;

CREATE TRIGGER trg_file_drive_rehydrations_no_delete
BEFORE DELETE ON file_drive_rehydrations
BEGIN SELECT RAISE(ABORT,'file_drive_rehydrations_are_immutable'); END;

CREATE TRIGGER trg_order_archive_closure_insert_guard
BEFORE INSERT ON order_archive_closures
WHEN NEW.status<>'CLOSED' OR NEW.version<>1 OR NEW.created_at<>NEW.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.confirmed_at<=NEW.business_closed_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.closed_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  )
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED'
      AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id
          AND entry.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund
    WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;

CREATE TRIGGER trg_order_archive_closure_reclose_source_guard
BEFORE UPDATE ON order_archive_closures
WHEN OLD.status='REOPENED' AND NEW.status='CLOSED' AND (
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.confirmed_at<=NEW.business_closed_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.closed_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  )
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED'
      AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id
          AND entry.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund
    WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
)
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;

CREATE TRIGGER trg_order_archive_closure_update_guard
BEFORE UPDATE ON order_archive_closures
WHEN NOT (NEW.formal_order_id IS OLD.formal_order_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR (OLD.status='CLOSED' AND NEW.status='REOPENED' AND NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.reopened_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  ))
  OR NOT (
    (OLD.status='CLOSED' AND NEW.status='REOPENED'
      AND NEW.review_state IS OLD.review_state
      AND NEW.buyer_refund_state IS OLD.buyer_refund_state
      AND NEW.seller_principal_state IS OLD.seller_principal_state
      AND NEW.seller_service_fee_state IS OLD.seller_service_fee_state
      AND NEW.business_closed_at IS OLD.business_closed_at
      AND NEW.archive_due_at IS OLD.archive_due_at
      AND NEW.closed_by_staff_id IS OLD.closed_by_staff_id
      AND NEW.close_reason IS OLD.close_reason
      AND NEW.close_idempotency_key IS OLD.close_idempotency_key
      AND NEW.reopened_at IS NOT NULL
      AND NEW.reopened_by_staff_id IS NOT NULL
      AND NEW.reopen_reason IS NOT NULL
      AND NEW.reopen_idempotency_key IS NOT NULL)
    OR (OLD.status='REOPENED' AND NEW.status='CLOSED'
      AND NEW.closed_by_staff_id IS NOT NULL
      AND NEW.close_reason IS NOT NULL
      AND NEW.close_idempotency_key IS NOT NULL
      AND NEW.reopened_at IS NULL
      AND NEW.reopened_by_staff_id IS NULL
      AND NEW.reopen_reason IS NULL
      AND NEW.reopen_idempotency_key IS NULL)
  )
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_invalid_transition');
END;

CREATE TRIGGER trg_order_archive_closures_no_delete
BEFORE DELETE ON order_archive_closures
BEGIN SELECT RAISE(ABORT,'order_archive_closures_are_immutable'); END;

CREATE TRIGGER trg_production_recovery_attestations_no_delete
BEFORE DELETE ON production_recovery_attestations
BEGIN SELECT RAISE(ABORT,'production_recovery_attestations_are_immutable'); END;

CREATE TRIGGER trg_production_recovery_attestations_no_update
BEFORE UPDATE ON production_recovery_attestations
BEGIN SELECT RAISE(ABORT,'production_recovery_attestations_are_immutable'); END;

INSERT INTO drive_archive_controls (
  singleton_id, copy_enabled, proxy_read_enabled, r2_delete_enabled, version, updated_at
) VALUES (
  1, 0, 0, 0, 1, 1787661495000
);

INSERT INTO scheduled_operations_permission_catalog (
  permission_code, default_role_code, created_at
) VALUES (
  'SCHEDULED_OPERATIONS_RUN', 'owner', 1787661495000
);

UPDATE app_schema_state
SET
  schema_version=18,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
