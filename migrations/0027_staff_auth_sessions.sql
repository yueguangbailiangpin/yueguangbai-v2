PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Wave 13: trusted Staff login state, internal session, rate-limit, and
-- pre-authentication security-event persistence. Feishu is an identity
-- authentication provider; D1 remains the Staff and authorization authority.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=26
) THEN 1 ELSE 0 END;

ALTER TABLE staff_users
ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(session_version)='integer' AND session_version>=1);

CREATE TABLE staff_login_states (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  state_hash TEXT NOT NULL UNIQUE CHECK (
    length(state_hash)=64 AND state_hash NOT GLOB '*[^0-9a-f]*'
  ),
  provider TEXT NOT NULL CHECK (provider='FEISHU'),
  tenant_key TEXT NOT NULL CHECK (length(tenant_key) BETWEEN 1 AND 200),
  callback_purpose TEXT NOT NULL CHECK (callback_purpose='STAFF_LOGIN'),
  return_to TEXT NOT NULL CHECK (
    length(return_to) BETWEEN 1 AND 1024
    AND substr(return_to,1,1)='/'
    AND substr(return_to,1,2)<>'//'
    AND instr(return_to, char(92))=0
  ),
  status TEXT NOT NULL CHECK (
    status IN ('ISSUED','CONSUMED','EXPIRED','CANCELLED')
  ),
  origin_hash TEXT CHECK (
    origin_hash IS NULL OR (
      length(origin_hash)=64 AND origin_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  network_source_hash TEXT CHECK (
    network_source_hash IS NULL OR (
      length(network_source_hash)=64
      AND network_source_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  request_id TEXT CHECK (request_id IS NULL OR length(request_id)<=200),
  expires_at INTEGER NOT NULL CHECK (
    typeof(expires_at)='integer' AND expires_at>=0
  ),
  consumed_at INTEGER CHECK (
    consumed_at IS NULL OR (typeof(consumed_at)='integer' AND consumed_at>=0)
  ),
  cancelled_at INTEGER CHECK (
    cancelled_at IS NULL OR (typeof(cancelled_at)='integer' AND cancelled_at>=0)
  ),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at)='integer' AND created_at>=0
  ),
  updated_at INTEGER NOT NULL CHECK (
    typeof(updated_at)='integer' AND updated_at>=created_at
  ),
  CHECK (expires_at>created_at),
  CHECK (consumed_at IS NULL OR consumed_at BETWEEN created_at AND updated_at),
  CHECK (cancelled_at IS NULL OR cancelled_at BETWEEN created_at AND updated_at),
  CHECK (
    (status='ISSUED' AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (status='CONSUMED' AND consumed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='EXPIRED' AND consumed_at IS NULL AND cancelled_at IS NULL
        AND updated_at>=expires_at)
    OR (status='CANCELLED' AND consumed_at IS NULL AND cancelled_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_login_states_status_expiry
ON staff_login_states (status, expires_at, id);
CREATE INDEX idx_staff_login_states_tenant_created
ON staff_login_states (provider, tenant_key, created_at, id);

CREATE TRIGGER trg_staff_login_states_identity_immutable
BEFORE UPDATE ON staff_login_states
WHEN NEW.id<>OLD.id
  OR NEW.state_hash<>OLD.state_hash
  OR NEW.provider<>OLD.provider
  OR NEW.tenant_key<>OLD.tenant_key
  OR NEW.callback_purpose<>OLD.callback_purpose
  OR NEW.return_to<>OLD.return_to
  OR COALESCE(NEW.origin_hash,'')<>COALESCE(OLD.origin_hash,'')
  OR COALESCE(NEW.network_source_hash,'')<>COALESCE(OLD.network_source_hash,'')
  OR COALESCE(NEW.request_id,'')<>COALESCE(OLD.request_id,'')
  OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'staff_login_state_identity_is_immutable');
END;

CREATE TRIGGER trg_staff_login_states_transition_guard
BEFORE UPDATE ON staff_login_states
WHEN NOT (
  OLD.status='ISSUED'
  AND NEW.status IN ('CONSUMED','EXPIRED','CANCELLED')
  AND NEW.updated_at>=OLD.updated_at
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_staff_login_state_transition');
END;

CREATE TRIGGER trg_staff_login_states_retention_delete_guard
BEFORE DELETE ON staff_login_states
WHEN NOT (
  OLD.expires_at < CAST(unixepoch('now') AS INTEGER) * 1000 - 86400000
  AND OLD.updated_at < CAST(unixepoch('now') AS INTEGER) * 1000 - 86400000
)
BEGIN
  SELECT RAISE(ABORT, 'staff_login_states_retention_guard');
END;

CREATE TABLE staff_sessions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  issued_session_version INTEGER NOT NULL CHECK (
    typeof(issued_session_version)='integer' AND issued_session_version>=1
  ),
  issued_authorization_version INTEGER NOT NULL CHECK (
    typeof(issued_authorization_version)='integer'
    AND issued_authorization_version>=1
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  expires_at INTEGER NOT NULL CHECK (
    typeof(expires_at)='integer' AND expires_at>=0
  ),
  revoked_at INTEGER CHECK (
    revoked_at IS NULL OR (typeof(revoked_at)='integer' AND revoked_at>=0)
  ),
  revoked_reason TEXT CHECK (
    revoked_reason IS NULL OR length(revoked_reason) BETWEEN 1 AND 500
  ),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at)='integer' AND created_at>=0
  ),
  updated_at INTEGER NOT NULL CHECK (
    typeof(updated_at)='integer' AND updated_at>=created_at
  ),
  CHECK (expires_at>created_at),
  CHECK (revoked_at IS NULL OR revoked_at BETWEEN created_at AND updated_at),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoked_reason IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
    OR (status='EXPIRED' AND revoked_at IS NULL AND revoked_reason IS NULL
        AND updated_at>=expires_at)
  )
) STRICT;

CREATE INDEX idx_staff_sessions_staff_status_expiry
ON staff_sessions (staff_id, status, expires_at, id);
CREATE INDEX idx_staff_sessions_status_expiry
ON staff_sessions (status, expires_at, id);

CREATE TRIGGER trg_staff_sessions_identity_immutable
BEFORE UPDATE ON staff_sessions
WHEN NEW.id<>OLD.id
  OR NEW.token_hash<>OLD.token_hash
  OR NEW.staff_id<>OLD.staff_id
  OR NEW.issued_session_version<>OLD.issued_session_version
  OR NEW.issued_authorization_version<>OLD.issued_authorization_version
  OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'staff_session_identity_is_immutable');
END;

CREATE TRIGGER trg_staff_sessions_transition_guard
BEFORE UPDATE ON staff_sessions
WHEN NOT (
  OLD.status='ACTIVE'
  AND NEW.status IN ('REVOKED','EXPIRED')
  AND NEW.updated_at>=OLD.updated_at
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_staff_session_transition');
END;

CREATE TRIGGER trg_staff_sessions_no_delete
BEFORE DELETE ON staff_sessions
BEGIN
  SELECT RAISE(ABORT, 'staff_sessions_cannot_be_deleted');
END;

CREATE TABLE staff_auth_rate_limits (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  action TEXT NOT NULL CHECK (action IN ('LOGIN_START','LOGIN_CALLBACK')),
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('NETWORK','TENANT_SUBJECT','NETWORK_TENANT')
  ),
  scope_hash TEXT NOT NULL CHECK (
    length(scope_hash)=64 AND scope_hash NOT GLOB '*[^0-9a-f]*'
  ),
  window_started_at INTEGER NOT NULL CHECK (
    typeof(window_started_at)='integer' AND window_started_at>=0
  ),
  window_ends_at INTEGER NOT NULL CHECK (
    typeof(window_ends_at)='integer' AND window_ends_at>window_started_at
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(attempt_count)='integer' AND attempt_count>=0
  ),
  blocked_until INTEGER CHECK (
    blocked_until IS NULL OR (
      typeof(blocked_until)='integer' AND blocked_until>=window_started_at
    )
  ),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at)='integer' AND created_at>=0
  ),
  updated_at INTEGER NOT NULL CHECK (
    typeof(updated_at)='integer' AND updated_at>=created_at
  ),
  UNIQUE (action, scope_type, scope_hash, window_started_at)
) STRICT;

