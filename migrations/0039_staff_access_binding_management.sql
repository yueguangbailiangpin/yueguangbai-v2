PRAGMA foreign_keys = ON;

-- Staff access management owns schema 39. Invitations hold only hashes; the
-- verified Feishu subject is written by the existing Staff provision command.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=38
) THEN 1 ELSE 0 END;

CREATE TABLE staff_binding_invitations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  role_code TEXT NOT NULL CHECK (
    role_code IN ('owner','pre_sales','seller_ops','buyer_refund')
  ),
  team_id TEXT REFERENCES staff_teams(id),
  issued_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (
    status IN ('ISSUED','CONSUMED','CANCELLED','EXPIRED')
  ),
  consumed_staff_id TEXT REFERENCES staff_users(id),
  expires_at INTEGER NOT NULL CHECK (expires_at>created_at),
  consumed_at INTEGER,
  cancelled_at INTEGER,
  version INTEGER NOT NULL CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ISSUED' AND consumed_staff_id IS NULL
      AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (status='CONSUMED' AND consumed_staff_id IS NOT NULL
      AND consumed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='CANCELLED' AND consumed_staff_id IS NULL
      AND consumed_at IS NULL AND cancelled_at IS NOT NULL)
    OR (status='EXPIRED' AND consumed_staff_id IS NULL
      AND consumed_at IS NULL AND cancelled_at IS NULL
      AND updated_at>=expires_at)
  ),
  CHECK (consumed_at IS NULL OR consumed_at BETWEEN created_at AND updated_at),
  CHECK (cancelled_at IS NULL OR cancelled_at BETWEEN created_at AND updated_at),
  CHECK (
    (role_code='owner' AND team_id IS NULL)
    OR (role_code<>'owner' AND team_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_binding_invitations_status_expiry
ON staff_binding_invitations(status,expires_at,id);

CREATE INDEX idx_staff_binding_invitations_issuer_created
ON staff_binding_invitations(issued_by_staff_id,created_at,id);

CREATE TRIGGER trg_staff_binding_invitation_identity_immutable
BEFORE UPDATE ON staff_binding_invitations
WHEN NEW.id<>OLD.id
  OR NEW.token_hash<>OLD.token_hash
  OR NEW.display_name<>OLD.display_name
  OR NEW.role_code<>OLD.role_code
  OR COALESCE(NEW.team_id,'')<>COALESCE(OLD.team_id,'')
  OR NEW.issued_by_staff_id<>OLD.issued_by_staff_id
  OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at
BEGIN
  SELECT RAISE(ABORT,'staff_binding_invitation_identity_immutable');
END;

CREATE TRIGGER trg_staff_binding_invitation_transition_guard
BEFORE UPDATE ON staff_binding_invitations
WHEN NOT (
  OLD.status='ISSUED'
  AND NEW.status IN ('CONSUMED','CANCELLED','EXPIRED')
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
)
BEGIN
  SELECT RAISE(ABORT,'invalid_staff_binding_invitation_transition');
END;

CREATE TRIGGER trg_staff_binding_invitations_no_delete
BEFORE DELETE ON staff_binding_invitations
BEGIN
  SELECT RAISE(ABORT,'staff_binding_invitations_cannot_be_deleted');
END;

CREATE TABLE staff_binding_login_states (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  state_hash TEXT NOT NULL UNIQUE CHECK (
    length(state_hash)=64 AND state_hash NOT GLOB '*[^0-9a-f]*'
  ),
  invitation_id TEXT NOT NULL REFERENCES staff_binding_invitations(id),
  provider TEXT NOT NULL CHECK (provider='FEISHU'),
  tenant_key TEXT NOT NULL CHECK (length(tenant_key) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (
    status IN ('ISSUED','CONSUMED','EXPIRED','CANCELLED')
  ),
  request_id TEXT CHECK (request_id IS NULL OR length(request_id)<=200),
  expires_at INTEGER NOT NULL CHECK (expires_at>created_at),
  consumed_at INTEGER,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ISSUED' AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (status='CONSUMED' AND consumed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='EXPIRED' AND consumed_at IS NULL AND cancelled_at IS NULL
      AND updated_at>=expires_at)
    OR (status='CANCELLED' AND consumed_at IS NULL AND cancelled_at IS NOT NULL)
  ),
  CHECK (consumed_at IS NULL OR consumed_at BETWEEN created_at AND updated_at),
  CHECK (cancelled_at IS NULL OR cancelled_at BETWEEN created_at AND updated_at)
) STRICT;

CREATE INDEX idx_staff_binding_login_states_status_expiry
ON staff_binding_login_states(status,expires_at,id);

CREATE INDEX idx_staff_binding_login_states_invitation_created
ON staff_binding_login_states(invitation_id,created_at,id);

CREATE TRIGGER trg_staff_binding_login_state_identity_immutable
BEFORE UPDATE ON staff_binding_login_states
WHEN NEW.id<>OLD.id
  OR NEW.state_hash<>OLD.state_hash
  OR NEW.invitation_id<>OLD.invitation_id
  OR NEW.provider<>OLD.provider
  OR NEW.tenant_key<>OLD.tenant_key
  OR COALESCE(NEW.request_id,'')<>COALESCE(OLD.request_id,'')
  OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at
BEGIN
  SELECT RAISE(ABORT,'staff_binding_login_state_identity_immutable');
END;

CREATE TRIGGER trg_staff_binding_login_state_transition_guard
BEFORE UPDATE ON staff_binding_login_states
WHEN NOT (
  OLD.status='ISSUED'
  AND NEW.status IN ('CONSUMED','EXPIRED','CANCELLED')
  AND NEW.updated_at>=OLD.updated_at
)
BEGIN
  SELECT RAISE(ABORT,'invalid_staff_binding_login_state_transition');
END;

CREATE TRIGGER trg_staff_binding_login_states_no_delete
BEFORE DELETE ON staff_binding_login_states
BEGIN
  SELECT RAISE(ABORT,'staff_binding_login_states_cannot_be_deleted');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='staff_binding_invitations')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='staff_binding_login_states')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='trigger' AND name='trg_staff_binding_invitations_no_delete')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='trigger' AND name='trg_staff_binding_login_states_no_delete')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=39,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=38;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
