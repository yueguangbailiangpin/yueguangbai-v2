-- M6: durable, privacy-safe scheduler coordination facts.  All timestamps are UTC milliseconds.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=30
) THEN 1 ELSE 0 END;

CREATE TABLE scheduled_job_states (
  job_name TEXT PRIMARY KEY CHECK (job_name IN (
    'reservation_expiry','instruction_expiry','outbox_delivery',
    'file_orphan_cleanup','staff_auth_cleanup','drive_archive','feishu_sync'
  )),
  cursor_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  lease_token TEXT,
  lease_expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_started_at INTEGER,
  last_succeeded_at INTEGER,
  last_failed_at INTEGER,
  last_failure_category TEXT,
  last_backlog_count INTEGER NOT NULL DEFAULT 0 CHECK (last_backlog_count >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at >= 0)
);

CREATE TABLE scheduled_operational_signals (
  id TEXT PRIMARY KEY CHECK (length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'),
  signal_type TEXT NOT NULL CHECK (signal_type IN ('worker_5xx','job_stale','lease_stuck','backlog_sustained','file_failure','login_anomaly','external_adapter_failure')),
  category TEXT NOT NULL CHECK (category IN ('worker','scheduler','file','auth','external')),
  severity TEXT NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  summary_code TEXT NOT NULL CHECK (summary_code IN ('WORKER_5XX_THRESHOLD','JOB_SUCCESS_STALE','JOB_LEASE_STUCK','JOB_BACKLOG_SUSTAINED','FILE_PROCESSING_FAILURE','LOGIN_ANOMALY_DETECTED','PRIMARY_ALERT_SINK_FAILURE','FEISHU_ADAPTER_FAILURE')),
  job_name TEXT REFERENCES scheduled_job_states(job_name),
  observation_state TEXT NOT NULL CHECK (observation_state IN ('BREACH','HEALTHY')),
  observed_at INTEGER NOT NULL CHECK (typeof(observed_at)='integer' AND observed_at>=0),
  count_value INTEGER NOT NULL CHECK (count_value>=0),
  evaluated_at INTEGER CHECK (evaluated_at IS NULL OR (typeof(evaluated_at)='integer' AND evaluated_at>=observed_at)),
  CHECK ((observation_state='BREACH' AND count_value>=1) OR (observation_state='HEALTHY' AND count_value=0))
) STRICT;
CREATE INDEX idx_scheduled_operational_signals_lookup ON scheduled_operational_signals(signal_type, job_name, observed_at);

CREATE TABLE scheduled_alert_states (
  signal_type TEXT NOT NULL CHECK (signal_type IN ('worker_5xx','job_stale','lease_stuck','backlog_sustained','file_failure','login_anomaly','external_adapter_failure')),
  job_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('worker','scheduler','file','auth','external')),
  severity TEXT NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  summary_code TEXT NOT NULL CHECK (summary_code IN ('WORKER_5XX_THRESHOLD','JOB_SUCCESS_STALE','JOB_LEASE_STUCK','JOB_BACKLOG_SUSTAINED','FILE_PROCESSING_FAILURE','LOGIN_ANOMALY_DETECTED','PRIMARY_ALERT_SINK_FAILURE','FEISHU_ADAPTER_FAILURE')),
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

CREATE TABLE scheduled_dead_letters (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL REFERENCES scheduled_job_states(job_name),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('OUTBOX','FILE')),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  failure_category TEXT NOT NULL CHECK (failure_category IN ('adapter_unavailable','delivery_failed','file_cleanup_deferred','job_item_failed','job_execution_failed')),
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

-- This permission is intentionally owner-only by default.  Existing override
-- rows remain governed by the canonical authorization policy; the catalog is
-- a migration-time guard against accidental broad grants.
CREATE TABLE scheduled_operations_permission_catalog (
  permission_code TEXT PRIMARY KEY CHECK (permission_code='SCHEDULED_OPERATIONS_RUN'),
  default_role_code TEXT NOT NULL CHECK (default_role_code='owner'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0)
) STRICT;
INSERT INTO scheduled_operations_permission_catalog(permission_code,default_role_code,created_at)
VALUES ('SCHEDULED_OPERATIONS_RUN','owner',CAST(unixepoch('now') AS INTEGER)*1000);

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
CREATE INDEX idx_scheduled_job_runs_job_finished ON scheduled_job_runs(job_name, finished_at DESC);

UPDATE app_schema_state
SET schema_version=31, installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=30;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
