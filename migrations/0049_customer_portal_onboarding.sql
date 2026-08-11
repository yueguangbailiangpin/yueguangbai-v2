PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=48
) THEN 1 ELSE 0 END;

-- This seller channel is only a legacy seller-code allocator for organizations
-- created by the new portal onboarding flow. It is NOT an acquisition source.
INSERT OR IGNORE INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version,
  created_at, updated_at, disabled_at
) VALUES (
  'seller-channel-portal-onboarding',
  'portal-onboarding',
  'portal',
  '新系统卖家账号开通',
  'ACTIVE',
  1,
  1,
  CAST(unixepoch('now') AS INTEGER)*1000,
  CAST(unixepoch('now') AS INTEGER)*1000,
  NULL
);

CREATE TABLE customer_seller_invitations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
  normalized_wechat TEXT NOT NULL CHECK (length(normalized_wechat) BETWEEN 3 AND 128),
  wechat_display TEXT NOT NULL CHECK (length(wechat_display) BETWEEN 3 AND 128),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  acquisition_lead_id TEXT REFERENCES acquisition_leads(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  seller_member_id TEXT NOT NULL REFERENCES seller_organization_members(id),
  onboarding_kind TEXT NOT NULL CHECK (onboarding_kind IN ('NEW_CUSTOMER','HISTORICAL_ACCOUNT_ONLY')),
  issued_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED','EXPIRED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  issued_at INTEGER NOT NULL CHECK (issued_at>=0),
  expires_at INTEGER NOT NULL CHECK (expires_at>issued_at),
  consumed_at INTEGER,
  consumed_by_account_id TEXT REFERENCES customer_login_accounts(id),
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ACTIVE' AND consumed_at IS NULL AND consumed_by_account_id IS NULL AND revoked_at IS NULL)
    OR (status='CONSUMED' AND consumed_at IS NOT NULL AND consumed_by_account_id IS NOT NULL AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND consumed_at IS NULL)
    OR status='EXPIRED'
  )
) STRICT;

CREATE UNIQUE INDEX uq_customer_seller_invitation_active_org
ON customer_seller_invitations(seller_organization_id)
WHERE status='ACTIVE';
CREATE INDEX idx_customer_seller_invitation_wechat
ON customer_seller_invitations(normalized_wechat,status,expires_at,id);
CREATE INDEX idx_customer_seller_invitation_lead
ON customer_seller_invitations(acquisition_lead_id,status,id);

CREATE TABLE customer_seller_invitation_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  invitation_id TEXT NOT NULL REFERENCES customer_seller_invitations(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','CUSTOMER','SYSTEM')),
  actor_id TEXT,
  request_id TEXT,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE INDEX idx_customer_seller_invitation_events
ON customer_seller_invitation_events(invitation_id,created_at,id);

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_seller_invitations')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_seller_invitation_events')
  AND EXISTS (SELECT 1 FROM seller_channels WHERE id='seller-channel-portal-onboarding' AND status='ACTIVE')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=49, installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=48;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
