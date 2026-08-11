PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Frozen Staff + Acquisition Core foundation.  This migration is intentionally
-- forward-only: existing customer/order/financial facts are not rewritten.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=43
) THEN 1 ELSE 0 END;

-- Publish the fifth canonical Staff role while preserving all role history.
DROP VIEW staff_effective_assignment_permissions;

CREATE TABLE staff_role_assignments_next (
  id TEXT PRIMARY KEY DEFAULT ('role-' || lower(hex(randomblob(16))))
    CHECK (length(id) BETWEEN 1 AND 200),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  role_code TEXT NOT NULL CHECK (
    (status='ACTIVE' AND role_code IN (
      'owner','acquisition','pre_sales','seller_ops','buyer_refund'
    ))
    OR
    (status='REVOKED' AND role_code IN (
      'owner','acquisition','pre_sales','seller_ops','buyer_refund',
      'seller_support','after_sales','buyer_support'
    ))
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  assigned_by_staff_id TEXT REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL CHECK (assigned_at>=0),
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  revoked_reason TEXT CHECK (
    revoked_reason IS NULL OR length(revoked_reason) BETWEEN 1 AND 1000
  ),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL
      AND revoked_by_staff_id IS NULL AND revoked_reason IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL
      AND revoked_at>=assigned_at)
  )
) STRICT;

INSERT INTO staff_role_assignments_next (
  id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,
  revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at
)
SELECT id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,
  revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at
FROM staff_role_assignments;

-- SQLite reparses triggers on unrelated tables while dropping a referenced
-- table.  Keep their SQL text intact during this in-place constraint rebuild;
-- the replacement table immediately reclaims the same canonical name.
PRAGMA legacy_alter_table = ON;
DROP TABLE staff_role_assignments;
ALTER TABLE staff_role_assignments_next RENAME TO staff_role_assignments;
PRAGMA legacy_alter_table = OFF;

CREATE UNIQUE INDEX uq_staff_role_assignment_one_active
ON staff_role_assignments(staff_id) WHERE status='ACTIVE';
CREATE INDEX idx_staff_role_assignment_role_status
ON staff_role_assignments(role_code,status,staff_id);

CREATE TRIGGER trg_staff_role_assignments_revoke_only
BEFORE UPDATE ON staff_role_assignments
WHEN NOT (
  OLD.status='ACTIVE' AND NEW.status='REVOKED'
  AND NEW.id IS OLD.id
  AND NEW.staff_id IS OLD.staff_id
  AND NEW.role_code IS OLD.role_code
  AND NEW.assigned_by_staff_id IS OLD.assigned_by_staff_id
  AND NEW.assigned_at IS OLD.assigned_at
  AND NEW.created_at IS OLD.created_at
  AND NEW.revoked_at IS NOT NULL
  AND NEW.revoked_at>=OLD.assigned_at
  AND NEW.revoked_by_staff_id IS NOT NULL
  AND NEW.revoked_reason IS NOT NULL
  AND NEW.updated_at>=OLD.updated_at
)
BEGIN
  SELECT RAISE(ABORT,'staff_role_assignments_are_immutable');
END;

CREATE TRIGGER trg_staff_role_assignments_no_delete
BEFORE DELETE ON staff_role_assignments
BEGIN
  SELECT RAISE(ABORT,'staff_role_assignments_are_immutable');
END;

CREATE VIEW staff_effective_assignment_permissions AS
WITH role_permissions AS (
  SELECT assignment.staff_id, defaults.permission_code
  FROM staff_role_assignments assignment
  JOIN staff_assignment_role_permission_defaults defaults
    ON defaults.role_code=assignment.role_code
  WHERE assignment.status='ACTIVE'
),
explicit_grants AS (
  SELECT staff_id, permission_code
  FROM staff_permission_overrides
  WHERE status='ACTIVE' AND effect='GRANT'
),
combined AS (
  SELECT staff_id, permission_code FROM role_permissions
  UNION
  SELECT staff_id, permission_code FROM explicit_grants
)
SELECT combined.staff_id, combined.permission_code
FROM combined
WHERE NOT EXISTS (
  SELECT 1 FROM staff_permission_overrides denied
  WHERE denied.staff_id=combined.staff_id
    AND denied.permission_code=combined.permission_code
    AND denied.status='ACTIVE' AND denied.effect='DENY'
);

