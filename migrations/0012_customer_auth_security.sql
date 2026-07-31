PRAGMA foreign_keys = ON;

-- Formal migration 0012: only advances schema_version from 11 to 12.
-- Any other preceding schema version must fail before any DDL is applied.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM app_schema_state
  WHERE singleton_id=1
    AND schema_version=11
) THEN 1 ELSE 0 END;

CREATE TABLE customer_login_rate_limits (
  scope_type TEXT NOT NULL
    CHECK (scope_type IN (
      'LOGIN_IDENTIFIER',
      'NETWORK_SOURCE'
    )),
  scope_hash TEXT NOT NULL
    CHECK (
      length(scope_hash)=64
      AND scope_hash NOT GLOB '*[^0-9a-f]*'
    ),
  window_started_at INTEGER NOT NULL
    CHECK (window_started_at >= 0),
  window_expires_at INTEGER NOT NULL
    CHECK (window_expires_at > window_started_at),
  attempt_count INTEGER NOT NULL
    CHECK (attempt_count >= 1),
  blocked_until INTEGER,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  PRIMARY KEY (
    scope_type,
    scope_hash,
    window_started_at
  ),
  CHECK (
    blocked_until IS NULL
    OR blocked_until >= window_started_at
  )
) STRICT;

CREATE INDEX idx_customer_login_rate_limits_expiry
ON customer_login_rate_limits (
  window_expires_at,
  scope_type,
  scope_hash
);

CREATE INDEX idx_customer_login_rate_limits_blocked
ON customer_login_rate_limits (
  blocked_until,
  scope_type,
  scope_hash
)
WHERE blocked_until IS NOT NULL;

CREATE TABLE customer_auth_security_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'LOGIN_SUCCEEDED',
      'LOGIN_FAILED',
      'LOGIN_RATE_LIMITED',
      'SESSION_REJECTED',
      'PASSWORD_CHANGED',
      'LOGOUT'
    )),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('SUCCESS', 'FAILURE', 'BLOCKED')),
  account_id TEXT
    REFERENCES customer_login_accounts(id),
  login_identifier_hash TEXT
    CHECK (
      login_identifier_hash IS NULL
      OR (
        length(login_identifier_hash)=64
        AND login_identifier_hash NOT GLOB '*[^0-9a-f]*'
      )
    ),
  network_source_hash TEXT
    CHECK (
      network_source_hash IS NULL
      OR (
        length(network_source_hash)=64
        AND network_source_hash NOT GLOB '*[^0-9a-f]*'
      )
    ),
  request_id TEXT NOT NULL
    CHECK (length(request_id) BETWEEN 1 AND 200),
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_customer_auth_security_events_account
ON customer_auth_security_events (
  account_id,
  created_at,
  id
);

CREATE INDEX idx_customer_auth_security_events_identifier
ON customer_auth_security_events (
  login_identifier_hash,
  created_at,
  id
)
WHERE login_identifier_hash IS NOT NULL;

CREATE INDEX idx_customer_auth_security_events_network
ON customer_auth_security_events (
  network_source_hash,
  created_at,
  id
)
WHERE network_source_hash IS NOT NULL;

CREATE TRIGGER trg_customer_auth_security_events_no_update
BEFORE UPDATE ON customer_auth_security_events
BEGIN
  SELECT RAISE(ABORT, 'customer_auth_security_events_are_immutable');
END;

CREATE TRIGGER trg_customer_auth_security_events_no_delete
BEFORE DELETE ON customer_auth_security_events
BEGIN
  SELECT RAISE(ABORT, 'customer_auth_security_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=12,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=11;
