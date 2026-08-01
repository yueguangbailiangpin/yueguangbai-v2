PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Wave 9 / Phase 3H: staff availability, fixed assignments, direct work items,
-- deterministic round-robin, explicit owner fallback, reassignment batches,
-- and immutable assignment/work-item events.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=19
) THEN 1 ELSE 0 END;

-- The permission override table owns a CHECK enumeration, so it must be rebuilt
-- to publish the six Phase 3H permissions while preserving every historical
-- GRANT/DENY row and the original index.
CREATE TABLE phase3h_backup_staff_permission_overrides AS
SELECT * FROM staff_permission_overrides;

DROP TABLE staff_permission_overrides;

CREATE TABLE staff_permission_overrides (
  staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  permission_code TEXT NOT NULL
    CHECK (permission_code IN (
      'TASK_VIEW_OPEN',
      'TASK_CLAIM',
      'TASK_VIEW_TEAM',
      'TASK_ASSIGN_TEAM',
      'TASK_REASSIGN_TEAM',
      'TASK_TAKEOVER_TEAM',
      'TASK_COLLABORATE_TEAM',
      'BUYER_VIEW',
      'BUYER_CREATE',
      'BUYER_ACTIVATE_STANDARD',
      'BUYER_IDENTITY_HIGH_RISK_MANAGE',
      'SELLER_VIEW',
      'SELLER_MANAGE',
      'PRODUCT_VIEW',
      'PRODUCT_REVIEW',
      'DEMAND_VIEW',
      'DEMAND_PUBLISH',
      'RESERVATION_VIEW',
      'RESERVATION_DECIDE',
      'ORDER_VIEW',
      'ORDER_CONFIRM',
      'REVIEW_VIEW',
      'REVIEW_DECIDE',
      'BUYER_REFUND_VIEW',
      'BUYER_REFUND_RECORD',
      'SELLER_SETTLEMENT_VIEW',
      'SELLER_SETTLEMENT_RECORD',
      'BUYER_SUPPORT_VIEW',
      'BUYER_SUPPORT_NOTE',
      'SELLER_SUPPORT_VIEW',
      'SELLER_SUPPORT_NOTE',
      'FINANCIAL_CORRECT',
      'FINANCIAL_EXPORT',
      'STAFF_MANAGE',
      'PERMISSION_MANAGE',
      'AUDIT_VIEW',
      'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
      'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
      'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
      'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
      'ASSIGNMENT_BATCH_TRANSFER',
      'ASSIGNMENT_AVAILABILITY_MANAGE'
    )),
  effect TEXT NOT NULL
    CHECK (effect IN ('GRANT', 'DENY')),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  reason TEXT
    CHECK (reason IS NULL OR length(reason) <= 1000),
  assigned_by_staff_id TEXT
    REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL
    CHECK (assigned_at >= 0),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  PRIMARY KEY (staff_id, permission_code),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

INSERT INTO staff_permission_overrides (
  staff_id, permission_code, effect, status, reason,
  assigned_by_staff_id, assigned_at, revoked_at,
  created_at, updated_at
)
SELECT
  staff_id, permission_code, effect, status, reason,
  assigned_by_staff_id, assigned_at, revoked_at,
  created_at, updated_at
FROM phase3h_backup_staff_permission_overrides;

CREATE INDEX idx_staff_permission_override_effect_status
ON staff_permission_overrides (
  effect,
  status,
  permission_code,
  staff_id
);

DROP TABLE phase3h_backup_staff_permission_overrides;

-- Canonical persisted projection of role defaults used by assignment
-- candidate selection. This mirrors the published Staff authorization policy,
-- then applies personal GRANT/DENY in SQL so round-robin does not select a
-- candidate in JavaScript or hard-code role names in candidate queries.
CREATE TABLE staff_assignment_role_permission_defaults (
  role_code TEXT NOT NULL
    CHECK (role_code IN (
      'owner', 'pre_sales', 'seller_ops',
      'seller_support', 'after_sales', 'buyer_support'
    )),
  permission_code TEXT NOT NULL
    CHECK (permission_code IN (
      'TASK_VIEW_OPEN',
      'TASK_CLAIM',
      'TASK_VIEW_TEAM',
      'TASK_ASSIGN_TEAM',
      'TASK_REASSIGN_TEAM',
      'TASK_TAKEOVER_TEAM',
      'TASK_COLLABORATE_TEAM',
      'BUYER_VIEW',
      'BUYER_CREATE',
      'BUYER_ACTIVATE_STANDARD',
      'BUYER_IDENTITY_HIGH_RISK_MANAGE',
      'SELLER_VIEW',
      'SELLER_MANAGE',
      'PRODUCT_VIEW',
      'PRODUCT_REVIEW',
      'DEMAND_VIEW',
      'DEMAND_PUBLISH',
      'RESERVATION_VIEW',
      'RESERVATION_DECIDE',
      'ORDER_VIEW',
      'ORDER_CONFIRM',
      'REVIEW_VIEW',
      'REVIEW_DECIDE',
      'BUYER_REFUND_VIEW',
      'BUYER_REFUND_RECORD',
      'SELLER_SETTLEMENT_VIEW',
      'SELLER_SETTLEMENT_RECORD',
      'BUYER_SUPPORT_VIEW',
      'BUYER_SUPPORT_NOTE',
      'SELLER_SUPPORT_VIEW',
      'SELLER_SUPPORT_NOTE',
      'FINANCIAL_CORRECT',
      'FINANCIAL_EXPORT',
      'STAFF_MANAGE',
      'PERMISSION_MANAGE',
      'AUDIT_VIEW',
      'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
      'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
      'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
      'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
      'ASSIGNMENT_BATCH_TRANSFER',
      'ASSIGNMENT_AVAILABILITY_MANAGE'
    )),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (role_code, permission_code)
) STRICT;

INSERT INTO staff_assignment_role_permission_defaults (
  role_code, permission_code, created_at
) VALUES
  ('owner', 'TASK_VIEW_OPEN', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'TASK_CLAIM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'TASK_VIEW_TEAM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'TASK_ASSIGN_TEAM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'TASK_REASSIGN_TEAM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'TASK_TAKEOVER_TEAM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'TASK_COLLABORATE_TEAM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'BUYER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'BUYER_CREATE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'BUYER_ACTIVATE_STANDARD', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'BUYER_IDENTITY_HIGH_RISK_MANAGE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'SELLER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'SELLER_MANAGE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'PRODUCT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'PRODUCT_REVIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'DEMAND_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'DEMAND_PUBLISH', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'RESERVATION_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'RESERVATION_DECIDE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'ORDER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'ORDER_CONFIRM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'REVIEW_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'REVIEW_DECIDE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'BUYER_REFUND_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'BUYER_REFUND_RECORD', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'SELLER_SETTLEMENT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'SELLER_SETTLEMENT_RECORD', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'BUYER_SUPPORT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'BUYER_SUPPORT_NOTE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'SELLER_SUPPORT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'SELLER_SUPPORT_NOTE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'FINANCIAL_CORRECT', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'FINANCIAL_EXPORT', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'STAFF_MANAGE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'PERMISSION_MANAGE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'AUDIT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'ASSIGNMENT_ELIGIBLE_BUYER_REFUND', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'ASSIGNMENT_BATCH_TRANSFER', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('owner', 'ASSIGNMENT_AVAILABILITY_MANAGE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'TASK_VIEW_OPEN', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'TASK_CLAIM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'BUYER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'BUYER_CREATE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'BUYER_ACTIVATE_STANDARD', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'PRODUCT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'DEMAND_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'RESERVATION_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'RESERVATION_DECIDE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'ORDER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'ORDER_CONFIRM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('pre_sales', 'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'TASK_VIEW_OPEN', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'TASK_CLAIM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'SELLER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'SELLER_MANAGE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'PRODUCT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'PRODUCT_REVIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'DEMAND_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'DEMAND_PUBLISH', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'ORDER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'SELLER_SETTLEMENT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'SELLER_SETTLEMENT_RECORD', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_ops', 'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_support', 'TASK_VIEW_OPEN', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_support', 'TASK_CLAIM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_support', 'SELLER_SUPPORT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_support', 'SELLER_SUPPORT_NOTE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_support', 'PRODUCT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_support', 'DEMAND_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_support', 'ORDER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('seller_support', 'SELLER_SETTLEMENT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'TASK_VIEW_OPEN', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'TASK_CLAIM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'BUYER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'ORDER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'REVIEW_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'REVIEW_DECIDE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'BUYER_REFUND_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'BUYER_REFUND_RECORD', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('after_sales', 'ASSIGNMENT_ELIGIBLE_BUYER_REFUND', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('buyer_support', 'TASK_VIEW_OPEN', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('buyer_support', 'TASK_CLAIM', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('buyer_support', 'BUYER_SUPPORT_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('buyer_support', 'BUYER_SUPPORT_NOTE', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('buyer_support', 'BUYER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('buyer_support', 'ORDER_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('buyer_support', 'REVIEW_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000),
  ('buyer_support', 'BUYER_REFUND_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000);

CREATE TRIGGER trg_staff_assignment_role_permission_defaults_no_update
BEFORE UPDATE ON staff_assignment_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT, 'staff_assignment_role_permission_defaults_are_immutable');
END;

CREATE TRIGGER trg_staff_assignment_role_permission_defaults_no_delete
BEFORE DELETE ON staff_assignment_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT, 'staff_assignment_role_permission_defaults_are_immutable');
END;

CREATE VIEW staff_effective_assignment_permissions AS
WITH role_permissions AS (
  SELECT assignment.staff_id, defaults.permission_code
  FROM staff_role_assignments assignment
  JOIN staff_assignment_role_permission_defaults defaults
    ON defaults.role_code=assignment.role_code
  WHERE assignment.status='ACTIVE'
),
explicit_grants AS (
  SELECT staff_id, permission_code
  FROM staff_permission_overrides
  WHERE status='ACTIVE'
    AND effect='GRANT'
),
combined AS (
  SELECT staff_id, permission_code FROM role_permissions
  UNION
  SELECT staff_id, permission_code FROM explicit_grants
)
SELECT combined.staff_id, combined.permission_code
FROM combined
WHERE NOT EXISTS (
  SELECT 1
  FROM staff_permission_overrides denied
  WHERE denied.staff_id=combined.staff_id
    AND denied.permission_code=combined.permission_code
    AND denied.status='ACTIVE'
    AND denied.effect='DENY'
);

CREATE TABLE staff_availability (
  staff_id TEXT PRIMARY KEY
    REFERENCES staff_users(id),
  availability_status TEXT NOT NULL
    CHECK (availability_status IN ('AVAILABLE', 'UNAVAILABLE')),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  changed_by_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_staff_availability_status
ON staff_availability (availability_status, staff_id);

CREATE TABLE buyer_staff_assignments (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER',
    'BUYER_REFUND_OWNER'
  )),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  source TEXT NOT NULL CHECK (source IN (
    'AUTO_INITIAL', 'AUTO_REPLACEMENT', 'OWNER_FALLBACK',
    'MANUAL_REASSIGN', 'BATCH_TRANSFER'
  )),
  assigned_by_actor_type TEXT NOT NULL
    CHECK (assigned_by_actor_type IN ('STAFF', 'SYSTEM')),
  assigned_by_actor_id TEXT
    CHECK (
      (assigned_by_actor_type='STAFF'
        AND assigned_by_actor_id IS NOT NULL
        AND length(assigned_by_actor_id) BETWEEN 1 AND 200)
      OR
      (assigned_by_actor_type='SYSTEM'
        AND (assigned_by_actor_id IS NULL
          OR length(assigned_by_actor_id) BETWEEN 1 AND 200))
    ),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  revoked_at INTEGER,
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL
      AND revoked_at >= created_at)
  )
) STRICT;

CREATE UNIQUE INDEX uq_buyer_staff_assignment_active
ON buyer_staff_assignments (buyer_customer_id, duty_code)
WHERE status='ACTIVE';

CREATE INDEX idx_buyer_staff_assignment_staff_status
ON buyer_staff_assignments (staff_id, status, duty_code, buyer_customer_id);

CREATE TABLE seller_staff_assignments (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  duty_code TEXT NOT NULL CHECK (duty_code='SELLER_ACCOUNT_MANAGER'),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  source TEXT NOT NULL CHECK (source IN (
    'AUTO_INITIAL', 'AUTO_REPLACEMENT', 'OWNER_FALLBACK',
    'MANUAL_REASSIGN', 'BATCH_TRANSFER'
  )),
  assigned_by_actor_type TEXT NOT NULL
    CHECK (assigned_by_actor_type IN ('STAFF', 'SYSTEM')),
  assigned_by_actor_id TEXT
    CHECK (
      (assigned_by_actor_type='STAFF'
        AND assigned_by_actor_id IS NOT NULL
        AND length(assigned_by_actor_id) BETWEEN 1 AND 200)
      OR
      (assigned_by_actor_type='SYSTEM'
        AND (assigned_by_actor_id IS NULL
          OR length(assigned_by_actor_id) BETWEEN 1 AND 200))
    ),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  revoked_at INTEGER,
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL
      AND revoked_at >= created_at)
  )
) STRICT;

