-- Baseline 0017 acquisition_manual_funnel (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=16 THEN 1 ELSE 0 END;

CREATE TABLE acquisition_channels (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  code TEXT NOT NULL UNIQUE CHECK (
    length(code) BETWEEN 2 AND 40
    AND code=upper(code)
    AND code NOT GLOB '*[^A-Z0-9_-]*'
  ),
  channel_type TEXT NOT NULL CHECK (channel_type IN (
    'XIAOHONGSHU','PRIVATE_WECHAT','REFERRAL','OTHER'
  )),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  version INTEGER NOT NULL CHECK (version>=1),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  disabled_at INTEGER, platform_name TEXT NOT NULL DEFAULT '其他'
  CHECK (length(platform_name) BETWEEN 1 AND 100), lead_type TEXT NOT NULL DEFAULT 'BUYER'
  CHECK (lead_type IN ('BUYER','SELLER','BOTH')), marketplace_code TEXT NOT NULL DEFAULT 'AMAZON_JP'
  CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','TIKTOK_JP'
  )),
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE acquisition_staff_channel_assignments (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  effective_from INTEGER NOT NULL CHECK (effective_from>=0),
  effective_until INTEGER CHECK (
    effective_until IS NULL OR effective_until>effective_from
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  version INTEGER NOT NULL CHECK (version>=1),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  revoked_at INTEGER,
  revoke_reason TEXT CHECK (
    revoke_reason IS NULL OR length(revoke_reason) BETWEEN 1 AND 1000
  ),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
) STRICT;

CREATE TABLE acquisition_assignment_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  assignment_id TEXT NOT NULL REFERENCES acquisition_staff_channel_assignments(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED','REVOKED')),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

CREATE TABLE acquisition_channel_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED','DISABLED')),
  previous_version INTEGER,
  next_version INTEGER NOT NULL CHECK (next_version>=1),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

CREATE TABLE acquisition_channel_privacy_profiles (
  channel_id TEXT PRIMARY KEY REFERENCES acquisition_channels(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER','BOTH')),
  staff_label TEXT NOT NULL CHECK (length(staff_label) BETWEEN 1 AND 40),
  intake_wechat_label TEXT CHECK (
    intake_wechat_label IS NULL OR length(intake_wechat_label) BETWEEN 1 AND 100
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  updated_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at)
) STRICT;

CREATE TABLE acquisition_leads (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  identity_hash TEXT CHECK (
    identity_hash IS NULL OR (
      length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  identity_ciphertext TEXT,
  identity_iv TEXT,
  wechat_masked TEXT NOT NULL CHECK (length(wechat_masked) BETWEEN 1 AND 32),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name)<=100),
  note TEXT CHECK (note IS NULL OR length(note)<=1000),
  origin_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  origin_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  current_owner_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','INVALIDATED','ANONYMIZED')),
  invalidation_reason TEXT CHECK (
    invalidation_reason IS NULL OR length(invalidation_reason) BETWEEN 1 AND 1000
  ),
  retention_hold_reason TEXT CHECK (retention_hold_reason IN (
    'SECURITY','DISPUTE','LEGAL'
  )),
  version INTEGER NOT NULL CHECK (version>=1),
  created_business_date TEXT NOT NULL CHECK (
    created_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(created_business_date)=created_business_date
  ),
  latest_followup_at INTEGER NOT NULL CHECK (latest_followup_at>=0),
  retention_due_at INTEGER NOT NULL CHECK (retention_due_at>latest_followup_at),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  invalidated_at INTEGER,
  anonymized_at INTEGER, marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','TIKTOK_JP'
  )), prospect_id TEXT, origin_mode TEXT NOT NULL DEFAULT 'HUMAN'
  CHECK (origin_mode IN ('HUMAN','CODEX')), origin_source_url TEXT
  CHECK (origin_source_url IS NULL OR length(origin_source_url)<=2000),
  CHECK (
    (status='ACTIVE' AND identity_hash IS NOT NULL
      AND identity_ciphertext IS NOT NULL AND identity_iv IS NOT NULL
      AND invalidation_reason IS NULL AND invalidated_at IS NULL
      AND anonymized_at IS NULL)
    OR (status='INVALIDATED' AND identity_hash IS NOT NULL
      AND identity_ciphertext IS NOT NULL AND identity_iv IS NOT NULL
      AND invalidation_reason IS NOT NULL AND invalidated_at IS NOT NULL
      AND anonymized_at IS NULL)
    OR (status='ANONYMIZED' AND identity_hash IS NULL
      AND identity_ciphertext IS NULL AND identity_iv IS NULL
      AND invalidation_reason IS NULL AND invalidated_at IS NULL
      AND anonymized_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE acquisition_customer_attributions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('BUYER_CUSTOMER','SELLER_ORGANIZATION')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  lead_id TEXT NOT NULL REFERENCES acquisition_leads(id),
  origin_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  origin_mode TEXT NOT NULL CHECK (origin_mode IN ('HUMAN','CODEX')),
  attributed_at INTEGER NOT NULL CHECK (attributed_at>=0),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  UNIQUE(subject_type,subject_id,marketplace_code)
) STRICT;

CREATE TABLE acquisition_customer_intake_facts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  lead_id TEXT NOT NULL UNIQUE REFERENCES acquisition_leads(id),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  original_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  business_date TEXT NOT NULL CHECK (
    business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(business_date)=business_date
  ),
  recorded_at INTEGER NOT NULL CHECK (recorded_at>=0),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id)
) STRICT;

CREATE TABLE acquisition_daily_consultations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  business_date TEXT NOT NULL CHECK (
    business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(business_date)=business_date
  ),
  person_count INTEGER NOT NULL CHECK (person_count BETWEEN 0 AND 1000000),
  version INTEGER NOT NULL CHECK (version>=1),
  updated_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  UNIQUE(channel_id,business_date)
) STRICT;

