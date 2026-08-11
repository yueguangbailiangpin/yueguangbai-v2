PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=50
) THEN 1 ELSE 0 END;

-- 1) A successful customer intake is an immutable business fact. Later Lead
-- invalidation/anonymization must never rewrite historical new-customer counts.
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
CREATE INDEX idx_acquisition_intake_fact_date
ON acquisition_customer_intake_facts(business_date,lead_type,marketplace_code,lead_id);
CREATE INDEX idx_acquisition_intake_fact_channel
ON acquisition_customer_intake_facts(original_channel_id,business_date,lead_type,lead_id);

INSERT INTO acquisition_customer_intake_facts(
  id,lead_id,lead_type,marketplace_code,original_channel_id,business_date,
  recorded_at,created_by_staff_id
)
SELECT 'm51-intake-' || lower(hex(randomblob(16))),id,lead_type,
  marketplace_code,origin_channel_id,created_business_date,created_at,origin_staff_id
FROM acquisition_leads;

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
CREATE TRIGGER trg_acquisition_intake_facts_no_update
BEFORE UPDATE ON acquisition_customer_intake_facts
BEGIN SELECT RAISE(ABORT,'acquisition_customer_intake_facts_are_immutable'); END;
CREATE TRIGGER trg_acquisition_intake_facts_no_delete
BEFORE DELETE ON acquisition_customer_intake_facts
BEGIN SELECT RAISE(ABORT,'acquisition_customer_intake_facts_are_immutable'); END;

-- 2) One explicit reporting precision boundary separates expected historical
-- unknown source from a new-system attribution defect. Activation logic later
-- snapshots only still-unattributed existing subjects as historical exemptions.
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
INSERT INTO acquisition_reporting_config(
  singleton_id,precision_started_business_date,activated_at,
  activated_by_staff_id,version,updated_at
) VALUES(1,NULL,NULL,NULL,1,CAST(unixepoch('now') AS INTEGER)*1000);

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
CREATE INDEX idx_acquisition_historical_exemption_market
ON acquisition_historical_source_exemptions(marketplace_code,subject_type,subject_id);
CREATE TRIGGER trg_acquisition_historical_exemptions_no_update
BEFORE UPDATE ON acquisition_historical_source_exemptions
BEGIN SELECT RAISE(ABORT,'acquisition_historical_source_exemptions_are_immutable'); END;
CREATE TRIGGER trg_acquisition_historical_exemptions_no_delete
BEFORE DELETE ON acquisition_historical_source_exemptions
BEGIN SELECT RAISE(ABORT,'acquisition_historical_source_exemptions_are_immutable'); END;

-- 8) Source corrections are append-only. The Lead's original source remains an
-- audit fact; reporting resolves the newest correction as the effective source.
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
CREATE INDEX idx_acquisition_source_correction_lead
ON acquisition_lead_source_corrections(lead_id,corrected_at DESC,id DESC);
CREATE TRIGGER trg_acquisition_source_corrections_no_update
BEFORE UPDATE ON acquisition_lead_source_corrections
BEGIN SELECT RAISE(ABORT,'acquisition_lead_source_corrections_are_immutable'); END;
CREATE TRIGGER trg_acquisition_source_corrections_no_delete
BEFORE DELETE ON acquisition_lead_source_corrections
BEGIN SELECT RAISE(ABORT,'acquisition_lead_source_corrections_are_immutable'); END;

-- 6) Multiple employees may cover one Role x Marketplace. Exactly one active
-- PRIMARY is kept; other active employees are SUPPORT. Existing staff remain
-- PRIMARY so current behavior remains unchanged during migration.
ALTER TABLE staff_marketplace_scopes ADD COLUMN scope_kind TEXT NOT NULL
  DEFAULT 'PRIMARY' CHECK (scope_kind IN ('PRIMARY','SUPPORT'));
DROP INDEX uq_staff_marketplace_role_primary;
CREATE UNIQUE INDEX uq_staff_marketplace_role_primary
ON staff_marketplace_scopes(role_code,marketplace_code)
WHERE status='ACTIVE' AND scope_kind='PRIMARY';
CREATE INDEX idx_staff_marketplace_scope_support
ON staff_marketplace_scopes(role_code,marketplace_code,scope_kind,status,staff_id);

