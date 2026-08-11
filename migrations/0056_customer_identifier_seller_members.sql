PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=55
) THEN 1 ELSE 0 END;

-- Changing WeChat/login identifier never recreates the business subject.
CREATE TABLE customer_login_identifier_change_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  account_id TEXT NOT NULL REFERENCES customer_login_accounts(id),
  identity_subject_id TEXT NOT NULL REFERENCES customer_identity_subjects(id),
  previous_wechat_normalized TEXT NOT NULL CHECK (length(previous_wechat_normalized) BETWEEN 1 AND 200),
  next_wechat_normalized TEXT NOT NULL CHECK (length(next_wechat_normalized) BETWEEN 1 AND 200),
  previous_wechat_display TEXT NOT NULL CHECK (length(previous_wechat_display) BETWEEN 1 AND 200),
  next_wechat_display TEXT NOT NULL CHECK (length(next_wechat_display) BETWEEN 1 AND 200),
  verification_note TEXT NOT NULL CHECK (length(verification_note) BETWEEN 8 AND 2000),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  CHECK (previous_wechat_normalized<>next_wechat_normalized)
) STRICT;
CREATE INDEX idx_customer_login_identifier_change_account
ON customer_login_identifier_change_events(account_id,created_at DESC,id DESC);
CREATE TRIGGER trg_customer_login_identifier_change_events_no_update
BEFORE UPDATE ON customer_login_identifier_change_events
BEGIN SELECT RAISE(ABORT,'customer_login_identifier_change_events_are_immutable'); END;
CREATE TRIGGER trg_customer_login_identifier_change_events_no_delete
BEFORE DELETE ON customer_login_identifier_change_events
BEGIN SELECT RAISE(ABORT,'customer_login_identifier_change_events_are_immutable'); END;

-- Seller OWNER may invite operational/finance/viewer members. OWNER ownership
-- itself is not delegated by invitation in V1.
CREATE TABLE seller_member_invitations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
  organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  invited_wechat_normalized TEXT NOT NULL CHECK (length(invited_wechat_normalized) BETWEEN 1 AND 200),
  invited_wechat_display TEXT NOT NULL CHECK (length(invited_wechat_display) BETWEEN 1 AND 200),
  invited_display_name TEXT NOT NULL CHECK (length(invited_display_name) BETWEEN 1 AND 100),
  invited_role TEXT NOT NULL CHECK (invited_role IN ('OPERATIONS','FINANCE','VIEWER')),
  store_scope_json TEXT NOT NULL CHECK (json_valid(store_scope_json)),
  issued_by_member_id TEXT NOT NULL REFERENCES seller_organization_members(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED','EXPIRED')),
  version INTEGER NOT NULL CHECK (version>=1),
  issued_at INTEGER NOT NULL CHECK (issued_at>=0),
  expires_at INTEGER NOT NULL CHECK (expires_at>issued_at),
  consumed_at INTEGER,
  consumed_member_id TEXT REFERENCES seller_organization_members(id),
  consumed_account_id TEXT REFERENCES customer_login_accounts(id),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ACTIVE' AND consumed_at IS NULL AND consumed_member_id IS NULL AND consumed_account_id IS NULL AND revoked_at IS NULL)
    OR (status='CONSUMED' AND consumed_at IS NOT NULL AND consumed_member_id IS NOT NULL AND consumed_account_id IS NOT NULL AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND consumed_at IS NULL)
    OR (status='EXPIRED' AND consumed_at IS NULL AND revoked_at IS NULL)
  )
) STRICT;
CREATE UNIQUE INDEX uq_seller_member_invitation_active_identity
ON seller_member_invitations(organization_id,invited_wechat_normalized)
WHERE status='ACTIVE';
CREATE INDEX idx_seller_member_invitation_org_status
ON seller_member_invitations(organization_id,status,issued_at DESC,id DESC);

CREATE TABLE seller_member_invitation_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  invitation_id TEXT NOT NULL REFERENCES seller_member_invitations(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('SELLER_MEMBER','CUSTOMER','SYSTEM')),
  actor_id TEXT,
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE INDEX idx_seller_member_invitation_events
ON seller_member_invitation_events(invitation_id,created_at,id);
CREATE TRIGGER trg_seller_member_invitation_events_no_update
BEFORE UPDATE ON seller_member_invitation_events
BEGIN SELECT RAISE(ABORT,'seller_member_invitation_events_are_immutable'); END;
CREATE TRIGGER trg_seller_member_invitation_events_no_delete
BEFORE DELETE ON seller_member_invitation_events
BEGIN SELECT RAISE(ABORT,'seller_member_invitation_events_are_immutable'); END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_login_identifier_change_events')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='seller_member_invitations')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='seller_member_invitation_events')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=56,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=55;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