-- Cloudflare Access proves the email; Moonwhite owns Staff lifecycle/role/scope.
CREATE TABLE staff_email_identities (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  staff_id TEXT NOT NULL UNIQUE REFERENCES staff_users(id),
  normalized_email TEXT NOT NULL UNIQUE CHECK (
    length(normalized_email) BETWEEN 3 AND 320
    AND normalized_email=lower(normalized_email)
    AND instr(normalized_email,'@')>1
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  verified_at INTEGER,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  revoked_at INTEGER,
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;
CREATE INDEX idx_staff_email_identity_status
ON staff_email_identities(status,normalized_email);

-- Role says what Staff can do. Marketplace scope says where that role applies.
CREATE TABLE staff_marketplace_scopes (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  role_code TEXT NOT NULL CHECK (role_code IN (
    'acquisition','pre_sales','seller_ops','buyer_refund'
  )),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  assigned_by_staff_id TEXT REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL CHECK (assigned_at>=0),
  revoked_at INTEGER,
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;
CREATE UNIQUE INDEX uq_staff_marketplace_scope_active
ON staff_marketplace_scopes(staff_id,marketplace_code)
WHERE status='ACTIVE';
CREATE INDEX idx_staff_marketplace_scope_role_market
ON staff_marketplace_scopes(role_code,marketplace_code,status,staff_id);

-- Existing ordinary Staff are the current JP team. Owner remains GLOBAL and
-- therefore intentionally receives no marketplace scope rows.
INSERT INTO staff_marketplace_scopes (
  id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
  assigned_at,revoked_at,reason,created_at,updated_at
)
SELECT 'm44-scope-' || lower(hex(randomblob(16))), role.staff_id,
  role.role_code,'AMAZON_JP','ACTIVE',NULL,
  CAST(unixepoch('now') AS INTEGER)*1000,NULL,'MIGRATION_0044_CURRENT_JP_SCOPE',
  CAST(unixepoch('now') AS INTEGER)*1000,
  CAST(unixepoch('now') AS INTEGER)*1000
FROM staff_role_assignments role
JOIN staff_users staff ON staff.id=role.staff_id
WHERE role.status='ACTIVE' AND staff.status='ACTIVE'
  AND role.role_code IN ('pre_sales','seller_ops','buyer_refund');

-- Work items become marketplace-aware. Existing operational facts are JP.
ALTER TABLE staff_work_items ADD COLUMN marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','TIKTOK_JP'
  ));
CREATE INDEX idx_staff_work_items_marketplace_status
ON staff_work_items(marketplace_code,status,work_type,created_at,id);

-- Channels become data-configurable by platform, audience and marketplace.
ALTER TABLE acquisition_channels ADD COLUMN platform_name TEXT NOT NULL DEFAULT '其他'
  CHECK (length(platform_name) BETWEEN 1 AND 100);
ALTER TABLE acquisition_channels ADD COLUMN lead_type TEXT NOT NULL DEFAULT 'BUYER'
  CHECK (lead_type IN ('BUYER','SELLER','BOTH'));
ALTER TABLE acquisition_channels ADD COLUMN marketplace_code TEXT NOT NULL DEFAULT 'AMAZON_JP'
  CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','TIKTOK_JP'
  ));
UPDATE acquisition_channels SET platform_name=CASE channel_type
  WHEN 'XIAOHONGSHU' THEN '小红书'
  WHEN 'PRIVATE_WECHAT' THEN '私人微信'
  WHEN 'REFERRAL' THEN '转介绍'
  ELSE '其他' END;
UPDATE acquisition_channels
SET lead_type=CASE
  WHEN EXISTS (SELECT 1 FROM acquisition_staff_channel_assignments a
    WHERE a.channel_id=acquisition_channels.id AND a.lead_type='BUYER')
   AND EXISTS (SELECT 1 FROM acquisition_staff_channel_assignments a
    WHERE a.channel_id=acquisition_channels.id AND a.lead_type='SELLER') THEN 'BOTH'
  WHEN EXISTS (SELECT 1 FROM acquisition_staff_channel_assignments a
    WHERE a.channel_id=acquisition_channels.id AND a.lead_type='SELLER') THEN 'SELLER'
  ELSE 'BUYER' END;
CREATE INDEX idx_acquisition_channel_audience_market
ON acquisition_channels(lead_type,marketplace_code,status,display_name);

-- Existing Leads keep their source channel and gain immutable marketplace/origin
-- provenance.  Prospect is optional because inbound advertising can jump
-- directly from Channel to Lead after WeChat/contact is established.
ALTER TABLE acquisition_leads ADD COLUMN marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','TIKTOK_JP'
  ));
