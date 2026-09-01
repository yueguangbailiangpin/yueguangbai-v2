-- Stage 6.6C (D-056): retire the acquisition CRM runtime tables (buyer_channels
-- stays — it is a business config table, not part of the CRM), the integration
-- outbox and its dead-letter table, and drop the outbox_delivery scheduled job.
-- Forward-only; no production data exists.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=28 THEN 1 ELSE 0 END;

-- Retire triggers on rebuilt/dropped subjects first.
DROP TRIGGER IF EXISTS trg_buyer_invitation_consumed_link_acquisition_lead;

-- ===== customer_buyer_invitation_lead_links (drop the acquisition FK) =====
CREATE TABLE customer_buyer_invitation_lead_links_stage66c_new (
  invitation_id TEXT PRIMARY KEY REFERENCES customer_buyer_invitations(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
INSERT INTO customer_buyer_invitation_lead_links_stage66c_new (invitation_id, created_at)
  SELECT invitation_id, created_at FROM customer_buyer_invitation_lead_links;
DROP TABLE customer_buyer_invitation_lead_links;
ALTER TABLE customer_buyer_invitation_lead_links_stage66c_new
  RENAME TO customer_buyer_invitation_lead_links;

-- ===== customer_seller_invitations (drop the acquisition FK column) =====
CREATE TABLE customer_seller_invitations_stage66c_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
  normalized_wechat TEXT NOT NULL CHECK (length(normalized_wechat) BETWEEN 3 AND 128),
  wechat_display TEXT NOT NULL CHECK (length(wechat_display) BETWEEN 3 AND 128),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  -- NEW_CUSTOMER and imported historical organizations may not have a member
  -- identity yet. The OWNER member is created only after the customer proves
  -- the invitation + WeChat/password boundary. This avoids granting a Seller
  -- persona to an existing Buyer account before customer confirmation.
  seller_member_id TEXT REFERENCES seller_organization_members(id),
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
INSERT INTO customer_seller_invitations_stage66c_new (
  id, token_hash, normalized_wechat, wechat_display, marketplace_code,
  seller_organization_id, seller_member_id, onboarding_kind, issued_by_staff_id,
  status, version, issued_at, expires_at, consumed_at, consumed_by_account_id,
  revoked_at, revoked_by_staff_id, created_at, updated_at
)
SELECT
  id, token_hash, normalized_wechat, wechat_display, marketplace_code,
  seller_organization_id, seller_member_id, onboarding_kind, issued_by_staff_id,
  status, version, issued_at, expires_at, consumed_at, consumed_by_account_id,
  revoked_at, revoked_by_staff_id, created_at, updated_at
FROM customer_seller_invitations;
DROP TABLE customer_seller_invitations;
ALTER TABLE customer_seller_invitations_stage66c_new
  RENAME TO customer_seller_invitations;

-- ===== acquisition CRM tables (buyer_channels is NOT here) =====
DROP TABLE acquisition_assignment_events;
DROP TABLE acquisition_channel_events;
DROP TABLE acquisition_channel_privacy_profiles;
DROP TABLE acquisition_channels;
DROP TABLE acquisition_customer_attributions;
DROP TABLE acquisition_customer_intake_facts;
DROP TABLE acquisition_daily_consultation_events;
DROP TABLE acquisition_daily_consultations;
DROP TABLE acquisition_historical_source_exemptions;
DROP TABLE acquisition_lead_events;
DROP TABLE acquisition_lead_links;
DROP TABLE acquisition_lead_source_corrections;
DROP TABLE acquisition_leads;
DROP TABLE acquisition_maintenance_runs;
DROP TABLE acquisition_maintenance_state;
DROP TABLE acquisition_prospects;
DROP TABLE acquisition_role_permission_defaults;
DROP TABLE acquisition_staff_channel_assignments;

-- ===== integration outbox family =====
DROP TABLE scheduled_dead_letters;
DROP TABLE integration_outbox;

-- ===== scheduled_job_states: retire outbox_delivery =====
CREATE TABLE "scheduled_job_states_stage66c_new" (
  job_name TEXT PRIMARY KEY CHECK (job_name IN (
    'reservation_expiry','instruction_expiry',
    'file_orphan_cleanup','drive_archive'
  )),
  cursor_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  lease_token TEXT,
  lease_expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  last_started_at INTEGER,
  last_succeeded_at INTEGER,
  last_failed_at INTEGER,
  last_failure_category TEXT,
  last_backlog_count INTEGER NOT NULL DEFAULT 0 CHECK (last_backlog_count>=0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at)='integer' AND updated_at>=0)
) STRICT;
INSERT INTO "scheduled_job_states_stage66c_new" (
  job_name, cursor_json, enabled, lease_token, lease_expires_at, version,
  last_started_at, last_succeeded_at, last_failed_at, last_failure_category,
  last_backlog_count, updated_at
)
SELECT
  job_name, cursor_json, enabled, lease_token, lease_expires_at, version,
  last_started_at, last_succeeded_at, last_failed_at, last_failure_category,
  last_backlog_count, updated_at
FROM scheduled_job_states
WHERE job_name<>'outbox_delivery';
DROP TABLE scheduled_job_states;
ALTER TABLE "scheduled_job_states_stage66c_new" RENAME TO scheduled_job_states;

UPDATE app_schema_state
SET
  schema_version=29,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
