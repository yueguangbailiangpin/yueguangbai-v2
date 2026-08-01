PRAGMA foreign_keys = ON;

-- Formal migration 0018: only advances schema_version from 17 to 18.
-- Any other preceding schema version must fail before any DDL is applied.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM app_schema_state
  WHERE singleton_id=1
    AND schema_version=17
) THEN 1 ELSE 0 END;

ALTER TABLE customer_login_accounts
ADD COLUMN registration_source TEXT
  CHECK (
    registration_source IS NULL
    OR registration_source IN (
      'STAFF_ACTIVATION',
      'SELF_REGISTRATION_NEW',
      'SELF_REGISTRATION_CLAIM',
      'RECOVERY_REBIND'
    )
  );

CREATE TABLE buyer_preorder_number_allocations (
  buyer_customer_id TEXT PRIMARY KEY
    REFERENCES buyer_customers(id),
  buyer_channel_id TEXT NOT NULL
    REFERENCES buyer_channels(id),
  buyer_customer_no TEXT NOT NULL UNIQUE
    CHECK (length(buyer_customer_no) BETWEEN 3 AND 100),
  buyer_sequence INTEGER NOT NULL
    CHECK (buyer_sequence >= 1),
  allocation_business_date TEXT NOT NULL
    CHECK (
      allocation_business_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  allocation_source TEXT NOT NULL
    CHECK (allocation_source='SELF_REGISTRATION'),
  request_id TEXT NOT NULL
    CHECK (length(request_id) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (buyer_channel_id, buyer_sequence)
) STRICT;

CREATE TRIGGER trg_buyer_preorder_numbers_no_update
BEFORE UPDATE ON buyer_preorder_number_allocations
BEGIN
  SELECT RAISE(ABORT, 'buyer_preorder_numbers_are_immutable');
END;

CREATE TRIGGER trg_buyer_preorder_numbers_no_delete
BEFORE DELETE ON buyer_preorder_number_allocations
BEGIN
  SELECT RAISE(ABORT, 'buyer_preorder_numbers_are_immutable');
END;

CREATE TABLE buyer_registration_rate_limits (
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('WECHAT_ID', 'NETWORK_SOURCE', 'DEVICE')),
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
  PRIMARY KEY (scope_type, scope_hash, window_started_at),
  CHECK (
    blocked_until IS NULL
    OR blocked_until >= window_started_at
  )
) STRICT;

CREATE INDEX idx_buyer_registration_rate_limit_expiry
ON buyer_registration_rate_limits (
  window_expires_at,
  scope_type,
  scope_hash
);

CREATE TABLE buyer_registration_attempts (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'REGISTRATION_SUCCEEDED',
      'REGISTRATION_REJECTED',
      'REGISTRATION_RATE_LIMITED'
    )),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('SUCCESS', 'FAILURE', 'BLOCKED')),
  registration_source TEXT
    CHECK (
      registration_source IS NULL
      OR registration_source IN (
        'SELF_REGISTRATION_NEW',
        'SELF_REGISTRATION_CLAIM'
      )
    ),
  buyer_customer_id TEXT
    REFERENCES buyer_customers(id),
  account_id TEXT
    REFERENCES customer_login_accounts(id),
  wechat_id_hash TEXT NOT NULL
    CHECK (
      length(wechat_id_hash)=64
      AND wechat_id_hash NOT GLOB '*[^0-9a-f]*'
    ),
  network_source_hash TEXT NOT NULL
    CHECK (
      length(network_source_hash)=64
      AND network_source_hash NOT GLOB '*[^0-9a-f]*'
    ),
  device_hash TEXT NOT NULL
    CHECK (
      length(device_hash)=64
      AND device_hash NOT GLOB '*[^0-9a-f]*'
    ),
  request_id TEXT NOT NULL
    CHECK (length(request_id) BETWEEN 1 AND 200),
  reason_code TEXT
    CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100),
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_buyer_registration_attempts_wechat
ON buyer_registration_attempts (
  wechat_id_hash,
  created_at,
  id
);

CREATE TRIGGER trg_buyer_registration_attempts_no_update
BEFORE UPDATE ON buyer_registration_attempts
BEGIN
  SELECT RAISE(ABORT, 'buyer_registration_attempts_are_immutable');
END;

CREATE TRIGGER trg_buyer_registration_attempts_no_delete
BEFORE DELETE ON buyer_registration_attempts
BEGIN
  SELECT RAISE(ABORT, 'buyer_registration_attempts_are_immutable');
END;

