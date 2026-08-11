PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=45
) THEN 1 ELSE 0 END;

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

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type='trigger' AND name='trg_acquisition_lead_link_first_touch_attribution'
) THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=46,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=45;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
