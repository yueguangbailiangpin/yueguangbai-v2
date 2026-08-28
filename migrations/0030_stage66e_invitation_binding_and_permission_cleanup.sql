-- Stage 6.6E (D-056): bind buyer invitations to an existing buyer customer
-- (invited registration may only claim and activate a pre-created profile) and
-- retire the deprecated acquisition permission codes from the runtime
-- permission whitelist. buyer_channels is untouched (business config, not CRM).
-- Forward-only; no production data exists.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=29 THEN 1 ELSE 0 END;

-- ===== customer_buyer_invitations: bind to the pre-created buyer =====
-- Nullable for pre-0030 invitations; runtime registration fails closed on a
-- missing binding instead of creating a second profile.
ALTER TABLE customer_buyer_invitations
  ADD COLUMN buyer_customer_id TEXT REFERENCES buyer_customers(id);

CREATE INDEX idx_customer_buyer_invitations_buyer
ON customer_buyer_invitations (buyer_customer_id, status);

-- ===== staff_permission_overrides: drop the acquisition codes =====
-- The three ACQUISITION_* codes are retired with the acquisition CRM; any
-- surviving rows (none in the clean baseline replay) are deleted and the
-- CHECK whitelist is tightened so they cannot return.
DELETE FROM staff_permission_overrides
WHERE permission_code IN (
  'ACQUISITION_ADMIN','ACQUISITION_BUYER_LEAD','ACQUISITION_SELLER_LEAD'
);

-- The two staff-assignment guards and the effective-permission view read this
-- table; retire them before the rebuild and recreate the identical
-- definitions afterwards (same pattern as migration 0028).
DROP TRIGGER IF EXISTS trg_buyer_staff_assignments_staff_guard;
DROP TRIGGER IF EXISTS trg_seller_staff_assignments_staff_guard;
DROP VIEW IF EXISTS staff_effective_assignment_permissions;

CREATE TABLE "staff_permission_overrides_stage66e_new" (
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  permission_code TEXT NOT NULL CHECK (permission_code IN (
    'TASK_VIEW_OPEN','TASK_CLAIM','TASK_VIEW_TEAM','TASK_REASSIGN_TEAM','TASK_TAKEOVER_TEAM','BUYER_VIEW','BUYER_CREATE','BUYER_ACTIVATE_STANDARD',
    'BUYER_IDENTITY_HIGH_RISK_MANAGE','SELLER_VIEW','SELLER_MANAGE',
    'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
    'RESERVATION_VIEW','RESERVATION_DECIDE','ORDER_VIEW','ORDER_CONFIRM',
    'ORDER_INSTRUCTION_VIEW','ORDER_INSTRUCTION_PUBLISH',
    'ORDER_INSTRUCTION_MANAGE','ORDER_INSTRUCTION_EXPIRY_RUN',
    'REVIEW_VIEW','REVIEW_DECIDE','BUYER_REFUND_VIEW','BUYER_REFUND_RECORD',
    'SELLER_SETTLEMENT_VIEW','SELLER_SETTLEMENT_RECORD',
    'BUYER_SUPPORT_VIEW','BUYER_SUPPORT_NOTE','SELLER_SUPPORT_VIEW',
    'SELLER_SUPPORT_NOTE','FINANCIAL_VIEW','FINANCIAL_CORRECT',
    'FINANCIAL_EXPORT','SCHEDULED_OPERATIONS_RUN','STAFF_MANAGE',
    'PERMISSION_MANAGE','AUDIT_VIEW','ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
    'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND','ASSIGNMENT_AVAILABILITY_MANAGE'
  )),
  effect TEXT NOT NULL CHECK (effect IN ('GRANT','DENY')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  reason TEXT CHECK (reason IS NULL OR length(reason)<=1000),
  assigned_by_staff_id TEXT REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL CHECK (assigned_at>=0),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  PRIMARY KEY (staff_id,permission_code),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;
INSERT INTO staff_permission_overrides_stage66e_new (
  staff_id, permission_code, effect, status, reason, assigned_by_staff_id,
  assigned_at, revoked_at, created_at, updated_at
)
SELECT staff_id, permission_code, effect, status, reason, assigned_by_staff_id,
  assigned_at, revoked_at, created_at, updated_at
FROM staff_permission_overrides;
DROP TABLE staff_permission_overrides;
ALTER TABLE staff_permission_overrides_stage66e_new
  RENAME TO staff_permission_overrides;

CREATE INDEX idx_staff_permission_override_effect_status
ON staff_permission_overrides(effect,status,permission_code,staff_id);

CREATE TRIGGER trg_staff_permission_override_deny_only_insert
BEFORE INSERT ON staff_permission_overrides
WHEN NEW.status='ACTIVE' AND NEW.effect='GRANT'
BEGIN
  SELECT RAISE(ABORT,'staff_permission_active_grant_forbidden');
END;

CREATE TRIGGER trg_staff_permission_override_deny_only_update
BEFORE UPDATE ON staff_permission_overrides
WHEN NEW.status='ACTIVE' AND NEW.effect='GRANT'
BEGIN
  SELECT RAISE(ABORT,'staff_permission_active_grant_forbidden');
END;

CREATE VIEW staff_effective_assignment_permissions AS
WITH role_permissions AS (
  SELECT assignment.staff_id, defaults.permission_code
  FROM staff_role_assignments assignment
  JOIN staff_assignment_role_permission_defaults defaults
    ON defaults.role_code=assignment.role_code
  WHERE assignment.status='ACTIVE'
)
SELECT role_permissions.staff_id, role_permissions.permission_code
FROM role_permissions
WHERE NOT EXISTS (
  SELECT 1 FROM staff_permission_overrides denied
  WHERE denied.staff_id=role_permissions.staff_id
    AND denied.permission_code=role_permissions.permission_code
    AND denied.status='ACTIVE' AND denied.effect='DENY'
);

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
        AND scope.marketplace_code=organization.marketplace_code)
    )
    AND 4=(
      SELECT COUNT(DISTINCT required.permission_code)
      FROM staff_effective_assignment_permissions required
      WHERE required.staff_id=staff.id AND required.permission_code IN (
        'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH'))
)
BEGIN SELECT RAISE(ABORT,'seller_staff_assignment_target_ineligible'); END;

-- ===== no runtime acquisition permission rows remain =====
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM staff_permission_overrides
  WHERE permission_code IN (
    'ACQUISITION_ADMIN','ACQUISITION_BUYER_LEAD','ACQUISITION_SELLER_LEAD'
  )
) THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET
  schema_version=30,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=29;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=30 THEN 1 ELSE 0 END;