CREATE TABLE buyer_registration_conflicts (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  normalized_wechat_hash TEXT NOT NULL
    CHECK (
      length(normalized_wechat_hash)=64
      AND normalized_wechat_hash NOT GLOB '*[^0-9a-f]*'
    ),
  matched_buyer_count INTEGER NOT NULL
    CHECK (matched_buyer_count >= 2),
  request_id TEXT NOT NULL
    CHECK (length(request_id) BETWEEN 1 AND 200),
  network_source_hash TEXT NOT NULL
    CHECK (
      length(network_source_hash)=64
      AND network_source_hash NOT GLOB '*[^0-9a-f]*'
    ),
  device_hash TEXT NOT NULL
    CHECK (
      length(device_hash)=64
      AND device_hash NOT GLOB '*[^0-9a-f]*'
    ),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE TABLE buyer_registration_conflict_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  conflict_id TEXT NOT NULL
    REFERENCES buyer_registration_conflicts(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('OPENED', 'RESOLVED')),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('SYSTEM', 'STAFF')),
  actor_id TEXT,
  reason TEXT
    CHECK (reason IS NULL OR length(reason) <= 2000),
  request_id TEXT
    CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE VIEW buyer_registration_conflict_statuses AS
SELECT
  conflict.id,
  conflict.normalized_wechat_hash,
  conflict.matched_buyer_count,
  conflict.request_id,
  conflict.network_source_hash,
  conflict.device_hash,
  conflict.created_at,
  CASE WHEN EXISTS (
    SELECT 1
    FROM buyer_registration_conflict_events event
    WHERE event.conflict_id=conflict.id
      AND event.event_type='RESOLVED'
  ) THEN 'RESOLVED' ELSE 'OPEN' END AS status
FROM buyer_registration_conflicts conflict;

CREATE TRIGGER trg_buyer_registration_conflicts_no_update
BEFORE UPDATE ON buyer_registration_conflicts
BEGIN
  SELECT RAISE(ABORT, 'buyer_registration_conflicts_are_immutable');
END;

CREATE TRIGGER trg_buyer_registration_conflicts_no_delete
BEFORE DELETE ON buyer_registration_conflicts
BEGIN
  SELECT RAISE(ABORT, 'buyer_registration_conflicts_are_immutable');
END;

CREATE TRIGGER trg_buyer_registration_conflict_events_no_update
BEFORE UPDATE ON buyer_registration_conflict_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_registration_conflict_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_registration_conflict_events_no_delete
BEFORE DELETE ON buyer_registration_conflict_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_registration_conflict_events_are_immutable');
END;

CREATE TABLE buyer_registration_session_issuances (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  account_id TEXT NOT NULL
    REFERENCES customer_login_accounts(id),
  session_version INTEGER NOT NULL
    CHECK (session_version >= 1),
  request_id TEXT NOT NULL
    CHECK (length(request_id) BETWEEN 1 AND 200),
  network_source_hash TEXT NOT NULL
    CHECK (
      length(network_source_hash)=64
      AND network_source_hash NOT GLOB '*[^0-9a-f]*'
    ),
  device_hash TEXT NOT NULL
    CHECK (
      length(device_hash)=64
      AND device_hash NOT GLOB '*[^0-9a-f]*'
    ),
  issued_at INTEGER NOT NULL
    CHECK (issued_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (expires_at > issued_at)
) STRICT;

CREATE INDEX idx_buyer_registration_session_account
ON buyer_registration_session_issuances (
  account_id,
  issued_at,
  id
);

CREATE TRIGGER trg_buyer_registration_sessions_no_update
BEFORE UPDATE ON buyer_registration_session_issuances
BEGIN
  SELECT RAISE(ABORT, 'buyer_registration_sessions_are_immutable');
END;

CREATE TRIGGER trg_buyer_registration_sessions_no_delete
BEFORE DELETE ON buyer_registration_session_issuances
BEGIN
  SELECT RAISE(ABORT, 'buyer_registration_sessions_are_immutable');
END;

CREATE TABLE buyer_auth_recovery_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  account_id TEXT NOT NULL
    REFERENCES customer_login_accounts(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'ACCOUNT_FROZEN',
      'SESSIONS_REVOKED',
      'ACCOUNT_REBOUND'
    )),
  old_buyer_customer_id TEXT
    REFERENCES buyer_customers(id),
  new_buyer_customer_id TEXT
    REFERENCES buyer_customers(id),
  previous_account_version INTEGER NOT NULL
    CHECK (previous_account_version >= 1),
  next_account_version INTEGER NOT NULL
    CHECK (next_account_version=previous_account_version+1),
  actor_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  request_id TEXT,
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_buyer_auth_recovery_events_account
ON buyer_auth_recovery_events (
  account_id,
  created_at,
  id
);

CREATE TRIGGER trg_buyer_auth_recovery_events_no_update
BEFORE UPDATE ON buyer_auth_recovery_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_auth_recovery_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_auth_recovery_events_no_delete
BEFORE DELETE ON buyer_auth_recovery_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_auth_recovery_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=18,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=17;
