PRAGMA foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN schema_version=33 THEN 1 ELSE 0 END
FROM app_schema_state WHERE singleton_id=1;

CREATE TABLE scheduled_dead_letters_next (
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

INSERT INTO scheduled_dead_letters_next
SELECT * FROM scheduled_dead_letters;
DROP TABLE scheduled_dead_letters;
ALTER TABLE scheduled_dead_letters_next RENAME TO scheduled_dead_letters;

UPDATE app_schema_state SET schema_version=34,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=33;
INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