-- Assignment authority is Role x Marketplace PRIMARY. Historical Team and
-- Availability records remain readable audit facts but cannot affect routing.
DROP TRIGGER trg_buyer_staff_assignments_staff_guard;
DROP TRIGGER trg_seller_staff_assignments_staff_guard;
DROP TRIGGER trg_staff_assignment_fallbacks_insert_guard;
DROP TRIGGER trg_staff_assignment_fallbacks_update_guard;

CREATE TRIGGER trg_buyer_staff_assignments_staff_guard
BEFORE INSERT ON buyer_staff_assignments
WHEN NOT EXISTS (
  SELECT 1
  FROM staff_users staff
  JOIN buyer_marketplace_assignments market
    ON market.buyer_customer_id=NEW.buyer_customer_id
  JOIN staff_effective_assignment_permissions permission
    ON permission.staff_id=staff.id
    AND permission.permission_code=CASE NEW.duty_code
      WHEN 'BUYER_PRE_SALES_OWNER' THEN 'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES'
      WHEN 'BUYER_AFTER_SALES_OWNER' THEN 'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES'
      WHEN 'BUYER_REFUND_OWNER' THEN 'ASSIGNMENT_ELIGIBLE_BUYER_REFUND'
    END
  WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
    AND (
      EXISTS (SELECT 1 FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE'
          AND role.role_code='owner')
      OR EXISTS (SELECT 1 FROM staff_marketplace_scopes scope
        WHERE scope.staff_id=staff.id AND scope.status='ACTIVE'
          AND scope.scope_kind='PRIMARY'
          AND scope.marketplace_code=market.marketplace_code)
    )
    AND (
      (NEW.duty_code='BUYER_PRE_SALES_OWNER' AND 5=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id AND required.permission_code IN (
          'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
          'ORDER_VIEW','ORDER_CONFIRM')))
      OR (NEW.duty_code='BUYER_AFTER_SALES_OWNER' AND 3=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id AND required.permission_code IN (
          'BUYER_VIEW','REVIEW_VIEW','REVIEW_DECIDE')))
      OR (NEW.duty_code='BUYER_REFUND_OWNER' AND 3=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id AND required.permission_code IN (
          'BUYER_VIEW','BUYER_REFUND_VIEW','BUYER_REFUND_RECORD')))
    )
)
BEGIN SELECT RAISE(ABORT,'buyer_staff_assignment_target_ineligible'); END;

CREATE TRIGGER trg_seller_staff_assignments_staff_guard
BEFORE INSERT ON seller_staff_assignments
WHEN NOT EXISTS (
  SELECT 1
  FROM staff_users staff
  JOIN seller_organizations organization
    ON organization.id=NEW.seller_organization_id
  LEFT JOIN marketplace_legacy_aliases alias
    ON alias.legacy_code=organization.marketplace_code
  JOIN staff_effective_assignment_permissions permission
    ON permission.staff_id=staff.id
    AND permission.permission_code='ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT'
  WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
    AND (
      EXISTS (SELECT 1 FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE'
          AND role.role_code='owner')
      OR EXISTS (SELECT 1 FROM staff_marketplace_scopes scope
        WHERE scope.staff_id=staff.id AND scope.status='ACTIVE'
          AND scope.scope_kind='PRIMARY'
          AND scope.marketplace_code=COALESCE(
            alias.marketplace_code,organization.marketplace_code))
    )
    AND 4=(
      SELECT COUNT(DISTINCT required.permission_code)
      FROM staff_effective_assignment_permissions required
      WHERE required.staff_id=staff.id AND required.permission_code IN (
        'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH'))
)
BEGIN SELECT RAISE(ABORT,'seller_staff_assignment_target_ineligible'); END;

