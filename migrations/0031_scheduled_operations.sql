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

CREATE TABLE scheduled_job_runs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL REFERENCES scheduled_job_states(job_name),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('CRON','MANUAL')),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED','SKIPPED','DISABLED')),
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
