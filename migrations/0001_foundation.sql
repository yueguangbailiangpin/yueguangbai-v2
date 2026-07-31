PRAGMA foreign_keys = ON;

CREATE TABLE app_schema_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  installed_at INTEGER NOT NULL CHECK (installed_at >= 0)
) STRICT;

INSERT INTO app_schema_state (
  singleton_id,
  schema_version,
  installed_at
) VALUES (
  1,
  1,
  CAST(unixepoch('now') AS INTEGER) * 1000
);

CREATE TABLE transaction_assertions (
  assertion_value INTEGER NOT NULL
) STRICT;

CREATE TRIGGER trg_transaction_assertion_guard
BEFORE INSERT ON transaction_assertions
WHEN NEW.assertion_value <> 1
BEGIN
  SELECT RAISE(ABORT, 'transaction_assertion_failed');
END;

CREATE TRIGGER trg_transaction_assertion_cleanup
AFTER INSERT ON transaction_assertions
BEGIN
  DELETE FROM transaction_assertions
  WHERE rowid = NEW.rowid;
END;

CREATE TABLE command_idempotency_records (
  actor_type TEXT NOT NULL
    CHECK (length(actor_type) BETWEEN 1 AND 40),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  action TEXT NOT NULL
    CHECK (length(action) BETWEEN 1 AND 100),
  target_type TEXT NOT NULL
    CHECK (length(target_type) BETWEEN 1 AND 100),
  target_id TEXT NOT NULL
    CHECK (length(target_id) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL
    CHECK (
      length(request_hash) = 64
      AND request_hash NOT GLOB '*[^0-9a-f]*'
    ),
  status TEXT NOT NULL
    CHECK (status IN ('PROCESSING', 'COMMITTED', 'FAILED')),
  lease_token TEXT NOT NULL
    CHECK (length(lease_token) BETWEEN 16 AND 200),
  lease_expires_at INTEGER NOT NULL
    CHECK (lease_expires_at >= 0),
  attempt_count INTEGER NOT NULL
    CHECK (attempt_count >= 1),
  response_json TEXT,
  result_references_json TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  completed_at INTEGER,
  PRIMARY KEY (
    actor_type,
    actor_id,
    idempotency_key
  ),
  CHECK (
    (status = 'COMMITTED'
      AND response_json IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_code IS NULL)
    OR
    (status = 'PROCESSING'
      AND response_json IS NULL
      AND completed_at IS NULL
      AND error_code IS NULL)
    OR
    (status = 'FAILED'
      AND response_json IS NULL
      AND completed_at IS NULL
      AND error_code IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_command_idempotency_status_lease
ON command_idempotency_records (
  status,
  lease_expires_at
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  aggregate_type TEXT NOT NULL
    CHECK (length(aggregate_type) BETWEEN 1 AND 100),
  aggregate_id TEXT NOT NULL
    CHECK (length(aggregate_id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL
    CHECK (length(event_type) BETWEEN 1 AND 100),
  actor_type TEXT NOT NULL
    CHECK (length(actor_type) BETWEEN 1 AND 40),
  actor_id TEXT,
  actor_roles_json TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT,
  previous_state_json TEXT,
  next_state_json TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_audit_events_aggregate
ON audit_events (
  aggregate_type,
  aggregate_id,
  created_at,
  id
);

CREATE INDEX idx_audit_events_actor
ON audit_events (
  actor_type,
  actor_id,
  created_at
);

CREATE TRIGGER trg_audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events_are_immutable');
END;

CREATE TRIGGER trg_audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events_are_immutable');
END;

CREATE TABLE integration_outbox (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  dedup_key TEXT NOT NULL UNIQUE
    CHECK (length(dedup_key) BETWEEN 8 AND 200),
  event_type TEXT NOT NULL
    CHECK (length(event_type) BETWEEN 1 AND 100),
  aggregate_type TEXT NOT NULL
    CHECK (length(aggregate_type) BETWEEN 1 AND 100),
  aggregate_id TEXT NOT NULL
    CHECK (length(aggregate_id) BETWEEN 1 AND 200),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL
    CHECK (
      length(payload_hash) = 64
      AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  available_at INTEGER NOT NULL
    CHECK (available_at >= 0),
  lease_token TEXT,
  lease_expires_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  sent_at INTEGER,
  CHECK (
    (status = 'PENDING'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND sent_at IS NULL)
    OR
    (status = 'PROCESSING'
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND sent_at IS NULL)
    OR
    (status = 'FAILED'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND sent_at IS NULL
      AND last_error IS NOT NULL)
    OR
    (status = 'SENT'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND sent_at IS NOT NULL
      AND last_error IS NULL)
  )
) STRICT;

CREATE INDEX idx_integration_outbox_ready
ON integration_outbox (
  status,
  available_at,
  created_at,
  id
);

CREATE INDEX idx_integration_outbox_expired_lease
ON integration_outbox (
  status,
  lease_expires_at
);