CREATE TABLE acquisition_daily_consultation_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  consultation_id TEXT NOT NULL REFERENCES acquisition_daily_consultations(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('RECORDED','CORRECTED')),
  previous_count INTEGER CHECK (previous_count IS NULL OR previous_count>=0),
  next_count INTEGER NOT NULL CHECK (next_count BETWEEN 0 AND 1000000),
  previous_version INTEGER,
  next_version INTEGER NOT NULL CHECK (next_version>=1),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

CREATE TABLE acquisition_historical_source_exemptions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('BUYER_CUSTOMER','SELLER_ORGANIZATION')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  declared_at INTEGER NOT NULL CHECK (declared_at>=0),
  declared_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  UNIQUE(subject_type,subject_id,marketplace_code)
) STRICT;

CREATE TABLE acquisition_lead_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  lead_id TEXT NOT NULL REFERENCES acquisition_leads(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'CREATED','FOLLOWED_UP','TRANSFERRED','INVALIDATED',
    'RETENTION_HOLD_SET','RETENTION_HOLD_CLEARED','ANONYMIZED'
  )),
  previous_version INTEGER,
  next_version INTEGER NOT NULL CHECK (next_version>=1),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','SYSTEM')),
  actor_id TEXT,
  idempotency_key TEXT CHECK (
    idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 128
  ),
  request_hash TEXT CHECK (
    request_hash IS NULL OR (
      length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

CREATE TABLE acquisition_lead_links (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  lead_id TEXT NOT NULL REFERENCES acquisition_leads(id),
  link_type TEXT NOT NULL CHECK (link_type IN (
    'IDENTITY_SUBJECT','BUYER_CUSTOMER','SELLER_MEMBER',
    'SELLER_ORGANIZATION','RESERVATION','FORMAL_ORDER'
  )),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 200),
  linked_at INTEGER NOT NULL CHECK (linked_at>=0),
  UNIQUE(lead_id,link_type,target_id)
) STRICT;

CREATE TABLE acquisition_lead_source_corrections (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  lead_id TEXT NOT NULL REFERENCES acquisition_leads(id),
  previous_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  new_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  corrected_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  corrected_at INTEGER NOT NULL CHECK (corrected_at>=0),
  CHECK (previous_channel_id<>new_channel_id)
) STRICT;

CREATE TABLE acquisition_maintenance_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('CRON','DRY_RUN')),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED','SKIPPED')),
  linked_count INTEGER NOT NULL CHECK (linked_count>=0),
  anonymized_count INTEGER NOT NULL CHECK (anonymized_count>=0),
  exempt_count INTEGER NOT NULL CHECK (exempt_count>=0),
  failure_code TEXT,
  started_at INTEGER NOT NULL CHECK (started_at>=0),
  finished_at INTEGER NOT NULL CHECK (finished_at>=started_at)
) STRICT;

