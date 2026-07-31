PRAGMA foreign_keys = ON;

ALTER TABLE seller_organizations
ADD COLUMN next_member_number INTEGER NOT NULL DEFAULT 2
CHECK (next_member_number >= 2);

CREATE TABLE seller_member_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  member_id TEXT NOT NULL
    REFERENCES seller_organization_members(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'SELLER_MEMBER_CREATED',
      'SELLER_MEMBER_ACTIVATED',
      'SELLER_MEMBER_ROLE_CHANGED',
      'SELLER_MEMBER_DISABLED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('STAFF', 'SELLER_MEMBER')),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_state_json TEXT,
  next_state_json TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_seller_member_events_member
ON seller_member_events (
  member_id,
  created_at,
  id
);

CREATE INDEX idx_seller_member_events_organization
ON seller_member_events (
  organization_id,
  created_at,
  id
);

CREATE TRIGGER trg_seller_member_events_no_update
BEFORE UPDATE ON seller_member_events
BEGIN
  SELECT RAISE(ABORT, 'seller_member_events_are_immutable');
END;

CREATE TRIGGER trg_seller_member_events_no_delete
BEFORE DELETE ON seller_member_events
BEGIN
  SELECT RAISE(ABORT, 'seller_member_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=6,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
