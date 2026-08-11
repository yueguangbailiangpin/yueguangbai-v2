PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=52
) THEN 1 ELSE 0 END;

-- 12) Migration 0036 created uq_acquisition_active_identity_per_type, which
-- made active Lead identity globally unique by customer type. Replace that real
-- database authority with type x Marketplace x protected identity.
DROP INDEX uq_acquisition_active_identity_per_type;
CREATE UNIQUE INDEX uq_acquisition_lead_active_identity_market
ON acquisition_leads(lead_type,marketplace_code,identity_hash)
WHERE status='ACTIVE';

-- 6) Re-enabling the only employee for a Role x Marketplace must not leave the
-- scope with zero PRIMARY. If no other active PRIMARY exists, promote the
-- re-enabled employee's existing SUPPORT scope automatically.
CREATE TRIGGER trg_staff_reactivated_restore_primary_scope
AFTER UPDATE OF status ON staff_users
WHEN NEW.status='ACTIVE' AND OLD.status='DISABLED'
BEGIN
  UPDATE staff_marketplace_scopes
  SET scope_kind='PRIMARY',updated_at=MAX(updated_at,CAST(unixepoch('now') AS INTEGER)*1000)
  WHERE staff_id=NEW.id AND status='ACTIVE' AND scope_kind='SUPPORT'
    AND NOT EXISTS(
      SELECT 1 FROM staff_marketplace_scopes primary_scope
      JOIN staff_users primary_staff ON primary_staff.id=primary_scope.staff_id
      WHERE primary_scope.role_code=staff_marketplace_scopes.role_code
        AND primary_scope.marketplace_code=staff_marketplace_scopes.marketplace_code
        AND primary_scope.status='ACTIVE' AND primary_scope.scope_kind='PRIMARY'
        AND primary_staff.status='ACTIVE'
    );
END;

-- 2) Reporting precision is a one-way business boundary. Once activated it may
-- not be silently moved to make historical numbers look better.
CREATE TRIGGER trg_acquisition_reporting_precision_immutable
BEFORE UPDATE OF precision_started_business_date ON acquisition_reporting_config
WHEN OLD.precision_started_business_date IS NOT NULL
  AND NEW.precision_started_business_date<>OLD.precision_started_business_date
BEGIN
  SELECT RAISE(ABORT,'acquisition_reporting_precision_boundary_is_immutable');
END;

-- 8) Keep source-correction safety at the database boundary as well as service
-- validation. Corrections may target a disabled historical channel, but the
-- channel must belong to the same Marketplace and Buyer/Seller audience.
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

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name='uq_acquisition_lead_active_identity_market')
  AND NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name='uq_acquisition_active_identity_per_type')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_staff_reactivated_restore_primary_scope')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_acquisition_reporting_precision_immutable')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_acquisition_source_correction_guard')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=53,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=52;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
