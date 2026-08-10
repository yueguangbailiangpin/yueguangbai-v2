PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=44
) THEN 1 ELSE 0 END;

-- Small-team rule: one active primary employee per Role x Marketplace.
-- Owner has no scope rows and is therefore excluded naturally.
CREATE UNIQUE INDEX uq_staff_marketplace_role_primary
ON staff_marketplace_scopes(role_code,marketplace_code)
WHERE status='ACTIVE';

-- Service validation already checks Prospect source inheritance. Keep the same
-- rule at the database boundary for both INSERT and later source-field edits.
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

-- Reserved durable attribution record.  It lets downstream Customer/Order
-- reporting keep one immutable first-touch source even after acquisition UI
-- grows more sophisticated.  Maintenance can populate it when a Lead becomes
-- linked to a formal Buyer Customer or Seller Organization.
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
CREATE INDEX idx_acquisition_customer_attribution_channel
ON acquisition_customer_attributions(origin_channel_id,marketplace_code,attributed_at,subject_type,subject_id);

-- Backfill any formal customers already linked by the existing Acquisition
-- maintenance job.  INSERT OR IGNORE preserves first attribution if duplicates
-- are present in historical links.
INSERT OR IGNORE INTO acquisition_customer_attributions(
  id,subject_type,subject_id,marketplace_code,lead_id,origin_channel_id,origin_mode,attributed_at,created_at
)
SELECT 'm45-attribution-' || lower(hex(randomblob(16))),
  CASE link.link_type WHEN 'BUYER_CUSTOMER' THEN 'BUYER_CUSTOMER' ELSE 'SELLER_ORGANIZATION' END,
  link.target_id,lead.marketplace_code,lead.id,lead.origin_channel_id,lead.origin_mode,
  link.linked_at,CAST(unixepoch('now') AS INTEGER)*1000
FROM acquisition_lead_links link
JOIN acquisition_leads lead ON lead.id=link.lead_id
WHERE link.link_type IN ('BUYER_CUSTOMER','SELLER_ORGANIZATION')
ORDER BY link.linked_at,link.id;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM sqlite_schema WHERE type='index' AND name='uq_staff_marketplace_role_primary')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_customer_attributions')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_acquisition_lead_prospect_insert_guard')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=45,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=44;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