CREATE INDEX idx_staff_auth_rate_limits_expiry
ON staff_auth_rate_limits (window_ends_at, blocked_until, id);
CREATE INDEX idx_staff_auth_rate_limits_scope
ON staff_auth_rate_limits (action, scope_type, scope_hash, window_started_at);

CREATE TABLE staff_auth_security_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LOGIN_FAILED','LOGIN_RATE_LIMITED','STATE_INVALID','STATE_EXPIRED',
    'STATE_REPLAYED','IDENTITY_UNKNOWN','IDENTITY_CONFLICT',
    'IDENTITY_INACTIVE','PROVIDER_FAILURE','SESSION_REJECTED',
    'COOKIE_REJECTED'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('FAILURE','BLOCKED','REJECTED')),
  staff_id TEXT REFERENCES staff_users(id),
  session_id TEXT REFERENCES staff_sessions(id),
  provider TEXT CHECK (provider IS NULL OR provider='FEISHU'),
  tenant_hash TEXT CHECK (
    tenant_hash IS NULL OR (
      length(tenant_hash)=64 AND tenant_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  subject_hash TEXT CHECK (
    subject_hash IS NULL OR (
      length(subject_hash)=64 AND subject_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  network_source_hash TEXT CHECK (
    network_source_hash IS NULL OR (
      length(network_source_hash)=64
      AND network_source_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  request_id TEXT CHECK (request_id IS NULL OR length(request_id)<=200),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(metadata_json)
    AND json_type(metadata_json)='object'
    AND length(metadata_json) BETWEEN 2 AND 4096
  ),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at)='integer' AND created_at>=0
  )
) STRICT;

CREATE INDEX idx_staff_auth_security_events_created
ON staff_auth_security_events (created_at, id);
CREATE INDEX idx_staff_auth_security_events_staff_created
ON staff_auth_security_events (staff_id, created_at, id);
CREATE INDEX idx_staff_auth_security_events_type_created
ON staff_auth_security_events (event_type, created_at, id);

CREATE TRIGGER trg_staff_auth_security_events_no_update
BEFORE UPDATE ON staff_auth_security_events
BEGIN
  SELECT RAISE(ABORT, 'staff_auth_security_events_are_immutable');
END;

CREATE TRIGGER trg_staff_auth_security_events_no_delete
BEFORE DELETE ON staff_auth_security_events
BEGIN
  SELECT RAISE(ABORT, 'staff_auth_security_events_are_immutable');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM pragma_table_info('staff_users')
    WHERE name='session_version' AND type='INTEGER' AND "notnull"=1)
  AND EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='staff_login_states')
  AND EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='staff_sessions')
  AND EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='staff_auth_rate_limits')
  AND EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='staff_auth_security_events')
  AND NOT EXISTS (SELECT 1 FROM staff_users WHERE session_version<>1)
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=27,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=26;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
