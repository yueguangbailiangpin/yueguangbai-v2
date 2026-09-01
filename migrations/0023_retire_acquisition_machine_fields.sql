-- Stage 4 (D-054): acquisition machine-era field removal (inventory §3.1).
-- Sequenced after the three-part marketplace unification (0020-0022).
-- Drops the machine attribution reporting config, the Codex/HUMAN origin_mode
-- discriminator and the machine ai_score from the manual acquisition model.
-- Manual facts (channels, prospects, leads, consultations, source corrections,
-- intake facts, privacy profiles) remain the retained manual funnel.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=22 THEN 1 ELSE 0 END;
DROP TRIGGER IF EXISTS trg_acquisition_lead_link_first_touch_attribution;
DROP TRIGGER IF EXISTS trg_acquisition_source_correction_guard;
DROP TRIGGER IF EXISTS trg_buyer_invitation_consumed_link_acquisition_lead;
DROP TRIGGER IF EXISTS trg_acquisition_intake_fact_after_lead;
DROP TRIGGER IF EXISTS trg_acquisition_lead_immutable_origin;
DROP TRIGGER IF EXISTS trg_acquisition_lead_prospect_guard;
DROP TRIGGER IF EXISTS trg_acquisition_lead_prospect_insert_guard;
DROP TRIGGER IF EXISTS trg_acquisition_lead_prospect_source_update_guard;
DROP TRIGGER IF EXISTS trg_acquisition_leads_no_delete;

CREATE TABLE acquisition_prospects_stage4b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  origin_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  contact_value TEXT CHECK (contact_value IS NULL OR length(contact_value)<=320),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url)<=2000),
  status TEXT NOT NULL CHECK (status IN (
    'NEW','RESEARCHING','QUALIFIED','READY_CONTACT','CONTACTED',
    'HUMAN_HANDOFF','CONVERTED','LOST'
  )),
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
INSERT INTO acquisition_prospects_stage4b_new (id, lead_type, marketplace_code, origin_channel_id, display_name, contact_value, source_url, status, note, created_by_actor_type, created_by_actor_id, discovered_at, converted_lead_id, version, created_at, updated_at)
SELECT id, lead_type, marketplace_code, origin_channel_id, display_name, contact_value, source_url, status, note, created_by_actor_type, created_by_actor_id, discovered_at, converted_lead_id, version, created_at, updated_at
FROM acquisition_prospects;
DROP TABLE acquisition_prospects;
ALTER TABLE acquisition_prospects_stage4b_new RENAME TO acquisition_prospects;
CREATE INDEX idx_acquisition_prospect_channel
ON acquisition_prospects(origin_channel_id,discovered_at,id);
CREATE INDEX idx_acquisition_prospect_queue
ON acquisition_prospects(lead_type,marketplace_code,status,discovered_at,id);

CREATE TABLE acquisition_leads_stage4b_new (
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
    'AMAZON_JP','AMAZON_US','COUPANG_KR'
  )), prospect_id TEXT, origin_source_url TEXT
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
INSERT INTO acquisition_leads_stage4b_new (id, lead_type, identity_hash, identity_ciphertext, identity_iv, wechat_masked, display_name, note, origin_channel_id, origin_staff_id, current_owner_staff_id, status, invalidation_reason, retention_hold_reason, version, created_business_date, latest_followup_at, retention_due_at, created_at, updated_at, invalidated_at, anonymized_at, marketplace_code, prospect_id, origin_source_url)
SELECT id, lead_type, identity_hash, identity_ciphertext, identity_iv, wechat_masked, display_name, note, origin_channel_id, origin_staff_id, current_owner_staff_id, status, invalidation_reason, retention_hold_reason, version, created_business_date, latest_followup_at, retention_due_at, created_at, updated_at, invalidated_at, anonymized_at, marketplace_code, prospect_id, origin_source_url
FROM acquisition_leads;
DROP TABLE acquisition_leads;
ALTER TABLE acquisition_leads_stage4b_new RENAME TO acquisition_leads;
CREATE INDEX idx_acquisition_lead_identity_market
ON acquisition_leads(lead_type,marketplace_code,identity_hash,status,created_at,id);
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
CREATE UNIQUE INDEX uq_acquisition_lead_active_identity_market
ON acquisition_leads(lead_type,marketplace_code,identity_hash)
WHERE status='ACTIVE';

CREATE TABLE acquisition_customer_attributions_stage4b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('BUYER_CUSTOMER','SELLER_ORGANIZATION')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  lead_id TEXT NOT NULL REFERENCES acquisition_leads(id),
  origin_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  attributed_at INTEGER NOT NULL CHECK (attributed_at>=0),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  UNIQUE(subject_type,subject_id,marketplace_code)
) STRICT;
INSERT INTO acquisition_customer_attributions_stage4b_new (id, subject_type, subject_id, marketplace_code, lead_id, origin_channel_id, attributed_at, created_at)
SELECT id, subject_type, subject_id, marketplace_code, lead_id, origin_channel_id, attributed_at, created_at
FROM acquisition_customer_attributions;
DROP TABLE acquisition_customer_attributions;
ALTER TABLE acquisition_customer_attributions_stage4b_new RENAME TO acquisition_customer_attributions;
CREATE INDEX idx_acquisition_customer_attribution_channel
ON acquisition_customer_attributions(origin_channel_id,marketplace_code,attributed_at,subject_type,subject_id);

DROP TABLE acquisition_reporting_config;
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
CREATE TRIGGER trg_acquisition_lead_link_first_touch_attribution
AFTER INSERT ON acquisition_lead_links
WHEN NEW.link_type IN ('BUYER_CUSTOMER','SELLER_ORGANIZATION')
BEGIN
  INSERT OR IGNORE INTO acquisition_customer_attributions(
    id,subject_type,subject_id,marketplace_code,lead_id,origin_channel_id,
    attributed_at,created_at
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
    NEW.linked_at,
    CAST(unixepoch('now') AS INTEGER)*1000
  FROM acquisition_leads lead
  WHERE lead.id=NEW.lead_id;
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

UPDATE app_schema_state
SET
  schema_version=23,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
