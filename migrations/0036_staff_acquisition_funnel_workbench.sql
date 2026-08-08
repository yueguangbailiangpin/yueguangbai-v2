PRAGMA foreign_keys = ON;

-- M14 owns schema 36. The version guard is deliberately before every DDL so
-- wrong-order and repeated application leave no partial acquisition objects.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=35
) THEN 1 ELSE 0 END;

-- Acquisition permissions participate in the existing Personal DENY store.
DROP TRIGGER trg_buyer_staff_assignments_staff_guard;
DROP TRIGGER trg_seller_staff_assignments_staff_guard;
DROP TRIGGER trg_staff_assignment_fallbacks_insert_guard;
DROP TRIGGER trg_staff_assignment_fallbacks_update_guard;
DROP VIEW staff_effective_assignment_permissions;

CREATE TABLE staff_permission_overrides_next (
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

INSERT INTO staff_permission_overrides_next (
  staff_id,permission_code,effect,status,reason,assigned_by_staff_id,
  assigned_at,revoked_at,created_at,updated_at
)
SELECT staff_id,permission_code,effect,status,reason,assigned_by_staff_id,
  assigned_at,revoked_at,created_at,updated_at
FROM staff_permission_overrides;

DROP TABLE staff_permission_overrides;
ALTER TABLE staff_permission_overrides_next RENAME TO staff_permission_overrides;

CREATE INDEX idx_staff_permission_override_effect_status
ON staff_permission_overrides(effect,status,permission_code,staff_id);

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
  WHERE status='ACTIVE' AND effect='GRANT'
),
combined AS (
  SELECT staff_id, permission_code FROM role_permissions
  UNION
  SELECT staff_id, permission_code FROM explicit_grants
)
SELECT combined.staff_id, combined.permission_code
FROM combined
WHERE NOT EXISTS (
  SELECT 1 FROM staff_permission_overrides denied
  WHERE denied.staff_id=combined.staff_id
    AND denied.permission_code=combined.permission_code
    AND denied.status='ACTIVE' AND denied.effect='DENY'
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
    AND COALESCE(availability.availability_status,'AVAILABLE')='AVAILABLE'
    AND (
      (NEW.duty_code='BUYER_PRE_SALES_OWNER' AND 5=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id
          AND required.permission_code IN (
            'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
            'ORDER_VIEW','ORDER_CONFIRM'
          )
      ))
      OR (NEW.duty_code='BUYER_AFTER_SALES_OWNER' AND 3=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id
          AND required.permission_code IN (
            'BUYER_VIEW','REVIEW_VIEW','REVIEW_DECIDE'
          )
      ))
      OR (NEW.duty_code='BUYER_REFUND_OWNER' AND 3=(
        SELECT COUNT(DISTINCT required.permission_code)
        FROM staff_effective_assignment_permissions required
        WHERE required.staff_id=staff.id
          AND required.permission_code IN (
            'BUYER_VIEW','BUYER_REFUND_VIEW','BUYER_REFUND_RECORD'
          )
      ))
    )
)
BEGIN
  SELECT RAISE(ABORT,'buyer_staff_assignment_target_ineligible');
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
    AND COALESCE(availability.availability_status,'AVAILABLE')='AVAILABLE'
    AND 4=(
      SELECT COUNT(DISTINCT required.permission_code)
      FROM staff_effective_assignment_permissions required
      WHERE required.staff_id=staff.id
        AND required.permission_code IN (
          'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH'
        )
    )
)
BEGIN
  SELECT RAISE(ABORT,'seller_staff_assignment_target_ineligible');
END;

