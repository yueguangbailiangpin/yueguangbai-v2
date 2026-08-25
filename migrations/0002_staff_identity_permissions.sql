-- Baseline 0002 staff_identity_permissions (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=1 THEN 1 ELSE 0 END;

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
  disabled_at INTEGER, session_version INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(session_version)='integer' AND session_version>=1),
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

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

CREATE TABLE staff_email_identities (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  staff_id TEXT NOT NULL UNIQUE REFERENCES staff_users(id),
  normalized_email TEXT NOT NULL UNIQUE CHECK (
    length(normalized_email) BETWEEN 3 AND 320
    AND normalized_email=lower(normalized_email)
    AND instr(normalized_email,'@')>1
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  verified_at INTEGER,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  revoked_at INTEGER,
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE staff_marketplace_scopes (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  role_code TEXT NOT NULL CHECK (role_code IN (
    'acquisition','pre_sales','seller_ops','buyer_refund'
  )),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  assigned_by_staff_id TEXT REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL CHECK (assigned_at>=0),
  revoked_at INTEGER,
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at), scope_kind TEXT NOT NULL
  DEFAULT 'PRIMARY' CHECK (scope_kind IN ('PRIMARY','SUPPORT')),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE "staff_permission_overrides" (
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  permission_code TEXT NOT NULL CHECK (permission_code IN (
    'TASK_VIEW_OPEN','TASK_CLAIM','TASK_VIEW_TEAM','TASK_ASSIGN_TEAM',
    'TASK_REASSIGN_TEAM','TASK_TAKEOVER_TEAM','TASK_COLLABORATE_TEAM',
    'BUYER_VIEW','BUYER_CREATE','BUYER_ACTIVATE_STANDARD',
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
    'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND','ASSIGNMENT_BATCH_TRANSFER',
    'ASSIGNMENT_AVAILABILITY_MANAGE','ACQUISITION_ADMIN',
    'ACQUISITION_BUYER_LEAD','ACQUISITION_SELLER_LEAD'
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

CREATE TABLE "staff_role_assignments" (
  id TEXT PRIMARY KEY DEFAULT ('role-' || lower(hex(randomblob(16))))
    CHECK (length(id) BETWEEN 1 AND 200),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  role_code TEXT NOT NULL CHECK (
    (status='ACTIVE' AND role_code IN (
      'owner','acquisition','pre_sales','seller_ops','buyer_refund'
    ))
    OR
    (status='REVOKED' AND role_code IN (
      'owner','acquisition','pre_sales','seller_ops','buyer_refund',
      'seller_support','after_sales','buyer_support'
    ))
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  assigned_by_staff_id TEXT REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL CHECK (assigned_at>=0),
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  revoked_reason TEXT CHECK (
    revoked_reason IS NULL OR length(revoked_reason) BETWEEN 1 AND 1000
  ),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL
      AND revoked_by_staff_id IS NULL AND revoked_reason IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL
      AND revoked_at>=assigned_at)
  )
) STRICT;

CREATE TABLE staff_role_consolidation_cutovers (
  mapping_version TEXT PRIMARY KEY
    CHECK (mapping_version='staff-four-role-v1'),
  permission_catalog_version TEXT NOT NULL
    CHECK (permission_catalog_version='staff-permissions-schema-35-v1'),
  permission_catalog_hash TEXT NOT NULL CHECK (
    permission_catalog_hash=
      '2a9c6d7a128e669e202f9a5a0a7af7966e70df79326ed78c4e53448416c19eb3'
  ),
  source_schema_version INTEGER NOT NULL CHECK (source_schema_version=34),
  target_schema_version INTEGER NOT NULL CHECK (target_schema_version=35),
  active_staff_count INTEGER NOT NULL CHECK (active_staff_count>=0),
  applied_at INTEGER NOT NULL CHECK (applied_at>=0)
) STRICT;

CREATE TABLE staff_role_consolidation_mappings (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  staff_id TEXT NOT NULL UNIQUE REFERENCES staff_users(id),
  mapping_version TEXT NOT NULL
    REFERENCES staff_role_consolidation_cutovers(mapping_version),
  source_roles_json TEXT NOT NULL CHECK (
    json_valid(source_roles_json)
    AND json_type(source_roles_json)='array'
    AND json_array_length(source_roles_json)>=1
  ),
  target_role_code TEXT NOT NULL CHECK (target_role_code IN (
    'owner','pre_sales','seller_ops','buyer_refund'
  )),
  approval_required INTEGER NOT NULL CHECK (approval_required IN (0,1)),
  approval_audit_event_id TEXT REFERENCES audit_events(id),
  approved_by_staff_id TEXT REFERENCES staff_users(id),
  approval_hash TEXT CHECK (
    approval_hash IS NULL OR (
      length(approval_hash)=64
      AND approval_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  authorization_version_before INTEGER NOT NULL
    CHECK (authorization_version_before>=1),
  authorization_version_after INTEGER NOT NULL
    CHECK (authorization_version_after=authorization_version_before+1),
  applied_at INTEGER NOT NULL CHECK (applied_at>=0),
  CHECK (
    (approval_required=0
      AND approval_audit_event_id IS NULL
      AND approved_by_staff_id IS NULL
      AND approval_hash IS NULL)
    OR
    (approval_required=1
      AND approval_audit_event_id IS NOT NULL
      AND approved_by_staff_id IS NOT NULL
      AND approval_hash IS NOT NULL)
  )
) STRICT;

CREATE TABLE staff_sessions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  issued_session_version INTEGER NOT NULL CHECK (
    typeof(issued_session_version)='integer' AND issued_session_version>=1
  ),
  issued_authorization_version INTEGER NOT NULL CHECK (
    typeof(issued_authorization_version)='integer'
    AND issued_authorization_version>=1
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  expires_at INTEGER NOT NULL CHECK (
    typeof(expires_at)='integer' AND expires_at>=0
  ),
  revoked_at INTEGER CHECK (
    revoked_at IS NULL OR (typeof(revoked_at)='integer' AND revoked_at>=0)
  ),
  revoked_reason TEXT CHECK (
    revoked_reason IS NULL OR length(revoked_reason) BETWEEN 1 AND 500
  ),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at)='integer' AND created_at>=0
  ),
  updated_at INTEGER NOT NULL CHECK (
    typeof(updated_at)='integer' AND updated_at>=created_at
  ),
  CHECK (expires_at>created_at),
  CHECK (revoked_at IS NULL OR revoked_at BETWEEN created_at AND updated_at),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoked_reason IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
    OR (status='EXPIRED' AND revoked_at IS NULL AND revoked_reason IS NULL
        AND updated_at>=expires_at)
  )
) STRICT;

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

CREATE INDEX idx_staff_authorization_events_staff_created
ON staff_authorization_events (
  staff_id,
  created_at,
  id
);

CREATE INDEX idx_staff_email_identity_status
ON staff_email_identities(status,normalized_email);

CREATE INDEX idx_staff_marketplace_scope_role_market
ON staff_marketplace_scopes(role_code,marketplace_code,status,staff_id);

CREATE INDEX idx_staff_marketplace_scope_support
ON staff_marketplace_scopes(role_code,marketplace_code,scope_kind,status,staff_id);

CREATE INDEX idx_staff_permission_override_effect_status
ON staff_permission_overrides(effect,status,permission_code,staff_id);

CREATE INDEX idx_staff_role_assignment_role_status
ON staff_role_assignments(role_code,status,staff_id);

CREATE INDEX idx_staff_sessions_staff_status_expiry
ON staff_sessions (staff_id, status, expires_at, id);

CREATE INDEX idx_staff_sessions_status_expiry
ON staff_sessions (status, expires_at, id);

CREATE INDEX idx_staff_team_leader_team_status
ON staff_team_leaders (
  team_id,
  status,
  staff_id
);

CREATE INDEX idx_staff_team_membership_team_status
ON staff_team_memberships (
  team_id,
  status,
  staff_id
);

CREATE INDEX idx_staff_teams_department_status
ON staff_teams (
  department_id,
  status,
  code
);

CREATE INDEX idx_staff_users_status_name
ON staff_users (
  status,
  display_name,
  id
);

CREATE UNIQUE INDEX uq_staff_marketplace_role_primary
ON staff_marketplace_scopes(role_code,marketplace_code)
WHERE status='ACTIVE' AND scope_kind='PRIMARY';

CREATE UNIQUE INDEX uq_staff_marketplace_scope_active
ON staff_marketplace_scopes(staff_id,marketplace_code)
WHERE status='ACTIVE';

CREATE UNIQUE INDEX uq_staff_role_assignment_one_active
ON staff_role_assignments(staff_id) WHERE status='ACTIVE';

CREATE TRIGGER trg_staff_authorization_events_no_delete
BEFORE DELETE ON staff_authorization_events
BEGIN
  SELECT RAISE(ABORT, 'staff_authorization_events_are_immutable');
END;

CREATE TRIGGER trg_staff_authorization_events_no_update
BEFORE UPDATE ON staff_authorization_events
BEGIN
  SELECT RAISE(ABORT, 'staff_authorization_events_are_immutable');
END;

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

CREATE TRIGGER trg_staff_role_assignments_no_delete
BEFORE DELETE ON staff_role_assignments
BEGIN
  SELECT RAISE(ABORT,'staff_role_assignments_are_immutable');
END;

CREATE TRIGGER trg_staff_role_assignments_revoke_only
BEFORE UPDATE ON staff_role_assignments
WHEN NOT (
  OLD.status='ACTIVE' AND NEW.status='REVOKED'
  AND NEW.id IS OLD.id
  AND NEW.staff_id IS OLD.staff_id
  AND NEW.role_code IS OLD.role_code
  AND NEW.assigned_by_staff_id IS OLD.assigned_by_staff_id
  AND NEW.assigned_at IS OLD.assigned_at
  AND NEW.created_at IS OLD.created_at
  AND NEW.revoked_at IS NOT NULL
  AND NEW.revoked_at>=OLD.assigned_at
  AND NEW.revoked_by_staff_id IS NOT NULL
  AND NEW.revoked_reason IS NOT NULL
  AND NEW.updated_at>=OLD.updated_at
)
BEGIN
  SELECT RAISE(ABORT,'staff_role_assignments_are_immutable');
END;

CREATE TRIGGER trg_staff_sessions_identity_immutable
BEFORE UPDATE ON staff_sessions
WHEN NEW.id<>OLD.id
  OR NEW.token_hash<>OLD.token_hash
  OR NEW.staff_id<>OLD.staff_id
  OR NEW.issued_session_version<>OLD.issued_session_version
  OR NEW.issued_authorization_version<>OLD.issued_authorization_version
  OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'staff_session_identity_is_immutable');
END;

CREATE TRIGGER trg_staff_sessions_no_delete
BEFORE DELETE ON staff_sessions
BEGIN
  SELECT RAISE(ABORT, 'staff_sessions_cannot_be_deleted');
END;

CREATE TRIGGER trg_staff_sessions_transition_guard
BEFORE UPDATE ON staff_sessions
WHEN NOT (
  OLD.status='ACTIVE'
  AND NEW.status IN ('REVOKED','EXPIRED')
  AND NEW.updated_at>=OLD.updated_at
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_staff_session_transition');
END;

INSERT INTO staff_role_consolidation_cutovers (
  mapping_version, permission_catalog_version, permission_catalog_hash, source_schema_version, target_schema_version, active_staff_count, applied_at
) VALUES (
  'staff-four-role-v1', 'staff-permissions-schema-35-v1', '2a9c6d7a128e669e202f9a5a0a7af7966e70df79326ed78c4e53448416c19eb3', 34, 35, 0, 1787661495000
);

UPDATE app_schema_state
SET
  schema_version=2,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