CREATE UNIQUE INDEX uq_seller_staff_assignment_active
ON seller_staff_assignments (seller_organization_id, duty_code)
WHERE status='ACTIVE';

CREATE INDEX idx_seller_staff_assignment_staff_status
ON seller_staff_assignments (
  staff_id, status, duty_code, seller_organization_id
);

CREATE TRIGGER trg_buyer_staff_assignments_staff_guard
BEFORE INSERT ON buyer_staff_assignments
WHEN NOT EXISTS (
  SELECT 1
  FROM staff_users staff
  LEFT JOIN staff_availability availability ON availability.staff_id=staff.id
  JOIN staff_effective_assignment_permissions permission
    ON permission.staff_id=staff.id
    AND permission.permission_code=CASE NEW.duty_code
      WHEN 'BUYER_PRE_SALES_OWNER' THEN 'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES'
      WHEN 'BUYER_AFTER_SALES_OWNER' THEN 'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES'
      WHEN 'BUYER_REFUND_OWNER' THEN 'ASSIGNMENT_ELIGIBLE_BUYER_REFUND'
    END
  WHERE staff.id=NEW.staff_id
    AND staff.status='ACTIVE'
    AND COALESCE(availability.availability_status, 'AVAILABLE')='AVAILABLE'
    AND (
      (NEW.duty_code='BUYER_PRE_SALES_OWNER' AND 5=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id
          AND required.permission_code IN (
            'BUYER_VIEW', 'RESERVATION_VIEW', 'RESERVATION_DECIDE',
            'ORDER_VIEW', 'ORDER_CONFIRM'
          )
      ))
      OR (NEW.duty_code='BUYER_AFTER_SALES_OWNER' AND 3=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id
          AND required.permission_code IN (
            'BUYER_VIEW', 'REVIEW_VIEW', 'REVIEW_DECIDE'
          )
      ))
      OR (NEW.duty_code='BUYER_REFUND_OWNER' AND 3=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id
          AND required.permission_code IN (
            'BUYER_VIEW', 'BUYER_REFUND_VIEW', 'BUYER_REFUND_RECORD'
          )
      ))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_staff_assignment_target_ineligible');