CREATE TRIGGER trg_staff_assignment_fallbacks_insert_guard
BEFORE INSERT ON staff_assignment_fallbacks
WHEN NOT EXISTS (
  SELECT 1
  FROM staff_users staff
  LEFT JOIN staff_availability availability ON availability.staff_id=staff.id
  WHERE staff.id=NEW.staff_id
    AND staff.status='ACTIVE'
    AND COALESCE(availability.availability_status,'AVAILABLE')='AVAILABLE'
    AND EXISTS (
      SELECT 1 FROM staff_role_assignments role
      WHERE role.staff_id=staff.id
        AND role.role_code='owner' AND role.status='ACTIVE'
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
          'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
          'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
          'ORDER_VIEW','ORDER_CONFIRM','REVIEW_VIEW','REVIEW_DECIDE',
          'BUYER_REFUND_VIEW','BUYER_REFUND_RECORD'
        )
    )
)
BEGIN
  SELECT RAISE(ABORT,'staff_assignment_fallback_invalid');
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
      AND COALESCE(availability.availability_status,'AVAILABLE')='AVAILABLE'
      AND EXISTS (
        SELECT 1 FROM staff_role_assignments role
        WHERE role.staff_id=staff.id
          AND role.role_code='owner' AND role.status='ACTIVE'
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
            'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
            'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
            'ORDER_VIEW','ORDER_CONFIRM','REVIEW_VIEW','REVIEW_DECIDE',
            'BUYER_REFUND_VIEW','BUYER_REFUND_RECORD'
          )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT,'staff_assignment_fallback_invalid');
END;

CREATE TABLE acquisition_role_permission_defaults (
  role_code TEXT NOT NULL CHECK (role_code IN (
    'owner','pre_sales','seller_ops','buyer_refund'
  )),
  permission_code TEXT NOT NULL CHECK (permission_code IN (
    'ACQUISITION_ADMIN','ACQUISITION_BUYER_LEAD','ACQUISITION_SELLER_LEAD'
  )),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY (role_code,permission_code)
) STRICT;

INSERT INTO acquisition_role_permission_defaults (
  role_code,permission_code,created_at
) VALUES
  ('owner','ACQUISITION_ADMIN',CAST(unixepoch('now') AS INTEGER)*1000),
  ('owner','ACQUISITION_BUYER_LEAD',CAST(unixepoch('now') AS INTEGER)*1000),
  ('owner','ACQUISITION_SELLER_LEAD',CAST(unixepoch('now') AS INTEGER)*1000),
  ('pre_sales','ACQUISITION_BUYER_LEAD',CAST(unixepoch('now') AS INTEGER)*1000),
  ('seller_ops','ACQUISITION_SELLER_LEAD',CAST(unixepoch('now') AS INTEGER)*1000);

CREATE TRIGGER trg_acquisition_role_permission_defaults_no_update
BEFORE UPDATE ON acquisition_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT,'acquisition_role_permission_defaults_are_immutable');
END;

CREATE TRIGGER trg_acquisition_role_permission_defaults_no_delete
BEFORE DELETE ON acquisition_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT,'acquisition_role_permission_defaults_are_immutable');
END;

