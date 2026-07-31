PRAGMA foreign_keys = ON;

CREATE TABLE staff_departments (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  code TEXT NOT NULL UNIQUE
    CHECK (
      length(code) BETWEEN 1 AND 60
      AND code NOT GLOB '*[^a-z0-9_-]*'
    ),
  name TEXT NOT NULL
    CHECK (length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  disabled_at INTEGER,
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE staff_teams (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  department_id TEXT NOT NULL
    REFERENCES staff_departments(id),
  code TEXT NOT NULL
    CHECK (
      length(code) BETWEEN 1 AND 60
      AND code NOT GLOB '*[^a-z0-9_-]*'
    ),
  name TEXT NOT NULL
    CHECK (length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  disabled_at INTEGER,
  UNIQUE (department_id, code),
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_teams_department_status
ON staff_teams (
  department_id,
  status,
  code
);

CREATE TABLE staff_users (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  display_name TEXT NOT NULL
    CHECK (length(display_name) BETWEEN 1 AND 100),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  authorization_version INTEGER NOT NULL DEFAULT 1
    CHECK (authorization_version >= 1),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  disabled_at INTEGER,
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_users_status_name
ON staff_users (
  status,
  display_name,
  id
);

CREATE TABLE feishu_staff_identities (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  tenant_key TEXT NOT NULL
    CHECK (length(tenant_key) BETWEEN 1 AND 200),
  open_id TEXT NOT NULL
    CHECK (length(open_id) BETWEEN 1 AND 200),
  user_id TEXT
    CHECK (user_id IS NULL OR length(user_id) BETWEEN 1 AND 200),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  verified_at INTEGER NOT NULL
    CHECK (verified_at >= 0),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  revoked_at INTEGER,
  UNIQUE (tenant_key, open_id),
  UNIQUE (staff_id, tenant_key),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX uq_feishu_staff_identity_tenant_user
ON feishu_staff_identities (
  tenant_key,
  user_id
)
WHERE user_id IS NOT NULL;

CREATE INDEX idx_feishu_staff_identity_staff_status
ON feishu_staff_identities (
  staff_id,
  status
);

CREATE TABLE staff_team_memberships (
  staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  team_id TEXT NOT NULL
    REFERENCES staff_teams(id),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'ENDED')),
  joined_at INTEGER NOT NULL
    CHECK (joined_at >= 0),
  ended_at INTEGER,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  PRIMARY KEY (staff_id, team_id),
  CHECK (
    (status='ACTIVE' AND ended_at IS NULL)
    OR
    (status='ENDED' AND ended_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_team_membership_team_status
ON staff_team_memberships (
  team_id,
  status,
  staff_id
);

CREATE TABLE staff_role_assignments (
  staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  role_code TEXT NOT NULL
    CHECK (role_code IN (
      'owner',
      'pre_sales',
      'seller_ops',
      'seller_support',
      'after_sales',
      'buyer_support'
    )),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  assigned_by_staff_id TEXT
    REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL
    CHECK (assigned_at >= 0),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  PRIMARY KEY (staff_id, role_code),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_role_assignment_role_status
ON staff_role_assignments (
  role_code,
  status,
  staff_id
);

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
      'AUDIT_VIEW'
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

CREATE INDEX idx_staff_permission_override_effect_status
ON staff_permission_overrides (
  effect,
  status,
  permission_code,
  staff_id
);

CREATE TABLE staff_team_leaders (
  staff_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  assigned_by_staff_id TEXT
    REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL
    CHECK (assigned_at >= 0),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  PRIMARY KEY (staff_id, team_id),
  FOREIGN KEY (staff_id, team_id)
    REFERENCES staff_team_memberships(staff_id, team_id),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_staff_team_leader_team_status
ON staff_team_leaders (
  team_id,
  status,
  staff_id
);

CREATE TABLE staff_authorization_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  authorization_version INTEGER NOT NULL
    CHECK (authorization_version >= 1),
  event_type TEXT NOT NULL
    CHECK (length(event_type) BETWEEN 1 AND 100),
  actor_staff_id TEXT
    REFERENCES staff_users(id),
  request_id TEXT,
  idempotency_key TEXT,
  change_summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (staff_id, authorization_version)
) STRICT;

CREATE INDEX idx_staff_authorization_events_staff_created
ON staff_authorization_events (
  staff_id,
  created_at,
  id
);

CREATE TRIGGER trg_staff_authorization_events_no_update
BEFORE UPDATE ON staff_authorization_events
BEGIN
  SELECT RAISE(ABORT, 'staff_authorization_events_are_immutable');
END;

CREATE TRIGGER trg_staff_authorization_events_no_delete
BEFORE DELETE ON staff_authorization_events
BEGIN
  SELECT RAISE(ABORT, 'staff_authorization_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=2,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
