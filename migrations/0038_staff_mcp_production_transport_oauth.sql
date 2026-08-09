PRAGMA foreign_keys = ON;

-- Staff MCP production transport owns schema 38. Guard before every DDL so a
-- skipped or repeated migration leaves no partial security boundary.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=37
) THEN 1 ELSE 0 END;

CREATE TABLE staff_mcp_subject_bindings (
  issuer_hash TEXT NOT NULL CHECK (
    length(issuer_hash)=64 AND issuer_hash NOT GLOB '*[^0-9a-f]*'
  ),
  subject_hash TEXT NOT NULL CHECK (
    length(subject_hash)=64 AND subject_hash NOT GLOB '*[^0-9a-f]*'
  ),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  revoked_at INTEGER,
  PRIMARY KEY (issuer_hash,subject_hash),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_mcp_subject_bindings_staff_status
ON staff_mcp_subject_bindings(staff_id,status);

CREATE TRIGGER trg_staff_mcp_subject_binding_active_staff_insert
BEFORE INSERT ON staff_mcp_subject_bindings
WHEN NEW.status='ACTIVE' AND NOT EXISTS (
  SELECT 1 FROM staff_users
  WHERE id=NEW.staff_id AND status='ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT,'staff_mcp_binding_staff_not_active');
END;

CREATE TRIGGER trg_staff_mcp_subject_binding_active_staff_update
BEFORE UPDATE ON staff_mcp_subject_bindings
WHEN NEW.status='ACTIVE' AND NOT EXISTS (
  SELECT 1 FROM staff_users
  WHERE id=NEW.staff_id AND status='ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT,'staff_mcp_binding_staff_not_active');
END;

CREATE TABLE staff_mcp_token_revocations (
  issuer_hash TEXT NOT NULL CHECK (
    length(issuer_hash)=64 AND issuer_hash NOT GLOB '*[^0-9a-f]*'
  ),
  token_jti_hash TEXT NOT NULL CHECK (
    length(token_jti_hash)=64 AND token_jti_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reason_code TEXT NOT NULL CHECK (
    length(reason_code) BETWEEN 1 AND 80
    AND reason_code NOT GLOB '*[^A-Z0-9_]*'
  ),
  revoked_at INTEGER NOT NULL CHECK (revoked_at>=0),
  expires_at INTEGER NOT NULL CHECK (expires_at>revoked_at),
  PRIMARY KEY (issuer_hash,token_jti_hash)
) STRICT;

CREATE INDEX idx_staff_mcp_token_revocations_expiry
ON staff_mcp_token_revocations(expires_at);

CREATE TABLE staff_mcp_replay_records (
  replay_key_hash TEXT PRIMARY KEY CHECK (
    length(replay_key_hash)=64 AND replay_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  tool_name TEXT NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 128),
  status TEXT NOT NULL CHECK (
    status IN ('PROCESSING','COMPLETED','COMPLETED_NO_RESPONSE')
  ),
  lease_token_hash TEXT CHECK (
    lease_token_hash IS NULL OR (
      length(lease_token_hash)=64
      AND lease_token_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  lease_expires_at INTEGER,
  response_json TEXT CHECK (
    response_json IS NULL OR (
      json_valid(response_json)=1 AND length(response_json)<=262144
    )
  ),
  expires_at INTEGER NOT NULL CHECK (expires_at>created_at),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  completed_at INTEGER,
  CHECK (
    (status='PROCESSING'
      AND lease_token_hash IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at>updated_at
      AND response_json IS NULL
      AND completed_at IS NULL)
    OR
    (status='COMPLETED'
      AND lease_token_hash IS NULL
      AND lease_expires_at IS NULL
      AND response_json IS NOT NULL
      AND completed_at IS NOT NULL
      AND completed_at>=created_at)
    OR
    (status='COMPLETED_NO_RESPONSE'
      AND lease_token_hash IS NULL
      AND lease_expires_at IS NULL
      AND response_json IS NULL
      AND completed_at IS NOT NULL
      AND completed_at>=created_at)
  )
) STRICT;

CREATE INDEX idx_staff_mcp_replay_expiry
ON staff_mcp_replay_records(expires_at,status);

CREATE TABLE staff_mcp_rate_limits (
  scope_hash TEXT NOT NULL CHECK (
    length(scope_hash)=64 AND scope_hash NOT GLOB '*[^0-9a-f]*'
  ),
  window_started_at INTEGER NOT NULL CHECK (window_started_at>=0),
  window_ends_at INTEGER NOT NULL CHECK (window_ends_at>window_started_at),
  attempt_count INTEGER NOT NULL CHECK (attempt_count>=1),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  PRIMARY KEY (scope_hash,window_started_at)
) STRICT;

CREATE INDEX idx_staff_mcp_rate_limits_expiry
ON staff_mcp_rate_limits(window_ends_at);

CREATE TABLE staff_mcp_runtime_controls (
  control_type TEXT NOT NULL CHECK (control_type IN ('GLOBAL','TOOL')),
  control_name TEXT NOT NULL CHECK (
    length(control_name) BETWEEN 1 AND 128
    AND control_name NOT GLOB '*[^A-Za-z0-9_.-]*'
  ),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  version INTEGER NOT NULL CHECK (version>=1),
  reason_code TEXT CHECK (
    reason_code IS NULL OR (
      length(reason_code) BETWEEN 1 AND 80
      AND reason_code NOT GLOB '*[^A-Z0-9_]*'
    )
  ),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  PRIMARY KEY (control_type,control_name),
  CHECK (
    (control_type='GLOBAL' AND control_name='staff-mcp')
    OR (control_type='TOOL' AND control_name<>'staff-mcp')
  )
) STRICT;

INSERT INTO staff_mcp_runtime_controls (
  control_type,control_name,enabled,version,reason_code,created_at,updated_at
) VALUES (
  'GLOBAL','staff-mcp',0,1,'DEFAULT_DISABLED',
  CAST(unixepoch('now') AS INTEGER)*1000,
  CAST(unixepoch('now') AS INTEGER)*1000
);

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM staff_mcp_runtime_controls
    WHERE control_type='GLOBAL' AND control_name='staff-mcp' AND enabled=0
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type='index' AND name='idx_staff_mcp_token_revocations_expiry'
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type='index' AND name='idx_staff_mcp_replay_expiry'
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=38,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=37;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
