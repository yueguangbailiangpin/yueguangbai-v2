PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=58
) THEN 1 ELSE 0 END;

CREATE TABLE seller_member_portal_store_grants (
  member_id TEXT NOT NULL REFERENCES seller_organization_members(id),
  organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL REFERENCES seller_stores(id),
  granted_by_member_id TEXT NOT NULL REFERENCES seller_organization_members(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  revoked_at INTEGER,
  PRIMARY KEY(member_id,store_id),
  CHECK (revoked_at IS NULL OR revoked_at>=created_at)
) STRICT;
CREATE INDEX idx_seller_member_portal_grant_org
ON seller_member_portal_store_grants(organization_id,member_id,revoked_at,store_id);
CREATE TRIGGER trg_seller_member_portal_grant_no_update
BEFORE UPDATE ON seller_member_portal_store_grants
WHEN NOT (
  NEW.member_id IS OLD.member_id AND NEW.organization_id IS OLD.organization_id
  AND NEW.store_id IS OLD.store_id AND NEW.granted_by_member_id IS OLD.granted_by_member_id
  AND NEW.created_at IS OLD.created_at AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
  AND NEW.revoked_at>=OLD.created_at
)
BEGIN SELECT RAISE(ABORT,'seller_member_portal_grant_invalid_update'); END;
CREATE TRIGGER trg_seller_member_portal_grant_no_delete
BEFORE DELETE ON seller_member_portal_store_grants
BEGIN SELECT RAISE(ABORT,'seller_member_portal_grants_are_immutable'); END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM sqlite_schema WHERE type='table' AND name='seller_member_portal_store_grants'
) THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=59,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=58;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