CREATE TABLE acquisition_maintenance_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  lease_token TEXT,
  lease_expires_at INTEGER,
  link_claim_cursor TEXT CHECK (
    link_claim_cursor IS NULL OR length(link_claim_cursor) BETWEEN 1 AND 120
  ),
  last_started_at INTEGER,
  last_succeeded_at INTEGER,
  last_failed_at INTEGER,
  last_error_code TEXT,
  version INTEGER NOT NULL CHECK (version>=1),
  updated_at INTEGER NOT NULL CHECK (updated_at>=0),
  CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
) STRICT;

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

CREATE TABLE acquisition_reporting_config (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  precision_started_business_date TEXT CHECK (
    precision_started_business_date IS NULL OR (
      precision_started_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(precision_started_business_date)=precision_started_business_date
    )
  ),
  activated_at INTEGER,
  activated_by_staff_id TEXT REFERENCES staff_users(id),
  version INTEGER NOT NULL CHECK (version>=1),
  updated_at INTEGER NOT NULL CHECK (updated_at>=0),
  CHECK (
    (precision_started_business_date IS NULL AND activated_at IS NULL AND activated_by_staff_id IS NULL)
    OR
    (precision_started_business_date IS NOT NULL AND activated_at IS NOT NULL AND activated_by_staff_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE acquisition_role_permission_defaults (
  role_code TEXT NOT NULL CHECK (role_code IN (
    'owner','pre_sales','seller_ops','buyer_refund'
  )),
  permission_code TEXT NOT NULL CHECK (permission_code IN (
    'ACQUISITION_ADMIN','ACQUISITION_BUYER_LEAD','ACQUISITION_SELLER_LEAD'
  )),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY (role_code,permission_code)
) STRICT;

CREATE INDEX idx_acquisition_assignments_resolution
ON acquisition_staff_channel_assignments(
  staff_id,lead_type,status,effective_from,effective_until
);

CREATE INDEX idx_acquisition_channel_audience_market
ON acquisition_channels(lead_type,marketplace_code,status,display_name);

CREATE INDEX idx_acquisition_consultations_date
ON acquisition_daily_consultations(business_date,channel_id);

CREATE INDEX idx_acquisition_customer_attribution_channel
ON acquisition_customer_attributions(origin_channel_id,marketplace_code,attributed_at,subject_type,subject_id);

CREATE INDEX idx_acquisition_historical_exemption_market
ON acquisition_historical_source_exemptions(marketplace_code,subject_type,subject_id);

CREATE INDEX idx_acquisition_intake_fact_channel
ON acquisition_customer_intake_facts(original_channel_id,business_date,lead_type,lead_id);

CREATE INDEX idx_acquisition_intake_fact_date
ON acquisition_customer_intake_facts(business_date,lead_type,marketplace_code,lead_id);

CREATE INDEX idx_acquisition_lead_events_lead
ON acquisition_lead_events(lead_id,created_at,id);

CREATE INDEX idx_acquisition_lead_identity_market
ON acquisition_leads(lead_type,marketplace_code,identity_hash,status,created_at,id);

CREATE INDEX idx_acquisition_lead_links_target
ON acquisition_lead_links(link_type,target_id,lead_id);

CREATE INDEX idx_acquisition_lead_market_source
ON acquisition_leads(lead_type,marketplace_code,origin_channel_id,created_at,id);

CREATE INDEX idx_acquisition_leads_origin_date
ON acquisition_leads(origin_channel_id,lead_type,created_business_date,status);

CREATE INDEX idx_acquisition_leads_owner
ON acquisition_leads(current_owner_staff_id,lead_type,status,created_at,id);

CREATE INDEX idx_acquisition_leads_retention
ON acquisition_leads(status,retention_due_at,id);

CREATE INDEX idx_acquisition_leads_type_created
ON acquisition_leads (lead_type, created_at, id);

CREATE INDEX idx_acquisition_maintenance_runs_finished
ON acquisition_maintenance_runs(finished_at DESC,id);

CREATE INDEX idx_acquisition_prospect_channel
ON acquisition_prospects(origin_channel_id,origin_mode,discovered_at,id);

CREATE INDEX idx_acquisition_prospect_queue
ON acquisition_prospects(lead_type,marketplace_code,status,ai_score,discovered_at,id);

CREATE INDEX idx_acquisition_source_correction_lead
ON acquisition_lead_source_corrections(lead_id,corrected_at DESC,id DESC);

CREATE UNIQUE INDEX uq_acquisition_channel_intake_wechat
ON acquisition_channel_privacy_profiles (intake_wechat_label)
WHERE intake_wechat_label IS NOT NULL;

CREATE UNIQUE INDEX uq_acquisition_channel_staff_label
ON acquisition_channel_privacy_profiles (
  marketplace_code, lead_type, staff_label
);

CREATE UNIQUE INDEX uq_acquisition_lead_active_identity_market
ON acquisition_leads(lead_type,marketplace_code,identity_hash)
WHERE status='ACTIVE';

CREATE TRIGGER trg_acquisition_assignment_events_no_delete
BEFORE DELETE ON acquisition_assignment_events
BEGIN SELECT RAISE(ABORT,'acquisition_assignment_events_are_immutable'); END;

CREATE TRIGGER trg_acquisition_assignment_events_no_update
BEFORE UPDATE ON acquisition_assignment_events
BEGIN SELECT RAISE(ABORT,'acquisition_assignment_events_are_immutable'); END;

CREATE TRIGGER trg_acquisition_assignment_insert_guard
BEFORE INSERT ON acquisition_staff_channel_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM acquisition_channels channel
  WHERE channel.id=NEW.channel_id AND channel.status='ACTIVE'
) OR NOT EXISTS (
  SELECT 1 FROM staff_users staff
  JOIN staff_role_assignments role ON role.staff_id=staff.id
  WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
    AND role.status='ACTIVE'
    AND (
      role.role_code='owner'
      OR (NEW.lead_type='BUYER' AND role.role_code='pre_sales')
      OR (NEW.lead_type='SELLER' AND role.role_code='seller_ops')
    )
) OR EXISTS (
  SELECT 1 FROM acquisition_staff_channel_assignments existing
  WHERE existing.staff_id=NEW.staff_id
    AND existing.lead_type=NEW.lead_type
    AND existing.status='ACTIVE'
    AND NEW.effective_from<COALESCE(existing.effective_until,9223372036854775807)
    AND existing.effective_from<COALESCE(NEW.effective_until,9223372036854775807)
)
OR EXISTS (
  SELECT 1 FROM acquisition_staff_channel_assignments existing
  WHERE existing.channel_id=NEW.channel_id
    AND existing.lead_type<>NEW.lead_type
    AND existing.status='ACTIVE'
    AND NEW.effective_from<COALESCE(existing.effective_until,9223372036854775807)
    AND existing.effective_from<COALESCE(NEW.effective_until,9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_assignment_invalid_or_overlapping');
END;

CREATE TRIGGER trg_acquisition_assignment_revoke_only
BEFORE UPDATE ON acquisition_staff_channel_assignments
WHEN NOT (
  OLD.status='ACTIVE' AND NEW.status='REVOKED'
  AND NEW.id IS OLD.id AND NEW.staff_id IS OLD.staff_id
  AND NEW.lead_type IS OLD.lead_type AND NEW.channel_id IS OLD.channel_id
  AND NEW.effective_from IS OLD.effective_from
  AND NEW.effective_until IS OLD.effective_until
  AND NEW.created_by_staff_id IS OLD.created_by_staff_id
  AND NEW.created_at IS OLD.created_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND NEW.revoked_at IS NOT NULL AND NEW.revoke_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_assignment_invalid_update');
END;

CREATE TRIGGER trg_acquisition_assignments_no_delete
BEFORE DELETE ON acquisition_staff_channel_assignments
BEGIN SELECT RAISE(ABORT,'acquisition_assignments_are_immutable'); END;

CREATE TRIGGER trg_acquisition_channel_events_no_delete
BEFORE DELETE ON acquisition_channel_events
BEGIN SELECT RAISE(ABORT,'acquisition_channel_events_are_immutable'); END;

CREATE TRIGGER trg_acquisition_channel_events_no_update
BEFORE UPDATE ON acquisition_channel_events
BEGIN SELECT RAISE(ABORT,'acquisition_channel_events_are_immutable'); END;

CREATE TRIGGER trg_acquisition_channel_no_new_both
BEFORE INSERT ON acquisition_channels
WHEN NEW.lead_type='BOTH'
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_both_is_legacy_only');
END;

CREATE TRIGGER trg_acquisition_channel_origin_guard
BEFORE UPDATE ON acquisition_channels
WHEN NOT (
  OLD.status='ACTIVE' AND NEW.status='DISABLED'
  AND NEW.id IS OLD.id AND NEW.code IS OLD.code
  AND NEW.channel_type IS OLD.channel_type
  AND NEW.display_name IS OLD.display_name
  AND NEW.created_by_staff_id IS OLD.created_by_staff_id
  AND NEW.created_at IS OLD.created_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND NEW.disabled_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_invalid_update');
END;

CREATE TRIGGER trg_acquisition_channel_privacy_profile_after_insert
AFTER INSERT ON acquisition_channels
BEGIN
  INSERT INTO acquisition_channel_privacy_profiles (
    channel_id,marketplace_code,lead_type,staff_label,intake_wechat_label,
    version,updated_by_staff_id,created_at,updated_at
  ) VALUES (
    NEW.id,
    NEW.marketplace_code,
    NEW.lead_type,
    '渠道' || (
      1 + (
        SELECT COUNT(*)
        FROM acquisition_channel_privacy_profiles profile
        WHERE profile.marketplace_code=NEW.marketplace_code
          AND profile.lead_type=NEW.lead_type
      )
    ),
    NULL,
    1,
    NEW.created_by_staff_id,
    NEW.created_at,
    NEW.updated_at
  );
END;

CREATE TRIGGER trg_acquisition_channel_privacy_profile_scope_guard
BEFORE UPDATE ON acquisition_channel_privacy_profiles
WHEN NEW.channel_id<>OLD.channel_id
  OR NEW.marketplace_code<>OLD.marketplace_code
  OR NEW.lead_type<>OLD.lead_type
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_privacy_profile_invalid_update');
END;

CREATE TRIGGER trg_acquisition_channel_staff_label_immutable
BEFORE UPDATE OF staff_label ON acquisition_channel_privacy_profiles
WHEN NEW.staff_label<>OLD.staff_label
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_staff_label_is_immutable');
END;

CREATE TRIGGER trg_acquisition_channels_no_delete
BEFORE DELETE ON acquisition_channels
BEGIN SELECT RAISE(ABORT,'acquisition_channels_are_immutable'); END;

CREATE TRIGGER trg_acquisition_consultation_events_no_delete
BEFORE DELETE ON acquisition_daily_consultation_events
BEGIN SELECT RAISE(ABORT,'acquisition_consultation_events_are_immutable'); END;

CREATE TRIGGER trg_acquisition_consultation_events_no_update
BEFORE UPDATE ON acquisition_daily_consultation_events
BEGIN SELECT RAISE(ABORT,'acquisition_consultation_events_are_immutable'); END;

CREATE TRIGGER trg_acquisition_historical_exemptions_no_delete
BEFORE DELETE ON acquisition_historical_source_exemptions
BEGIN SELECT RAISE(ABORT,'acquisition_historical_source_exemptions_are_immutable'); END;

CREATE TRIGGER trg_acquisition_historical_exemptions_no_update
BEFORE UPDATE ON acquisition_historical_source_exemptions
BEGIN SELECT RAISE(ABORT,'acquisition_historical_source_exemptions_are_immutable'); END;

CREATE TRIGGER trg_acquisition_intake_fact_after_lead
AFTER INSERT ON acquisition_leads
BEGIN
  INSERT INTO acquisition_customer_intake_facts(
    id,lead_id,lead_type,marketplace_code,original_channel_id,business_date,
    recorded_at,created_by_staff_id
  ) VALUES(
    'intake-' || lower(hex(randomblob(16))),NEW.id,NEW.lead_type,
    NEW.marketplace_code,NEW.origin_channel_id,NEW.created_business_date,
    NEW.created_at,NEW.origin_staff_id
  );
END;

CREATE TRIGGER trg_acquisition_intake_facts_no_delete
BEFORE DELETE ON acquisition_customer_intake_facts
BEGIN SELECT RAISE(ABORT,'acquisition_customer_intake_facts_are_immutable'); END;

CREATE TRIGGER trg_acquisition_intake_facts_no_update
BEFORE UPDATE ON acquisition_customer_intake_facts
BEGIN SELECT RAISE(ABORT,'acquisition_customer_intake_facts_are_immutable'); END;

CREATE TRIGGER trg_acquisition_lead_events_no_delete
BEFORE DELETE ON acquisition_lead_events
BEGIN SELECT RAISE(ABORT,'acquisition_lead_events_are_immutable'); END;

CREATE TRIGGER trg_acquisition_lead_events_no_update
BEFORE UPDATE ON acquisition_lead_events
BEGIN SELECT RAISE(ABORT,'acquisition_lead_events_are_immutable'); END;

CREATE TRIGGER trg_acquisition_lead_immutable_origin
BEFORE UPDATE ON acquisition_leads
WHEN NEW.id IS NOT OLD.id
  OR NEW.lead_type IS NOT OLD.lead_type
  OR NEW.origin_channel_id IS NOT OLD.origin_channel_id
  OR NEW.origin_staff_id IS NOT OLD.origin_staff_id
  OR NEW.created_business_date IS NOT OLD.created_business_date
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'acquisition_lead_immutable_origin');
END;

CREATE TRIGGER trg_acquisition_lead_link_first_touch_attribution
AFTER INSERT ON acquisition_lead_links
WHEN NEW.link_type IN ('BUYER_CUSTOMER','SELLER_ORGANIZATION')
BEGIN
  INSERT OR IGNORE INTO acquisition_customer_attributions(
    id,subject_type,subject_id,marketplace_code,lead_id,origin_channel_id,
    origin_mode,attributed_at,created_at
  )
  SELECT 'm46-attribution-' || lower(hex(randomblob(16))),
    CASE NEW.link_type
      WHEN 'BUYER_CUSTOMER' THEN 'BUYER_CUSTOMER'
      ELSE 'SELLER_ORGANIZATION'
    END,
    NEW.target_id,
    lead.marketplace_code,
    lead.id,
    lead.origin_channel_id,
    lead.origin_mode,
    NEW.linked_at,
    CAST(unixepoch('now') AS INTEGER)*1000
  FROM acquisition_leads lead
  WHERE lead.id=NEW.lead_id;
END;

CREATE TRIGGER trg_acquisition_lead_links_no_delete
BEFORE DELETE ON acquisition_lead_links
BEGIN SELECT RAISE(ABORT,'acquisition_lead_links_are_immutable'); END;

CREATE TRIGGER trg_acquisition_lead_links_no_update
BEFORE UPDATE ON acquisition_lead_links
BEGIN SELECT RAISE(ABORT,'acquisition_lead_links_are_immutable'); END;

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

CREATE TRIGGER trg_acquisition_lead_prospect_insert_guard
BEFORE INSERT ON acquisition_leads
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

CREATE TRIGGER trg_acquisition_lead_prospect_source_update_guard
BEFORE UPDATE OF prospect_id,lead_type,marketplace_code,origin_channel_id ON acquisition_leads
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

CREATE TRIGGER trg_acquisition_leads_no_delete
BEFORE DELETE ON acquisition_leads
BEGIN SELECT RAISE(ABORT,'acquisition_leads_are_immutable'); END;

CREATE TRIGGER trg_acquisition_reporting_precision_immutable
BEFORE UPDATE OF precision_started_business_date ON acquisition_reporting_config
WHEN OLD.precision_started_business_date IS NOT NULL
  AND NEW.precision_started_business_date<>OLD.precision_started_business_date
BEGIN
  SELECT RAISE(ABORT,'acquisition_reporting_precision_boundary_is_immutable');
END;

CREATE TRIGGER trg_acquisition_role_permission_defaults_no_delete
BEFORE DELETE ON acquisition_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT,'acquisition_role_permission_defaults_are_immutable');
END;

CREATE TRIGGER trg_acquisition_role_permission_defaults_no_update
BEFORE UPDATE ON acquisition_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT,'acquisition_role_permission_defaults_are_immutable');
END;

CREATE TRIGGER trg_acquisition_source_correction_guard
BEFORE INSERT ON acquisition_lead_source_corrections
WHEN NOT EXISTS(
  SELECT 1
  FROM acquisition_leads lead
  JOIN acquisition_channels channel ON channel.id=NEW.new_channel_id
  WHERE lead.id=NEW.lead_id
    AND channel.marketplace_code=lead.marketplace_code
    AND (channel.lead_type=lead.lead_type OR channel.lead_type='BOTH')
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_source_correction_channel_mismatch');
END;

CREATE TRIGGER trg_acquisition_source_corrections_no_delete
BEFORE DELETE ON acquisition_lead_source_corrections
BEGIN SELECT RAISE(ABORT,'acquisition_lead_source_corrections_are_immutable'); END;

CREATE TRIGGER trg_acquisition_source_corrections_no_update
BEFORE UPDATE ON acquisition_lead_source_corrections
BEGIN SELECT RAISE(ABORT,'acquisition_lead_source_corrections_are_immutable'); END;

CREATE TRIGGER trg_buyer_invitation_consumed_link_acquisition_lead
AFTER UPDATE OF status ON customer_buyer_invitations
WHEN NEW.status='CONSUMED' AND OLD.status='ACTIVE'
BEGIN
  INSERT OR IGNORE INTO acquisition_lead_links(
    id,lead_id,link_type,target_id,linked_at
  )
  SELECT 'm50-buyer-link-' || lower(hex(randomblob(16))),
    mapping.acquisition_lead_id,
    'BUYER_CUSTOMER',
    buyer.id,
    COALESCE(NEW.consumed_at,CAST(unixepoch('now') AS INTEGER)*1000)
  FROM customer_buyer_invitation_lead_links mapping
  JOIN customer_login_accounts account ON account.id=NEW.consumed_by_account_id
  JOIN buyer_customers buyer ON buyer.identity_subject_id=account.identity_subject_id
  JOIN acquisition_leads lead ON lead.id=mapping.acquisition_lead_id
  WHERE mapping.invitation_id=NEW.id
    AND lead.lead_type='BUYER'
    AND lead.status='ACTIVE';
END;

INSERT INTO acquisition_maintenance_state (
  singleton_id, lease_token, lease_expires_at, link_claim_cursor, last_started_at, last_succeeded_at, last_failed_at, last_error_code, version, updated_at
) VALUES (
  1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1787661495000
);

INSERT INTO acquisition_reporting_config (
  singleton_id, precision_started_business_date, activated_at, activated_by_staff_id, version, updated_at
) VALUES (
  1, NULL, NULL, NULL, 1, 1787661495000
);

INSERT INTO acquisition_role_permission_defaults (
  role_code, permission_code, created_at
) VALUES (
  'owner', 'ACQUISITION_ADMIN', 1787661495000
);

INSERT INTO acquisition_role_permission_defaults (
  role_code, permission_code, created_at
) VALUES (
  'owner', 'ACQUISITION_BUYER_LEAD', 1787661495000
);

INSERT INTO acquisition_role_permission_defaults (
  role_code, permission_code, created_at
) VALUES (
  'owner', 'ACQUISITION_SELLER_LEAD', 1787661495000
);

INSERT INTO acquisition_role_permission_defaults (
  role_code, permission_code, created_at
) VALUES (
  'pre_sales', 'ACQUISITION_BUYER_LEAD', 1787661495000
);

INSERT INTO acquisition_role_permission_defaults (
  role_code, permission_code, created_at
) VALUES (
  'seller_ops', 'ACQUISITION_SELLER_LEAD', 1787661495000
);

UPDATE app_schema_state
SET
  schema_version=17,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
