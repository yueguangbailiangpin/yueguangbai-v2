PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=51
) THEN 1 ELSE 0 END;

-- 7) A small audited escape hatch for legacy identity conflicts. Raw WeChat is
-- never stored here; the HMAC is enough to resolve future lookups deterministically.
CREATE TABLE customer_identity_manual_bindings (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  identity_hash TEXT NOT NULL CHECK (
    length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
  ),
  customer_type TEXT NOT NULL CHECK (customer_type IN ('BUYER','SELLER')),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  resolved_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  revoked_at INTEGER,
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;
CREATE UNIQUE INDEX uq_customer_identity_manual_binding_active
ON customer_identity_manual_bindings(identity_hash,customer_type,marketplace_code)
WHERE status='ACTIVE';
CREATE INDEX idx_customer_identity_manual_binding_subject
ON customer_identity_manual_bindings(customer_type,subject_id,marketplace_code,status);

CREATE TABLE customer_identity_resolution_cases (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  identity_hash TEXT NOT NULL CHECK (
    length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
  ),
  identity_masked TEXT NOT NULL CHECK (length(identity_masked) BETWEEN 1 AND 80),
  customer_type TEXT NOT NULL CHECK (customer_type IN ('BUYER','SELLER')),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'AMBIGUOUS_HISTORY','IDENTITY_CONFLICT','LEGACY_MISSING_IDENTITY','STAFF_REPORTED'
  )),
  staff_note TEXT CHECK (staff_note IS NULL OR length(staff_note)<=1000),
  status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED','CANCELLED')),
  reported_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  resolved_subject_id TEXT,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note)<=1000),
  resolved_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  resolved_at INTEGER,
  CHECK (
    (status='OPEN' AND resolved_subject_id IS NULL AND resolved_by_staff_id IS NULL AND resolved_at IS NULL)
    OR (status='RESOLVED' AND resolved_subject_id IS NOT NULL AND resolved_by_staff_id IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status='CANCELLED' AND resolved_subject_id IS NULL AND resolved_by_staff_id IS NOT NULL AND resolved_at IS NOT NULL)
  )
) STRICT;
CREATE INDEX idx_customer_identity_resolution_open
ON customer_identity_resolution_cases(status,marketplace_code,customer_type,created_at,id);
CREATE UNIQUE INDEX uq_customer_identity_resolution_one_open
ON customer_identity_resolution_cases(identity_hash,customer_type,marketplace_code)
WHERE status='OPEN';

CREATE TABLE customer_identity_resolution_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  case_id TEXT NOT NULL REFERENCES customer_identity_resolution_cases(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('REPORTED','RESOLVED','CANCELLED')),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  subject_id TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason)<=1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE TRIGGER trg_customer_identity_resolution_events_no_update
BEFORE UPDATE ON customer_identity_resolution_events
BEGIN SELECT RAISE(ABORT,'customer_identity_resolution_events_are_immutable'); END;
CREATE TRIGGER trg_customer_identity_resolution_events_no_delete
BEFORE DELETE ON customer_identity_resolution_events
BEGIN SELECT RAISE(ABORT,'customer_identity_resolution_events_are_immutable'); END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_identity_manual_bindings')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_identity_resolution_cases')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_identity_resolution_events')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=52,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=51;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
