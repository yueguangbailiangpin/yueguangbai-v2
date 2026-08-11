PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- The product was never put into use and has no business data. Retire the
-- unused Feishu identity/workbench/login model without rewriting 0001-0064.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=64
) THEN 1 ELSE 0 END;

-- This cleanup is intentionally valid only for the confirmed unused system.
-- Refuse the migration instead of deleting or rebuilding any unexpected row.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM feishu_staff_identities)=0
  AND (SELECT COUNT(*) FROM feishu_workbench_mirrors)=0
  AND (SELECT COUNT(*) FROM feishu_workbench_callback_receipts)=0
  AND (SELECT COUNT(*) FROM staff_login_states)=0
  AND (SELECT COUNT(*) FROM staff_auth_rate_limits)=0
  AND (SELECT COUNT(*) FROM staff_auth_security_events)=0
  AND (SELECT COUNT(*) FROM staff_binding_invitations)=0
  AND (SELECT COUNT(*) FROM staff_binding_login_states)=0
  AND (SELECT COUNT(*) FROM scheduled_job_states)=0
  AND (SELECT COUNT(*) FROM scheduled_job_runs)=0
  AND (SELECT COUNT(*) FROM scheduled_dead_letters)=0
  AND (SELECT COUNT(*) FROM scheduled_manual_commands)=0
  AND (SELECT COUNT(*) FROM scheduled_operational_signals)=0
  AND (SELECT COUNT(*) FROM scheduled_alert_states)=0
THEN 1 ELSE 0 END;

-- Remove retired scheduler facts before narrowing shared CHECK constraints.
DELETE FROM scheduled_operational_signals
WHERE summary_code='FEISHU_ADAPTER_FAILURE'
   OR job_name IN ('feishu_sync','staff_auth_cleanup');
DELETE FROM scheduled_alert_states
WHERE summary_code='FEISHU_ADAPTER_FAILURE'
   OR job_name IN ('feishu_sync','staff_auth_cleanup');
DELETE FROM scheduled_dead_letters
WHERE job_name IN ('feishu_sync','staff_auth_cleanup');
DELETE FROM scheduled_job_runs
WHERE job_name IN ('feishu_sync','staff_auth_cleanup');
DELETE FROM scheduled_manual_commands
WHERE job_name IN ('feishu_sync','staff_auth_cleanup');
DELETE FROM scheduled_job_states
WHERE job_name IN ('feishu_sync','staff_auth_cleanup');

CREATE TABLE scheduled_operational_signals_next (
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
INSERT INTO scheduled_operational_signals_next
SELECT * FROM scheduled_operational_signals;
DROP TABLE scheduled_operational_signals;
ALTER TABLE scheduled_operational_signals_next RENAME TO scheduled_operational_signals;
CREATE INDEX idx_scheduled_operational_signals_lookup
ON scheduled_operational_signals(signal_type,job_name,observed_at);

CREATE TABLE scheduled_alert_states_next (
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
INSERT INTO scheduled_alert_states_next
SELECT * FROM scheduled_alert_states;
DROP TABLE scheduled_alert_states;
ALTER TABLE scheduled_alert_states_next RENAME TO scheduled_alert_states;

CREATE TABLE scheduled_job_states_next (
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
INSERT INTO scheduled_job_states_next
SELECT * FROM scheduled_job_states;
DROP TABLE scheduled_job_states;
ALTER TABLE scheduled_job_states_next RENAME TO scheduled_job_states;

-- Entirely retired Feishu/legacy Staff-auth structures. Dropping the tables
-- also drops their dedicated indexes and triggers.
DROP TABLE staff_binding_login_states;
DROP TABLE staff_binding_invitations;
DROP TABLE feishu_workbench_callback_receipts;
DROP TABLE feishu_workbench_mirrors;
DROP TABLE staff_auth_security_events;
DROP TABLE staff_auth_rate_limits;
DROP TABLE staff_login_states;
DROP TABLE feishu_staff_identities;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE lower(COALESCE(name,'')) LIKE '%feishu%'
     OR lower(COALESCE(sql,'')) LIKE '%feishu%'
) THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=65, installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=64;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
