PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=67
) THEN 1 ELSE 0 END;

-- SQLite cannot alter CHECK enums in place. Preserve every existing counter
-- while adding an operation-isolated authenticated password-change boundary.
CREATE TABLE customer_security_rate_limits_v68 (
  operation TEXT NOT NULL CHECK (
    operation IN ('INVITATION','PASSWORD_RESET','PASSWORD_CHANGE')
  ),
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('NETWORK_SOURCE','DEVICE','TOKEN','WECHAT_ID','ACCOUNT_ID')
  ),
  scope_hash TEXT NOT NULL CHECK (
    length(scope_hash)=64 AND scope_hash NOT GLOB '*[^0-9a-f]*'
  ),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
  window_expires_at INTEGER NOT NULL CHECK (window_expires_at > window_started_at),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
  blocked_until INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (operation, scope_type, scope_hash, window_started_at),
  CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
) STRICT;

INSERT INTO customer_security_rate_limits_v68 (
  operation,scope_type,scope_hash,window_started_at,window_expires_at,
  attempt_count,blocked_until,created_at,updated_at
)
SELECT operation,scope_type,scope_hash,window_started_at,window_expires_at,
  attempt_count,blocked_until,created_at,updated_at
FROM customer_security_rate_limits;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM customer_security_rate_limits_v68)=
  (SELECT COUNT(*) FROM customer_security_rate_limits)
THEN 1 ELSE 0 END;

DROP TABLE customer_security_rate_limits;
ALTER TABLE customer_security_rate_limits_v68
  RENAME TO customer_security_rate_limits;

CREATE INDEX idx_customer_security_rate_limits_expiry
ON customer_security_rate_limits (window_expires_at, operation, scope_type);

-- Preserve the immutable auth-security ledger and extend only its event enum.
CREATE TABLE customer_auth_security_events_v68 (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGIN_RATE_LIMITED',
    'SESSION_REJECTED','PASSWORD_CHANGED','PASSWORD_CHANGE_RATE_LIMITED','LOGOUT'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE','BLOCKED')),
  account_id TEXT REFERENCES customer_login_accounts(id),
  login_identifier_hash TEXT CHECK (
    login_identifier_hash IS NULL OR (
      length(login_identifier_hash)=64
      AND login_identifier_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  network_source_hash TEXT CHECK (
    network_source_hash IS NULL OR (
      length(network_source_hash)=64
      AND network_source_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

INSERT INTO customer_auth_security_events_v68 (
  id,event_type,outcome,account_id,login_identifier_hash,
  network_source_hash,request_id,metadata_json,created_at
)
SELECT id,event_type,outcome,account_id,login_identifier_hash,
  network_source_hash,request_id,metadata_json,created_at
FROM customer_auth_security_events;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM customer_auth_security_events_v68)=
  (SELECT COUNT(*) FROM customer_auth_security_events)
THEN 1 ELSE 0 END;

DROP TABLE customer_auth_security_events;
ALTER TABLE customer_auth_security_events_v68
  RENAME TO customer_auth_security_events;

CREATE INDEX idx_customer_auth_security_events_account
ON customer_auth_security_events (account_id,created_at,id);
CREATE INDEX idx_customer_auth_security_events_identifier
ON customer_auth_security_events (login_identifier_hash,created_at,id)
WHERE login_identifier_hash IS NOT NULL;
CREATE INDEX idx_customer_auth_security_events_network
ON customer_auth_security_events (network_source_hash,created_at,id)
WHERE network_source_hash IS NOT NULL;

CREATE TRIGGER trg_customer_auth_security_events_no_update
BEFORE UPDATE ON customer_auth_security_events
BEGIN
  SELECT RAISE(ABORT,'customer_auth_security_events_are_immutable');
END;
CREATE TRIGGER trg_customer_auth_security_events_no_delete
BEFORE DELETE ON customer_auth_security_events
BEGIN
  SELECT RAISE(ABORT,'customer_auth_security_events_are_immutable');
END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table'
    AND name='customer_security_rate_limits')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table'
    AND name='customer_auth_security_events')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_customer_auth_security_events_no_update')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_customer_auth_security_events_no_delete')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=68,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=67;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
