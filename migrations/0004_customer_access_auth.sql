PRAGMA foreign_keys = ON;

CREATE TABLE customer_login_accounts (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  identity_subject_id TEXT NOT NULL UNIQUE
    REFERENCES customer_identity_subjects(id),
  account_type TEXT NOT NULL
    CHECK (account_type IN ('BUYER', 'SELLER_MEMBER')),
  login_identifier_display TEXT NOT NULL
    CHECK (length(login_identifier_display) BETWEEN 3 AND 160),
  login_identifier_normalized TEXT NOT NULL UNIQUE
    CHECK (length(login_identifier_normalized) BETWEEN 3 AND 160),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  session_version INTEGER NOT NULL DEFAULT 1
    CHECK (session_version >= 1),
  password_change_required INTEGER NOT NULL DEFAULT 1
    CHECK (password_change_required IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  activated_at INTEGER,
  disabled_at INTEGER,
  CHECK (
    (status='ACTIVE'
      AND activated_at IS NOT NULL
      AND disabled_at IS NULL)
    OR
    (status='DISABLED'
      AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_customer_login_account_status
ON customer_login_accounts (
  status,
  account_type,
  id
);

CREATE TABLE customer_password_credentials (
  account_id TEXT PRIMARY KEY
    REFERENCES customer_login_accounts(id),
  algorithm TEXT NOT NULL
    CHECK (algorithm='PBKDF2_SHA256'),
  iterations INTEGER NOT NULL
    CHECK (iterations BETWEEN 10000 AND 1000000),
  salt_base64url TEXT NOT NULL
    CHECK (
      length(salt_base64url) BETWEEN 20 AND 40
      AND salt_base64url NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  hash_base64url TEXT NOT NULL
    CHECK (
      length(hash_base64url) BETWEEN 40 AND 80
      AND hash_base64url NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  password_version INTEGER NOT NULL DEFAULT 1
    CHECK (password_version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE customer_access_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  account_id TEXT NOT NULL
    REFERENCES customer_login_accounts(id),
  identity_subject_id TEXT NOT NULL
    REFERENCES customer_identity_subjects(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'ACCOUNT_ACTIVATED',
      'PASSWORD_CHANGED',
      'SESSIONS_REVOKED',
      'ACCOUNT_DISABLED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('STAFF', 'CUSTOMER_ACCOUNT')),
  actor_id TEXT,
  previous_state_json TEXT,
  next_state_json TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_customer_access_events_account
ON customer_access_events (
  account_id,
  created_at,
  id
);

CREATE TRIGGER trg_customer_access_events_no_update
BEFORE UPDATE ON customer_access_events
BEGIN
  SELECT RAISE(ABORT, 'customer_access_events_are_immutable');
END;

CREATE TRIGGER trg_customer_access_events_no_delete
BEFORE DELETE ON customer_access_events
BEGIN
  SELECT RAISE(ABORT, 'customer_access_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=4,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