CREATE TABLE acquisition_channels (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  code TEXT NOT NULL UNIQUE CHECK (
    length(code) BETWEEN 2 AND 40
    AND code=upper(code)
    AND code NOT GLOB '*[^A-Z0-9_-]*'
  ),
  channel_type TEXT NOT NULL CHECK (channel_type IN (
    'XIAOHONGSHU','PRIVATE_WECHAT','REFERRAL','OTHER'
  )),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  version INTEGER NOT NULL CHECK (version>=1),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  disabled_at INTEGER,
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE acquisition_channel_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED','DISABLED')),
  previous_version INTEGER,
  next_version INTEGER NOT NULL CHECK (next_version>=1),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

CREATE TRIGGER trg_acquisition_channel_origin_guard
BEFORE UPDATE ON acquisition_channels
WHEN NOT (
  OLD.status='ACTIVE' AND NEW.status='DISABLED'
  AND NEW.id IS OLD.id AND NEW.code IS OLD.code
  AND NEW.channel_type IS OLD.channel_type
  AND NEW.display_name IS OLD.display_name
  AND NEW.created_by_staff_id IS OLD.created_by_staff_id
  AND NEW.created_at IS OLD.created_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND NEW.disabled_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_invalid_update');
END;

CREATE TRIGGER trg_acquisition_channels_no_delete
BEFORE DELETE ON acquisition_channels
BEGIN SELECT RAISE(ABORT,'acquisition_channels_are_immutable'); END;
CREATE TRIGGER trg_acquisition_channel_events_no_update
BEFORE UPDATE ON acquisition_channel_events
BEGIN SELECT RAISE(ABORT,'acquisition_channel_events_are_immutable'); END;
CREATE TRIGGER trg_acquisition_channel_events_no_delete
BEFORE DELETE ON acquisition_channel_events
BEGIN SELECT RAISE(ABORT,'acquisition_channel_events_are_immutable'); END;

CREATE TABLE acquisition_staff_channel_assignments (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  effective_from INTEGER NOT NULL CHECK (effective_from>=0),
  effective_until INTEGER CHECK (
    effective_until IS NULL OR effective_until>effective_from
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  version INTEGER NOT NULL CHECK (version>=1),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  revoked_at INTEGER,
  revoke_reason TEXT CHECK (
    revoke_reason IS NULL OR length(revoke_reason) BETWEEN 1 AND 1000
  ),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_acquisition_assignments_resolution
ON acquisition_staff_channel_assignments(
  staff_id,lead_type,status,effective_from,effective_until
);

CREATE TRIGGER trg_acquisition_assignment_insert_guard
BEFORE INSERT ON acquisition_staff_channel_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM acquisition_channels channel
  WHERE channel.id=NEW.channel_id AND channel.status='ACTIVE'
) OR NOT EXISTS (
  SELECT 1 FROM staff_users staff
  JOIN staff_role_assignments role ON role.staff_id=staff.id
  WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
    AND role.status='ACTIVE'
    AND (
      role.role_code='owner'
      OR (NEW.lead_type='BUYER' AND role.role_code='pre_sales')
      OR (NEW.lead_type='SELLER' AND role.role_code='seller_ops')
    )
) OR EXISTS (
  SELECT 1 FROM acquisition_staff_channel_assignments existing
  WHERE existing.staff_id=NEW.staff_id
    AND existing.lead_type=NEW.lead_type
    AND existing.status='ACTIVE'
    AND NEW.effective_from<COALESCE(existing.effective_until,9223372036854775807)
    AND existing.effective_from<COALESCE(NEW.effective_until,9223372036854775807)
)
OR EXISTS (
  SELECT 1 FROM acquisition_staff_channel_assignments existing
  WHERE existing.channel_id=NEW.channel_id
    AND existing.lead_type<>NEW.lead_type
    AND existing.status='ACTIVE'
    AND NEW.effective_from<COALESCE(existing.effective_until,9223372036854775807)
    AND existing.effective_from<COALESCE(NEW.effective_until,9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_assignment_invalid_or_overlapping');
END;

CREATE TRIGGER trg_acquisition_assignment_revoke_only
BEFORE UPDATE ON acquisition_staff_channel_assignments
WHEN NOT (
  OLD.status='ACTIVE' AND NEW.status='REVOKED'
  AND NEW.id IS OLD.id AND NEW.staff_id IS OLD.staff_id
  AND NEW.lead_type IS OLD.lead_type AND NEW.channel_id IS OLD.channel_id
  AND NEW.effective_from IS OLD.effective_from
  AND NEW.effective_until IS OLD.effective_until
  AND NEW.created_by_staff_id IS OLD.created_by_staff_id
  AND NEW.created_at IS OLD.created_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND NEW.revoked_at IS NOT NULL AND NEW.revoke_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_assignment_invalid_update');
END;

CREATE TRIGGER trg_acquisition_assignments_no_delete
BEFORE DELETE ON acquisition_staff_channel_assignments
BEGIN SELECT RAISE(ABORT,'acquisition_assignments_are_immutable'); END;

CREATE TABLE acquisition_assignment_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  assignment_id TEXT NOT NULL REFERENCES acquisition_staff_channel_assignments(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED','REVOKED')),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE TRIGGER trg_acquisition_assignment_events_no_update
BEFORE UPDATE ON acquisition_assignment_events
BEGIN SELECT RAISE(ABORT,'acquisition_assignment_events_are_immutable'); END;
CREATE TRIGGER trg_acquisition_assignment_events_no_delete
BEFORE DELETE ON acquisition_assignment_events
BEGIN SELECT RAISE(ABORT,'acquisition_assignment_events_are_immutable'); END;

CREATE TABLE acquisition_daily_consultations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  business_date TEXT NOT NULL CHECK (
    business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(business_date)=business_date
  ),
  person_count INTEGER NOT NULL CHECK (person_count BETWEEN 0 AND 1000000),
  version INTEGER NOT NULL CHECK (version>=1),
  updated_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  UNIQUE(channel_id,business_date)
) STRICT;

CREATE INDEX idx_acquisition_consultations_date
ON acquisition_daily_consultations(business_date,channel_id);

CREATE TABLE acquisition_daily_consultation_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  consultation_id TEXT NOT NULL REFERENCES acquisition_daily_consultations(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('RECORDED','CORRECTED')),
  previous_count INTEGER CHECK (previous_count IS NULL OR previous_count>=0),
  next_count INTEGER NOT NULL CHECK (next_count BETWEEN 0 AND 1000000),
  previous_version INTEGER,
  next_version INTEGER NOT NULL CHECK (next_version>=1),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE TRIGGER trg_acquisition_consultation_events_no_update
BEFORE UPDATE ON acquisition_daily_consultation_events
BEGIN SELECT RAISE(ABORT,'acquisition_consultation_events_are_immutable'); END;
CREATE TRIGGER trg_acquisition_consultation_events_no_delete
BEFORE DELETE ON acquisition_daily_consultation_events
BEGIN SELECT RAISE(ABORT,'acquisition_consultation_events_are_immutable'); END;

CREATE TABLE acquisition_leads (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  identity_hash TEXT CHECK (
    identity_hash IS NULL OR (
      length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  identity_ciphertext TEXT,
  identity_iv TEXT,
  wechat_masked TEXT NOT NULL CHECK (length(wechat_masked) BETWEEN 1 AND 32),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name)<=100),
  note TEXT CHECK (note IS NULL OR length(note)<=1000),
  origin_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  origin_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  current_owner_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','INVALIDATED','ANONYMIZED')),
  invalidation_reason TEXT CHECK (
    invalidation_reason IS NULL OR length(invalidation_reason) BETWEEN 1 AND 1000
  ),
  retention_hold_reason TEXT CHECK (retention_hold_reason IN (
    'SECURITY','DISPUTE','LEGAL'
  )),
  version INTEGER NOT NULL CHECK (version>=1),
  created_business_date TEXT NOT NULL CHECK (
    created_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(created_business_date)=created_business_date
  ),
  latest_followup_at INTEGER NOT NULL CHECK (latest_followup_at>=0),
  retention_due_at INTEGER NOT NULL CHECK (retention_due_at>latest_followup_at),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  invalidated_at INTEGER,
  anonymized_at INTEGER,
  CHECK (
    (status='ACTIVE' AND identity_hash IS NOT NULL
      AND identity_ciphertext IS NOT NULL AND identity_iv IS NOT NULL
      AND invalidation_reason IS NULL AND invalidated_at IS NULL
      AND anonymized_at IS NULL)
    OR (status='INVALIDATED' AND identity_hash IS NOT NULL
      AND identity_ciphertext IS NOT NULL AND identity_iv IS NOT NULL
      AND invalidation_reason IS NOT NULL AND invalidated_at IS NOT NULL
      AND anonymized_at IS NULL)
    OR (status='ANONYMIZED' AND identity_hash IS NULL
      AND identity_ciphertext IS NULL AND identity_iv IS NULL
      AND invalidation_reason IS NULL AND invalidated_at IS NULL
      AND anonymized_at IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX uq_acquisition_active_identity_per_type
ON acquisition_leads(lead_type,identity_hash)
WHERE status='ACTIVE';
CREATE INDEX idx_acquisition_leads_origin_date
ON acquisition_leads(origin_channel_id,lead_type,created_business_date,status);
CREATE INDEX idx_acquisition_leads_owner
ON acquisition_leads(current_owner_staff_id,lead_type,status,created_at,id);
CREATE INDEX idx_acquisition_leads_retention
ON acquisition_leads(status,retention_due_at,id);

CREATE TRIGGER trg_acquisition_lead_immutable_origin
BEFORE UPDATE ON acquisition_leads
WHEN NEW.id IS NOT OLD.id
  OR NEW.lead_type IS NOT OLD.lead_type
  OR NEW.origin_channel_id IS NOT OLD.origin_channel_id
  OR NEW.origin_staff_id IS NOT OLD.origin_staff_id
  OR NEW.created_business_date IS NOT OLD.created_business_date
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'acquisition_lead_immutable_origin');
END;
CREATE TRIGGER trg_acquisition_leads_no_delete
BEFORE DELETE ON acquisition_leads
BEGIN SELECT RAISE(ABORT,'acquisition_leads_are_immutable'); END;

CREATE TABLE acquisition_lead_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  lead_id TEXT NOT NULL REFERENCES acquisition_leads(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'CREATED','FOLLOWED_UP','TRANSFERRED','INVALIDATED',
    'RETENTION_HOLD_SET','RETENTION_HOLD_CLEARED','ANONYMIZED'
  )),
  previous_version INTEGER,
  next_version INTEGER NOT NULL CHECK (next_version>=1),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','SYSTEM')),
  actor_id TEXT,
  idempotency_key TEXT CHECK (
    idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 128
  ),
  request_hash TEXT CHECK (
    request_hash IS NULL OR (
      length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE INDEX idx_acquisition_lead_events_lead
ON acquisition_lead_events(lead_id,created_at,id);
CREATE TRIGGER trg_acquisition_lead_events_no_update
BEFORE UPDATE ON acquisition_lead_events
BEGIN SELECT RAISE(ABORT,'acquisition_lead_events_are_immutable'); END;
CREATE TRIGGER trg_acquisition_lead_events_no_delete
BEFORE DELETE ON acquisition_lead_events
BEGIN SELECT RAISE(ABORT,'acquisition_lead_events_are_immutable'); END;

CREATE TABLE acquisition_lead_links (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  lead_id TEXT NOT NULL REFERENCES acquisition_leads(id),
  link_type TEXT NOT NULL CHECK (link_type IN (
    'IDENTITY_SUBJECT','BUYER_CUSTOMER','SELLER_MEMBER',
    'SELLER_ORGANIZATION','RESERVATION','FORMAL_ORDER'
  )),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 200),
  linked_at INTEGER NOT NULL CHECK (linked_at>=0),
  UNIQUE(lead_id,link_type,target_id)
) STRICT;
CREATE INDEX idx_acquisition_lead_links_target
ON acquisition_lead_links(link_type,target_id,lead_id);
CREATE TRIGGER trg_acquisition_lead_links_no_update
BEFORE UPDATE ON acquisition_lead_links
BEGIN SELECT RAISE(ABORT,'acquisition_lead_links_are_immutable'); END;
CREATE TRIGGER trg_acquisition_lead_links_no_delete
BEFORE DELETE ON acquisition_lead_links
BEGIN SELECT RAISE(ABORT,'acquisition_lead_links_are_immutable'); END;

CREATE TABLE acquisition_maintenance_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  lease_token TEXT,
  lease_expires_at INTEGER,
  link_claim_cursor TEXT CHECK (
    link_claim_cursor IS NULL OR length(link_claim_cursor) BETWEEN 1 AND 120
  ),
  last_started_at INTEGER,
  last_succeeded_at INTEGER,
  last_failed_at INTEGER,
  last_error_code TEXT,
  version INTEGER NOT NULL CHECK (version>=1),
  updated_at INTEGER NOT NULL CHECK (updated_at>=0),
  CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
) STRICT;
INSERT INTO acquisition_maintenance_state (
  singleton_id,version,updated_at
) VALUES (1,1,CAST(unixepoch('now') AS INTEGER)*1000);

CREATE TABLE acquisition_maintenance_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('CRON','DRY_RUN')),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED','SKIPPED')),
  linked_count INTEGER NOT NULL CHECK (linked_count>=0),
  anonymized_count INTEGER NOT NULL CHECK (anonymized_count>=0),
  exempt_count INTEGER NOT NULL CHECK (exempt_count>=0),
  failure_code TEXT,
  started_at INTEGER NOT NULL CHECK (started_at>=0),
  finished_at INTEGER NOT NULL CHECK (finished_at>=started_at)
) STRICT;
CREATE INDEX idx_acquisition_maintenance_runs_finished
ON acquisition_maintenance_runs(finished_at DESC,id);

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM acquisition_role_permission_defaults)=5
  AND NOT EXISTS (
    SELECT 1 FROM acquisition_role_permission_defaults
    WHERE role_code='buyer_refund'
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type='index' AND name='uq_acquisition_active_identity_per_type'
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=36,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=35;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