END;

CREATE TRIGGER trg_seller_staff_assignments_staff_guard
BEFORE INSERT ON seller_staff_assignments
WHEN NOT EXISTS (
  SELECT 1
  FROM staff_users staff
  LEFT JOIN staff_availability availability ON availability.staff_id=staff.id
  JOIN staff_effective_assignment_permissions permission
    ON permission.staff_id=staff.id
    AND permission.permission_code='ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT'
  WHERE staff.id=NEW.staff_id
    AND staff.status='ACTIVE'
    AND COALESCE(availability.availability_status, 'AVAILABLE')='AVAILABLE'
    AND 4=(
      SELECT COUNT(DISTINCT required.permission_code)
      FROM staff_effective_assignment_permissions required
      WHERE required.staff_id=staff.id
        AND required.permission_code IN (
          'PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_VIEW', 'DEMAND_PUBLISH'
        )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'seller_staff_assignment_target_ineligible');
END;

CREATE TRIGGER trg_buyer_staff_assignments_revoke_only
BEFORE UPDATE ON buyer_staff_assignments
WHEN NOT (
  OLD.status='ACTIVE'
  AND NEW.status='REVOKED'
  AND NEW.revoked_at IS NOT NULL
  AND NEW.revoked_at >= OLD.created_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at >= OLD.updated_at
  AND NEW.id IS OLD.id
  AND NEW.buyer_customer_id IS OLD.buyer_customer_id
  AND NEW.duty_code IS OLD.duty_code
  AND NEW.staff_id IS OLD.staff_id
  AND NEW.source IS OLD.source
  AND NEW.assigned_by_actor_type IS OLD.assigned_by_actor_type
  AND NEW.assigned_by_actor_id IS OLD.assigned_by_actor_id
  AND NEW.reason IS OLD.reason
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_staff_assignments_are_immutable');
END;

CREATE TRIGGER trg_buyer_staff_assignments_no_delete
BEFORE DELETE ON buyer_staff_assignments
BEGIN
  SELECT RAISE(ABORT, 'buyer_staff_assignments_are_immutable');
END;

CREATE TRIGGER trg_seller_staff_assignments_revoke_only
BEFORE UPDATE ON seller_staff_assignments
WHEN NOT (
  OLD.status='ACTIVE'
  AND NEW.status='REVOKED'
  AND NEW.revoked_at IS NOT NULL
  AND NEW.revoked_at >= OLD.created_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at >= OLD.updated_at
  AND NEW.id IS OLD.id
  AND NEW.seller_organization_id IS OLD.seller_organization_id
  AND NEW.duty_code IS OLD.duty_code
  AND NEW.staff_id IS OLD.staff_id
  AND NEW.source IS OLD.source
  AND NEW.assigned_by_actor_type IS OLD.assigned_by_actor_type
  AND NEW.assigned_by_actor_id IS OLD.assigned_by_actor_id
  AND NEW.reason IS OLD.reason
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'seller_staff_assignments_are_immutable');
END;

CREATE TRIGGER trg_seller_staff_assignments_no_delete
BEFORE DELETE ON seller_staff_assignments
BEGIN
  SELECT RAISE(ABORT, 'seller_staff_assignments_are_immutable');
END;

CREATE TABLE staff_assignment_cursors (
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'SELLER_ACCOUNT_MANAGER',
    'BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER',
    'BUYER_REFUND_OWNER'
  )),
  marketplace_code TEXT NOT NULL REFERENCES marketplaces(code),
  candidate_pool_key TEXT NOT NULL DEFAULT 'DEFAULT'
    CHECK (length(candidate_pool_key) BETWEEN 1 AND 200),
  team_id TEXT REFERENCES staff_teams(id),
  last_assigned_staff_id TEXT REFERENCES staff_users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (duty_code, marketplace_code, candidate_pool_key),
  CHECK (
    (team_id IS NULL AND candidate_pool_key='DEFAULT')
    OR
    (team_id IS NOT NULL AND candidate_pool_key=team_id)
  )
) STRICT;