CREATE TRIGGER trg_staff_assignment_fallbacks_insert_guard
BEFORE INSERT ON staff_assignment_fallbacks
WHEN NOT EXISTS (
  SELECT 1 FROM staff_users staff
  WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
    AND EXISTS (SELECT 1 FROM staff_role_assignments role
      WHERE role.staff_id=staff.id AND role.role_code='owner'
        AND role.status='ACTIVE')
    AND 17=(SELECT COUNT(DISTINCT permission.permission_code)
      FROM staff_effective_assignment_permissions permission
      WHERE permission.staff_id=staff.id AND permission.permission_code IN (
        'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
        'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
        'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
        'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
        'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
        'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
        'ORDER_VIEW','ORDER_CONFIRM','REVIEW_VIEW','REVIEW_DECIDE',
        'BUYER_REFUND_VIEW','BUYER_REFUND_RECORD'))
)
BEGIN SELECT RAISE(ABORT,'staff_assignment_fallback_invalid'); END;

CREATE TRIGGER trg_staff_assignment_fallbacks_update_guard
BEFORE UPDATE ON staff_assignment_fallbacks
WHEN NOT (
  NEW.marketplace_code IS OLD.marketplace_code
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND EXISTS (
    SELECT 1 FROM staff_users staff
    WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
      AND EXISTS (SELECT 1 FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.role_code='owner'
          AND role.status='ACTIVE')
      AND 17=(SELECT COUNT(DISTINCT permission.permission_code)
        FROM staff_effective_assignment_permissions permission
        WHERE permission.staff_id=staff.id AND permission.permission_code IN (
          'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
          'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
          'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
          'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
          'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
          'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
          'ORDER_VIEW','ORDER_CONFIRM','REVIEW_VIEW','REVIEW_DECIDE',
          'BUYER_REFUND_VIEW','BUYER_REFUND_RECORD'))
  )
)
BEGIN SELECT RAISE(ABORT,'staff_assignment_fallback_invalid'); END;

-- 12) Prepare a global Seller-customer identity above marketplace-specific
-- Seller Organizations. Current JP business remains unchanged; future US/KR
-- organizations can join the same global group without rewriting orders.
-- The group id bound is deliberately wider than current UUID ids because
-- historical organization ids may be longer and this migration prefixes them.
CREATE TABLE seller_customer_groups (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 240),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at)
) STRICT;
CREATE TABLE seller_customer_group_marketplaces (
  seller_customer_group_id TEXT NOT NULL REFERENCES seller_customer_groups(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  seller_organization_id TEXT NOT NULL UNIQUE REFERENCES seller_organizations(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY(seller_customer_group_id,marketplace_code)
) STRICT;
INSERT INTO seller_customer_groups(id,canonical_name,status,created_at,updated_at)
SELECT 'm51-group-' || id,organization_name,status,created_at,updated_at
FROM seller_organizations;
INSERT INTO seller_customer_group_marketplaces(
  seller_customer_group_id,marketplace_code,seller_organization_id,created_at
)
SELECT 'm51-group-' || id,
  CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END,
  id,created_at
FROM seller_organizations;
CREATE TRIGGER trg_seller_customer_group_after_org
AFTER INSERT ON seller_organizations
BEGIN
  INSERT INTO seller_customer_groups(id,canonical_name,status,created_at,updated_at)
  VALUES('seller-group-' || NEW.id,NEW.organization_name,NEW.status,NEW.created_at,NEW.updated_at);
  INSERT INTO seller_customer_group_marketplaces(
    seller_customer_group_id,marketplace_code,seller_organization_id,created_at
  ) VALUES(
    'seller-group-' || NEW.id,
    CASE NEW.marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE NEW.marketplace_code END,
    NEW.id,NEW.created_at
  );
END;

CREATE INDEX idx_acquisition_lead_identity_market
ON acquisition_leads(lead_type,marketplace_code,identity_hash,status,created_at,id);

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_customer_intake_facts')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_reporting_config')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='acquisition_lead_source_corrections')
  AND EXISTS(SELECT 1 FROM pragma_table_info('staff_marketplace_scopes') WHERE name='scope_kind')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='seller_customer_groups')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=51,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=50;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