ALTER TABLE acquisition_leads ADD COLUMN prospect_id TEXT;
ALTER TABLE acquisition_leads ADD COLUMN origin_mode TEXT NOT NULL DEFAULT 'HUMAN'
  CHECK (origin_mode IN ('HUMAN','CODEX'));
ALTER TABLE acquisition_leads ADD COLUMN origin_source_url TEXT
  CHECK (origin_source_url IS NULL OR length(origin_source_url)<=2000);
CREATE INDEX idx_acquisition_lead_market_source
ON acquisition_leads(lead_type,marketplace_code,origin_channel_id,created_at,id);

CREATE TABLE acquisition_prospects (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  origin_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  contact_value TEXT CHECK (contact_value IS NULL OR length(contact_value)<=320),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url)<=2000),
  origin_mode TEXT NOT NULL CHECK (origin_mode IN ('HUMAN','CODEX')),
  status TEXT NOT NULL CHECK (status IN (
    'NEW','RESEARCHING','QUALIFIED','READY_CONTACT','CONTACTED',
    'HUMAN_HANDOFF','CONVERTED','LOST'
  )),
  ai_score INTEGER CHECK (ai_score IS NULL OR ai_score BETWEEN 0 AND 100),
  note TEXT CHECK (note IS NULL OR length(note)<=4000),
  created_by_actor_type TEXT NOT NULL CHECK (created_by_actor_type IN ('STAFF','CODEX')),
  created_by_actor_id TEXT NOT NULL CHECK (length(created_by_actor_id) BETWEEN 1 AND 200),
  discovered_at INTEGER NOT NULL CHECK (discovered_at>=0),
  converted_lead_id TEXT UNIQUE REFERENCES acquisition_leads(id),
  version INTEGER NOT NULL CHECK (version>=1),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK ((status='CONVERTED')=(converted_lead_id IS NOT NULL))
) STRICT;
CREATE INDEX idx_acquisition_prospect_queue
ON acquisition_prospects(lead_type,marketplace_code,status,ai_score,discovered_at,id);
CREATE INDEX idx_acquisition_prospect_channel
ON acquisition_prospects(origin_channel_id,origin_mode,discovered_at,id);

CREATE TABLE acquisition_prospect_signals (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  prospect_id TEXT NOT NULL REFERENCES acquisition_prospects(id),
  signal_type TEXT NOT NULL CHECK (length(signal_type) BETWEEN 1 AND 100),
  signal_content TEXT NOT NULL CHECK (length(signal_content) BETWEEN 1 AND 4000),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url)<=2000),
  confidence TEXT NOT NULL CHECK (confidence IN ('LOW','MEDIUM','HIGH','CONFIRMED')),
  created_by_actor_type TEXT NOT NULL CHECK (created_by_actor_type IN ('STAFF','CODEX')),
  created_by_actor_id TEXT NOT NULL CHECK (length(created_by_actor_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE INDEX idx_acquisition_prospect_signal
ON acquisition_prospect_signals(prospect_id,created_at,id);

-- Link direction is guarded after both tables exist.
CREATE TRIGGER trg_acquisition_lead_prospect_guard
BEFORE UPDATE OF prospect_id ON acquisition_leads
WHEN NEW.prospect_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM acquisition_prospects prospect
  WHERE prospect.id=NEW.prospect_id
    AND prospect.lead_type=NEW.lead_type
    AND prospect.marketplace_code=NEW.marketplace_code
    AND prospect.origin_channel_id=NEW.origin_channel_id
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_lead_prospect_source_mismatch');
END;

-- Any Staff scope/identity cutover invalidates previously issued sessions.
UPDATE staff_sessions
SET status='REVOKED',revoked_at=CAST(unixepoch('now') AS INTEGER)*1000,
  revoked_reason='STAFF_MARKETPLACE_AUTHORIZATION_CUTOVER',
  updated_at=MAX(updated_at,CAST(unixepoch('now') AS INTEGER)*1000)
WHERE status='ACTIVE';
UPDATE staff_users
SET authorization_version=authorization_version+1,
  session_version=session_version+1,version=version+1,
  updated_at=MAX(updated_at,CAST(unixepoch('now') AS INTEGER)*1000)
WHERE status='ACTIVE';

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='staff_email_identities')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='staff_marketplace_scopes')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_prospects')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_prospect_signals')
  AND EXISTS (SELECT 1 FROM pragma_table_info('staff_work_items') WHERE name='marketplace_code')
  AND EXISTS (SELECT 1 FROM pragma_table_info('acquisition_leads') WHERE name='marketplace_code')
  AND NOT EXISTS (SELECT 1 FROM staff_sessions WHERE status='ACTIVE')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=44,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=43;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