CREATE INDEX idx_staff_assignment_cursor_last_staff
ON staff_assignment_cursors (
  marketplace_code, duty_code, last_assigned_staff_id
);

CREATE TABLE staff_assignment_fallbacks (
  marketplace_code TEXT PRIMARY KEY REFERENCES marketplaces(code),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  configured_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TRIGGER trg_staff_assignment_fallbacks_insert_guard
BEFORE INSERT ON staff_assignment_fallbacks
WHEN NOT EXISTS (
  SELECT 1
  FROM staff_users staff
  LEFT JOIN staff_availability availability ON availability.staff_id=staff.id
  WHERE staff.id=NEW.staff_id
    AND staff.status='ACTIVE'
    AND COALESCE(availability.availability_status, 'AVAILABLE')='AVAILABLE'
    AND EXISTS (
      SELECT 1 FROM staff_role_assignments role
      WHERE role.staff_id=staff.id AND role.role_code='owner' AND role.status='ACTIVE'
    )
    AND 17=(
      SELECT COUNT(DISTINCT permission.permission_code)
      FROM staff_effective_assignment_permissions permission
      WHERE permission.staff_id=staff.id
        AND permission.permission_code IN (
          'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
          'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
          'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
          'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
          'PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_VIEW', 'DEMAND_PUBLISH',
          'BUYER_VIEW', 'RESERVATION_VIEW', 'RESERVATION_DECIDE',
          'ORDER_VIEW', 'ORDER_CONFIRM', 'REVIEW_VIEW', 'REVIEW_DECIDE',
          'BUYER_REFUND_VIEW', 'BUYER_REFUND_RECORD'
        )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'staff_assignment_fallback_invalid');
END;

CREATE TRIGGER trg_staff_assignment_fallbacks_update_guard
BEFORE UPDATE ON staff_assignment_fallbacks
WHEN NOT (
  NEW.marketplace_code IS OLD.marketplace_code
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND EXISTS (
    SELECT 1
    FROM staff_users staff
    LEFT JOIN staff_availability availability ON availability.staff_id=staff.id
    WHERE staff.id=NEW.staff_id
      AND staff.status='ACTIVE'
      AND COALESCE(availability.availability_status, 'AVAILABLE')='AVAILABLE'
      AND EXISTS (
        SELECT 1 FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.role_code='owner' AND role.status='ACTIVE'
      )
      AND 17=(
        SELECT COUNT(DISTINCT permission.permission_code)
        FROM staff_effective_assignment_permissions permission
        WHERE permission.staff_id=staff.id
          AND permission.permission_code IN (
            'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
            'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
            'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
            'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
            'PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_VIEW', 'DEMAND_PUBLISH',
            'BUYER_VIEW', 'RESERVATION_VIEW', 'RESERVATION_DECIDE',
            'ORDER_VIEW', 'ORDER_CONFIRM', 'REVIEW_VIEW', 'REVIEW_DECIDE',
            'BUYER_REFUND_VIEW', 'BUYER_REFUND_RECORD'
          )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'staff_assignment_fallback_invalid');
END;

CREATE TABLE staff_work_items (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  work_type TEXT NOT NULL CHECK (work_type IN (
    'PRODUCT_APPLICATION_REVIEW',
    'DEMAND_REVIEW',
    'RESERVATION_DECISION',
    'ORDER_EVIDENCE_REVIEW',
    'REVIEW_DECISION',
    'BUYER_REFUND_PROCESSING'
  )),
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN (
    'PRODUCT_APPLICATION',
    'DEMAND_BATCH',
    'RESERVATION',
    'ORDER_EVIDENCE',
    'REVIEW_CASE',
    'BUYER_REFUND_OBLIGATION'
  )),
  source_entity_id TEXT NOT NULL CHECK (length(source_entity_id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT REFERENCES buyer_customers(id),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  store_id TEXT REFERENCES seller_stores(id),
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'SELLER_ACCOUNT_MANAGER',
    'BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER',
    'BUYER_REFUND_OWNER'
  )),
  fixed_assignment_type TEXT NOT NULL CHECK (
    fixed_assignment_type IN ('BUYER', 'SELLER')
  ),
  fixed_assignment_id TEXT NOT NULL CHECK (
    length(fixed_assignment_id) BETWEEN 1 AND 200
  ),
  assigned_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER,
  cancelled_at INTEGER,
  CHECK (
    (work_type IN ('PRODUCT_APPLICATION_REVIEW', 'DEMAND_REVIEW')
      AND source_entity_type IN ('PRODUCT_APPLICATION', 'DEMAND_BATCH')
      AND duty_code='SELLER_ACCOUNT_MANAGER'
      AND fixed_assignment_type='SELLER'
      AND seller_organization_id IS NOT NULL)
    OR
    (work_type IN ('RESERVATION_DECISION', 'ORDER_EVIDENCE_REVIEW')
      AND source_entity_type IN ('RESERVATION', 'ORDER_EVIDENCE')
      AND duty_code='BUYER_PRE_SALES_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
    OR
    (work_type='REVIEW_DECISION'
      AND source_entity_type='REVIEW_CASE'
      AND duty_code='BUYER_AFTER_SALES_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
    OR
    (work_type='BUYER_REFUND_PROCESSING'
      AND source_entity_type='BUYER_REFUND_OBLIGATION'
      AND duty_code='BUYER_REFUND_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
  ),
  CHECK (
    (status='OPEN' AND completed_at IS NULL AND cancelled_at IS NULL)
    OR
    (status='COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR
    (status='CANCELLED' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX uq_staff_work_item_open_source
ON staff_work_items (
  source_entity_type,
  source_entity_id,
  work_type
)
WHERE status='OPEN';

CREATE INDEX idx_staff_work_items_assignee_status
ON staff_work_items (
  assigned_staff_id, status, created_at, id
);

CREATE INDEX idx_staff_work_items_buyer_status
ON staff_work_items (buyer_customer_id, status, duty_code, id)
WHERE buyer_customer_id IS NOT NULL;

CREATE INDEX idx_staff_work_items_seller_status
ON staff_work_items (seller_organization_id, status, duty_code, id)
WHERE seller_organization_id IS NOT NULL;

CREATE TRIGGER trg_staff_work_items_assignment_guard
BEFORE INSERT ON staff_work_items
WHEN NOT (
  (
    NEW.fixed_assignment_type='BUYER'
    AND EXISTS (
      SELECT 1 FROM buyer_staff_assignments assignment
      WHERE assignment.id=NEW.fixed_assignment_id
        AND assignment.buyer_customer_id=NEW.buyer_customer_id
        AND assignment.duty_code=NEW.duty_code
        AND assignment.staff_id=NEW.assigned_staff_id
        AND assignment.status='ACTIVE'
    )
  )
  OR
  (
    NEW.fixed_assignment_type='SELLER'
    AND EXISTS (
      SELECT 1 FROM seller_staff_assignments assignment
      WHERE assignment.id=NEW.fixed_assignment_id
        AND assignment.seller_organization_id=NEW.seller_organization_id
        AND assignment.duty_code=NEW.duty_code
        AND assignment.staff_id=NEW.assigned_staff_id
        AND assignment.status='ACTIVE'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'staff_work_item_assignment_mismatch');
END;

CREATE TRIGGER trg_staff_work_items_update_guard
BEFORE UPDATE ON staff_work_items
WHEN NOT (
  OLD.status='OPEN'
  AND NEW.status IN ('OPEN', 'COMPLETED', 'CANCELLED')
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND NEW.id IS OLD.id
  AND NEW.work_type IS OLD.work_type
  AND NEW.source_entity_type IS OLD.source_entity_type
  AND NEW.source_entity_id IS OLD.source_entity_id
  AND NEW.buyer_customer_id IS OLD.buyer_customer_id
  AND NEW.seller_organization_id IS OLD.seller_organization_id
  AND NEW.store_id IS OLD.store_id
  AND NEW.duty_code IS OLD.duty_code
  AND NEW.fixed_assignment_type IS OLD.fixed_assignment_type
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'staff_work_item_invalid_transition');
END;

CREATE TRIGGER trg_staff_work_items_no_delete
BEFORE DELETE ON staff_work_items
BEGIN
  SELECT RAISE(ABORT, 'staff_work_items_are_immutable');
END;

CREATE TABLE staff_assignment_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'AUTO_INITIAL_ASSIGNMENT',
    'AUTO_REPLACEMENT',
    'OWNER_FALLBACK',
    'MANUAL_WORK_ITEM_REASSIGN',
    'FIXED_OWNER_CHANGED',
    'BATCH_TRANSFER_STARTED',
    'BATCH_TRANSFER_ITEM_COMPLETED',
    'BATCH_TRANSFER_COMPLETED',
    'AVAILABILITY_CHANGED',
    'WORK_ITEM_CREATED',
    'WORK_ITEM_COMPLETED',
    'WORK_ITEM_CANCELLED',
    'ASSIGNMENT_FAILED'
  )),
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'BUYER_CUSTOMER', 'SELLER_ORGANIZATION',
    'STAFF', 'WORK_ITEM', 'REASSIGNMENT_BATCH', 'MARKETPLACE'
  )),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  duty_code TEXT CHECK (duty_code IS NULL OR duty_code IN (
    'SELLER_ACCOUNT_MANAGER',
    'BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER',
    'BUYER_REFUND_OWNER'
  )),
  assignment_id TEXT,
  work_item_id TEXT REFERENCES staff_work_items(id),
  batch_id TEXT,
  old_staff_id TEXT REFERENCES staff_users(id),
  new_staff_id TEXT REFERENCES staff_users(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF', 'SYSTEM')),
  actor_id TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  request_id TEXT,
  idempotency_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object'),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_staff_assignment_events_subject
ON staff_assignment_events (subject_type, subject_id, created_at, id);

CREATE INDEX idx_staff_assignment_events_staff
ON staff_assignment_events (new_staff_id, old_staff_id, created_at, id);

CREATE UNIQUE INDEX uq_staff_assignment_event_work_item_terminal
ON staff_assignment_events (work_item_id, event_type)
WHERE work_item_id IS NOT NULL
  AND event_type IN (
    'WORK_ITEM_CREATED', 'WORK_ITEM_COMPLETED', 'WORK_ITEM_CANCELLED'
  );

CREATE UNIQUE INDEX uq_staff_assignment_event_batch_item_completed
ON staff_assignment_events (batch_id, subject_type, subject_id, event_type)
WHERE batch_id IS NOT NULL
  AND event_type='BATCH_TRANSFER_ITEM_COMPLETED';

CREATE UNIQUE INDEX uq_staff_assignment_failure_idempotency
ON staff_assignment_events (
  subject_type, subject_id, duty_code, idempotency_key, event_type
)
WHERE event_type='ASSIGNMENT_FAILED'
  AND idempotency_key IS NOT NULL;

CREATE TRIGGER trg_staff_assignment_events_no_update
BEFORE UPDATE ON staff_assignment_events
BEGIN
  SELECT RAISE(ABORT, 'staff_assignment_events_are_immutable');
END;

CREATE TRIGGER trg_staff_assignment_events_no_delete
BEFORE DELETE ON staff_assignment_events
BEGIN
  SELECT RAISE(ABORT, 'staff_assignment_events_are_immutable');
END;

CREATE TABLE staff_reassignment_batches (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  source_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  target_mode TEXT NOT NULL CHECK (target_mode IN ('STAFF', 'AUTO_SELECT')),
  target_staff_id TEXT REFERENCES staff_users(id),
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'SELLER_ACCOUNT_MANAGER',
    'BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER',
    'BUYER_REFUND_OWNER'
  )),
  subject_type TEXT NOT NULL CHECK (
    subject_type IN ('BUYER_CUSTOMER', 'SELLER_ORGANIZATION')
  ),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'RUNNING', 'COMPLETED',
    'PARTIALLY_FAILED', 'FAILED', 'CANCELLED'
  )),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  started_at INTEGER,
  completed_at INTEGER,
  CHECK (
    (target_mode='STAFF' AND target_staff_id IS NOT NULL)
    OR
    (target_mode='AUTO_SELECT' AND target_staff_id IS NULL)
  ),
  CHECK (
    (status='PENDING' AND started_at IS NULL AND completed_at IS NULL)
    OR
    (status='RUNNING' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR
    (status IN ('COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED')
      AND completed_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_reassignment_batches_status
ON staff_reassignment_batches (status, created_at, id);

CREATE TABLE staff_reassignment_batch_items (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  batch_id TEXT NOT NULL REFERENCES staff_reassignment_batches(id),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  old_assignment_id TEXT NOT NULL CHECK (length(old_assignment_id) BETWEEN 1 AND 200),
  new_assignment_id TEXT CHECK (
    new_assignment_id IS NULL OR length(new_assignment_id) BETWEEN 1 AND 200
  ),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  error_code TEXT CHECK (
    error_code IS NULL OR length(error_code) BETWEEN 1 AND 100
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  processed_at INTEGER,
  UNIQUE (batch_id, subject_id),
  CHECK (
    (status='PENDING' AND new_assignment_id IS NULL
      AND error_code IS NULL AND processed_at IS NULL)
    OR
    (status='COMPLETED' AND new_assignment_id IS NOT NULL
      AND error_code IS NULL AND processed_at IS NOT NULL)
    OR
    (status='FAILED' AND error_code IS NOT NULL
      AND processed_at IS NOT NULL)
    OR
    (status='CANCELLED' AND processed_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_reassignment_batch_items_ready
ON staff_reassignment_batch_items (batch_id, status, id);

-- Dedicated assertion guard gives cursor CAS retries a stable error code instead
-- of conflating them with unrelated transaction_assertions failures.
CREATE TABLE staff_assignment_cursor_assertions (
  assertion_value INTEGER NOT NULL
) STRICT;

CREATE TRIGGER trg_staff_assignment_cursor_assertion_guard
BEFORE INSERT ON staff_assignment_cursor_assertions
WHEN NEW.assertion_value <> 1
BEGIN
  SELECT RAISE(ABORT, 'staff_assignment_cursor_version_conflict');
END;

CREATE TRIGGER trg_staff_assignment_cursor_assertion_cleanup
AFTER INSERT ON staff_assignment_cursor_assertions
BEGIN
  DELETE FROM staff_assignment_cursor_assertions
  WHERE rowid=NEW.rowid;
END;

UPDATE app_schema_state
SET
  schema_version=20,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=19;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=20
) THEN 1 ELSE 0 END;
