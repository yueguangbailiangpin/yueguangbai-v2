PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=56
) THEN 1 ELSE 0 END;

CREATE TABLE acquisition_machine_credentials (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  machine_name TEXT NOT NULL CHECK (length(machine_name) BETWEEN 1 AND 100),
  secret_sha256 TEXT NOT NULL UNIQUE CHECK (
    length(secret_sha256)=64 AND secret_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  hourly_request_limit INTEGER NOT NULL DEFAULT 120 CHECK (hourly_request_limit BETWEEN 1 AND 10000),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoked_by_staff_id IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoked_by_staff_id IS NOT NULL)
  )
) STRICT;
CREATE INDEX idx_acquisition_machine_credentials_status
ON acquisition_machine_credentials(status,machine_name,id);

CREATE TABLE acquisition_machine_marketplaces (
  machine_id TEXT NOT NULL REFERENCES acquisition_machine_credentials(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY(machine_id,marketplace_code)
) STRICT;

CREATE TABLE acquisition_machine_channels (
  machine_id TEXT NOT NULL REFERENCES acquisition_machine_credentials(id),
  channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY(machine_id,channel_id)
) STRICT;

CREATE TABLE acquisition_machine_rate_buckets (
  machine_id TEXT NOT NULL REFERENCES acquisition_machine_credentials(id),
  bucket_hour INTEGER NOT NULL CHECK (bucket_hour>=0),
  request_count INTEGER NOT NULL CHECK (request_count>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=0),
  PRIMARY KEY(machine_id,bucket_hour)
) STRICT;

CREATE TRIGGER trg_acquisition_machine_scope_no_update
BEFORE UPDATE ON acquisition_machine_marketplaces
BEGIN SELECT RAISE(ABORT,'acquisition_machine_marketplace_scope_is_immutable'); END;
CREATE TRIGGER trg_acquisition_machine_scope_no_delete
BEFORE DELETE ON acquisition_machine_marketplaces
BEGIN SELECT RAISE(ABORT,'acquisition_machine_marketplace_scope_is_immutable'); END;
CREATE TRIGGER trg_acquisition_machine_channel_no_update
BEFORE UPDATE ON acquisition_machine_channels
BEGIN SELECT RAISE(ABORT,'acquisition_machine_channel_scope_is_immutable'); END;
CREATE TRIGGER trg_acquisition_machine_channel_no_delete
BEFORE DELETE ON acquisition_machine_channels
BEGIN SELECT RAISE(ABORT,'acquisition_machine_channel_scope_is_immutable'); END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_machine_credentials')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_machine_marketplaces')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_machine_channels')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_machine_rate_buckets')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=57,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=56;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
