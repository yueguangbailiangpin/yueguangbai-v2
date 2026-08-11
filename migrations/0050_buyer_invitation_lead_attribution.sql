PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=49
) THEN 1 ELSE 0 END;

CREATE TABLE customer_buyer_invitation_lead_links (
  invitation_id TEXT PRIMARY KEY REFERENCES customer_buyer_invitations(id),
  acquisition_lead_id TEXT NOT NULL UNIQUE REFERENCES acquisition_leads(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

-- The account is created before the invitation is consumed in the existing
-- buyer registration transaction. Therefore this trigger can resolve the
-- existing/new Buyer Customer through the consumed account identity and link
-- it to the exact Lead that created the invitation.
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

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_buyer_invitation_lead_links')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_buyer_invitation_consumed_link_acquisition_lead')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=50,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=49;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
