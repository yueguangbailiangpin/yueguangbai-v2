PRAGMA foreign_keys = ON;

-- M13 is the only owner of schema 35.  This guard executes before any DDL so
-- wrong-order and repeat attempts roll back without leaving partial objects.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=34
) THEN 1 ELSE 0 END;

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

INSERT INTO staff_role_consolidation_cutovers (
  mapping_version, permission_catalog_version, permission_catalog_hash,
  source_schema_version, target_schema_version, active_staff_count, applied_at
)
SELECT
  'staff-four-role-v1',
  'staff-permissions-schema-35-v1',
  '2a9c6d7a128e669e202f9a5a0a7af7966e70df79326ed78c4e53448416c19eb3',
  34, 35,
  (SELECT COUNT(*) FROM staff_users WHERE status='ACTIVE'),
  CAST(unixepoch('now') AS INTEGER)*1000;

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

-- Direct single-role mappings are automatic.  Support roles or any multi-role
-- state require exactly one immutable owner approval bound to the exact source
-- roles, target, Staff authorization version and catalog version/hash.
WITH ordered_active_roles AS (
  SELECT staff_id, role_code
  FROM staff_role_assignments
  WHERE status='ACTIVE'
  ORDER BY staff_id, role_code
),
role_sets AS (
  SELECT
    staff_id,
    COUNT(*) AS role_count,
    MIN(role_code) AS only_role,
    json_group_array(role_code) AS source_roles_json
  FROM ordered_active_roles
  GROUP BY staff_id
),
approval_candidates AS (
  SELECT
    target.id AS staff_id,
    approval.id AS approval_audit_event_id,
    approval.actor_id AS approved_by_staff_id,
    json_extract(approval.next_state_json, '$.target_role') AS target_role,
    json_extract(approval.next_state_json, '$.mapping_hash') AS mapping_hash
  FROM audit_events approval
  JOIN staff_users target
    ON target.id=approval.aggregate_id AND target.status='ACTIVE'
  JOIN role_sets roles ON roles.staff_id=target.id
  JOIN staff_users approver
    ON approver.id=approval.actor_id AND approver.status='ACTIVE'
  JOIN staff_role_assignments approver_role
    ON approver_role.staff_id=approver.id
    AND approver_role.role_code='owner'
    AND approver_role.status='ACTIVE'
  WHERE approval.aggregate_type='STAFF_ROLE_CONSOLIDATION'
    AND approval.event_type='STAFF_ROLE_MAPPING_APPROVED'
    AND approval.actor_type='STAFF'
    AND json_valid(approval.next_state_json)
    AND json_extract(approval.next_state_json, '$.mapping_version')=
      'staff-four-role-v1'
    AND json_extract(approval.next_state_json, '$.permission_catalog_version')=
      'staff-permissions-schema-35-v1'
    AND json_extract(approval.next_state_json, '$.permission_catalog_hash')=
      '2a9c6d7a128e669e202f9a5a0a7af7966e70df79326ed78c4e53448416c19eb3'
    AND json_extract(approval.next_state_json, '$.staff_id')=target.id
    AND json_extract(approval.next_state_json, '$.authorization_version')=
      target.authorization_version
    AND json_extract(approval.next_state_json, '$.source_roles')=
      roles.source_roles_json
    AND json_extract(approval.next_state_json, '$.target_role') IN (
      'owner','pre_sales','seller_ops','buyer_refund'
    )
    AND typeof(json_extract(approval.next_state_json, '$.mapping_hash'))='text'
    AND length(json_extract(approval.next_state_json, '$.mapping_hash'))=64
    AND json_extract(approval.next_state_json, '$.mapping_hash')
      NOT GLOB '*[^0-9a-f]*'
),
approvals AS (
  SELECT
    staff_id,
    COUNT(*) AS approval_count,
    MIN(approval_audit_event_id) AS approval_audit_event_id,
    MIN(approved_by_staff_id) AS approved_by_staff_id,
    MIN(target_role) AS target_role,
    MIN(mapping_hash) AS mapping_hash
  FROM approval_candidates
  GROUP BY staff_id
)
INSERT INTO staff_role_consolidation_mappings (
  id, staff_id, mapping_version, source_roles_json, target_role_code,
  approval_required, approval_audit_event_id, approved_by_staff_id,
  approval_hash, authorization_version_before,
  authorization_version_after, applied_at
)
SELECT
  'm13-role-map-' || staff.id,
  staff.id,
  'staff-four-role-v1',
  roles.source_roles_json,
  CASE
    WHEN roles.role_count=1 AND roles.only_role='owner' THEN 'owner'
    WHEN roles.role_count=1 AND roles.only_role='pre_sales' THEN 'pre_sales'
    WHEN roles.role_count=1 AND roles.only_role='seller_ops' THEN 'seller_ops'
    WHEN roles.role_count=1 AND roles.only_role='after_sales' THEN 'buyer_refund'
    ELSE approvals.target_role
  END,
  CASE WHEN roles.role_count=1 AND roles.only_role IN (
    'owner','pre_sales','seller_ops','after_sales'
  ) THEN 0 ELSE 1 END,
  CASE WHEN roles.role_count=1 AND roles.only_role IN (
    'owner','pre_sales','seller_ops','after_sales'
  ) THEN NULL ELSE approvals.approval_audit_event_id END,
  CASE WHEN roles.role_count=1 AND roles.only_role IN (
    'owner','pre_sales','seller_ops','after_sales'
  ) THEN NULL ELSE approvals.approved_by_staff_id END,
  CASE WHEN roles.role_count=1 AND roles.only_role IN (
    'owner','pre_sales','seller_ops','after_sales'
  ) THEN NULL ELSE approvals.mapping_hash END,
  staff.authorization_version,
  staff.authorization_version+1,
  cutover.applied_at
FROM staff_users staff
JOIN role_sets roles ON roles.staff_id=staff.id
LEFT JOIN approvals ON approvals.staff_id=staff.id
CROSS JOIN staff_role_consolidation_cutovers cutover
WHERE staff.status='ACTIVE'
  AND (
    (roles.role_count=1 AND roles.only_role IN (
      'owner','pre_sales','seller_ops','after_sales'
    ))
    OR approvals.approval_count=1
  );

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM staff_role_consolidation_mappings)=
    (SELECT COUNT(*) FROM staff_users WHERE status='ACTIVE')
  AND NOT EXISTS (
    SELECT 1 FROM staff_role_consolidation_mappings mapping
    WHERE mapping.approval_required=1
      AND (mapping.approval_audit_event_id IS NULL
        OR mapping.approved_by_staff_id IS NULL
        OR mapping.approval_hash IS NULL)
  )
THEN 1 ELSE 0 END;

DROP TRIGGER trg_buyer_staff_assignments_staff_guard;
DROP TRIGGER trg_seller_staff_assignments_staff_guard;
DROP TRIGGER trg_staff_assignment_fallbacks_insert_guard;
DROP TRIGGER trg_staff_assignment_fallbacks_update_guard;
DROP TRIGGER trg_order_archive_closure_insert_guard;
DROP TRIGGER trg_order_archive_closure_reclose_source_guard;
DROP TRIGGER trg_order_archive_closure_update_guard;
DROP VIEW staff_effective_assignment_permissions;

CREATE TABLE staff_role_assignments_next (
  id TEXT PRIMARY KEY DEFAULT ('role-' || lower(hex(randomblob(16))))
    CHECK (length(id) BETWEEN 1 AND 200),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  role_code TEXT NOT NULL CHECK (
    (status='ACTIVE' AND role_code IN (
      'owner','pre_sales','seller_ops','buyer_refund'
    ))
    OR
    (status='REVOKED' AND role_code IN (
      'owner','pre_sales','seller_ops','buyer_refund',
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

INSERT INTO staff_role_assignments_next (
  id, staff_id, role_code, status, assigned_by_staff_id, assigned_at,
  revoked_at, revoked_by_staff_id, revoked_reason, created_at, updated_at
)
SELECT
  'm13-role-history-' || lower(hex(randomblob(16))),
  old.staff_id,
  old.role_code,
  CASE
    WHEN old.status='ACTIVE' AND staff.status='ACTIVE'
      AND mapping.target_role_code=old.role_code
      AND json_array_length(mapping.source_roles_json)=1
      THEN 'ACTIVE'
    WHEN old.status='ACTIVE' THEN 'REVOKED'
    ELSE old.status
  END,
  old.assigned_by_staff_id,
  old.assigned_at,
  CASE WHEN old.status='ACTIVE'
    AND NOT (staff.status='ACTIVE'
      AND mapping.target_role_code=old.role_code
      AND json_array_length(mapping.source_roles_json)=1)
    THEN cutover.applied_at ELSE old.revoked_at END,
  CASE WHEN old.status='ACTIVE'
    AND NOT (staff.status='ACTIVE'
      AND mapping.target_role_code=old.role_code
      AND json_array_length(mapping.source_roles_json)=1)
    THEN mapping.approved_by_staff_id ELSE NULL END,
  CASE WHEN old.status='ACTIVE'
    AND NOT (staff.status='ACTIVE'
      AND mapping.target_role_code=old.role_code
      AND json_array_length(mapping.source_roles_json)=1)
    THEN CASE WHEN staff.status='ACTIVE'
      THEN 'STAFF_ROLE_CONSOLIDATION'
      ELSE 'STAFF_INACTIVE_AT_ROLE_CONSOLIDATION' END
    ELSE NULL END,
  old.created_at,
  CASE WHEN old.status='ACTIVE'
    AND NOT (staff.status='ACTIVE'
      AND mapping.target_role_code=old.role_code
      AND json_array_length(mapping.source_roles_json)=1)
    THEN MAX(old.updated_at, cutover.applied_at)
    ELSE old.updated_at END
FROM staff_role_assignments old
JOIN staff_users staff ON staff.id=old.staff_id
LEFT JOIN staff_role_consolidation_mappings mapping
  ON mapping.staff_id=old.staff_id
CROSS JOIN staff_role_consolidation_cutovers cutover;

INSERT INTO staff_role_assignments_next (
  staff_id, role_code, status, assigned_by_staff_id, assigned_at,
  revoked_at, revoked_by_staff_id, revoked_reason, created_at, updated_at
)
SELECT
  mapping.staff_id,
  mapping.target_role_code,
  'ACTIVE',
  mapping.approved_by_staff_id,
  mapping.applied_at,
  NULL, NULL, NULL,
  mapping.applied_at,
  mapping.applied_at
FROM staff_role_consolidation_mappings mapping
WHERE NOT EXISTS (
  SELECT 1 FROM staff_role_assignments_next assignment
  WHERE assignment.staff_id=mapping.staff_id
    AND assignment.status='ACTIVE'
);

DROP TABLE staff_role_assignments;
ALTER TABLE staff_role_assignments_next RENAME TO staff_role_assignments;

CREATE UNIQUE INDEX uq_staff_role_assignment_one_active
ON staff_role_assignments(staff_id)
WHERE status='ACTIVE';

CREATE INDEX idx_staff_role_assignment_role_status
ON staff_role_assignments(role_code,status,staff_id);

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

CREATE TRIGGER trg_staff_role_assignments_no_delete
BEFORE DELETE ON staff_role_assignments
BEGIN
  SELECT RAISE(ABORT,'staff_role_assignments_are_immutable');
END;

CREATE TRIGGER trg_order_archive_closure_insert_guard
BEFORE INSERT ON order_archive_closures
WHEN NEW.status<>'CLOSED' OR NEW.version<>1 OR NEW.created_at<>NEW.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.confirmed_at<=NEW.business_closed_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.closed_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  )
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED'
      AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id
          AND entry.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund
    WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;

CREATE TRIGGER trg_order_archive_closure_update_guard
BEFORE UPDATE ON order_archive_closures
WHEN NOT (NEW.formal_order_id IS OLD.formal_order_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR (OLD.status='CLOSED' AND NEW.status='REOPENED' AND NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.reopened_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  ))
  OR NOT (
    (OLD.status='CLOSED' AND NEW.status='REOPENED'
      AND NEW.review_state IS OLD.review_state
      AND NEW.buyer_refund_state IS OLD.buyer_refund_state
      AND NEW.seller_principal_state IS OLD.seller_principal_state
      AND NEW.seller_service_fee_state IS OLD.seller_service_fee_state
      AND NEW.business_closed_at IS OLD.business_closed_at
      AND NEW.archive_due_at IS OLD.archive_due_at
      AND NEW.closed_by_staff_id IS OLD.closed_by_staff_id
      AND NEW.close_reason IS OLD.close_reason
      AND NEW.close_idempotency_key IS OLD.close_idempotency_key
      AND NEW.reopened_at IS NOT NULL
      AND NEW.reopened_by_staff_id IS NOT NULL
      AND NEW.reopen_reason IS NOT NULL
      AND NEW.reopen_idempotency_key IS NOT NULL)
    OR (OLD.status='REOPENED' AND NEW.status='CLOSED'
      AND NEW.closed_by_staff_id IS NOT NULL
      AND NEW.close_reason IS NOT NULL
      AND NEW.close_idempotency_key IS NOT NULL
      AND NEW.reopened_at IS NULL
      AND NEW.reopened_by_staff_id IS NULL
      AND NEW.reopen_reason IS NULL
      AND NEW.reopen_idempotency_key IS NULL)
  )
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_invalid_transition');
END;

CREATE TRIGGER trg_order_archive_closure_reclose_source_guard
BEFORE UPDATE ON order_archive_closures
WHEN OLD.status='REOPENED' AND NEW.status='CLOSED' AND (
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.confirmed_at<=NEW.business_closed_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.closed_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  )
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED'
      AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id
          AND entry.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund
    WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
)
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;

-- Rebuild the persisted default projection with only the four canonical roles.
CREATE TABLE staff_assignment_role_permission_defaults_next (
  role_code TEXT NOT NULL CHECK (role_code IN (
    'owner','pre_sales','seller_ops','buyer_refund'
  )),
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
    'ASSIGNMENT_AVAILABILITY_MANAGE'
  )),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY (role_code,permission_code)
) STRICT;

INSERT INTO staff_assignment_role_permission_defaults_next (
  role_code, permission_code, created_at
)
SELECT
  CASE role_code WHEN 'after_sales' THEN 'buyer_refund' ELSE role_code END,
  permission_code,
  created_at
FROM staff_assignment_role_permission_defaults
WHERE role_code IN ('owner','pre_sales','seller_ops','after_sales');

INSERT INTO staff_assignment_role_permission_defaults_next (
  role_code, permission_code, created_at
)
SELECT 'owner','SCHEDULED_OPERATIONS_RUN',applied_at
FROM staff_role_consolidation_cutovers;

DROP TABLE staff_assignment_role_permission_defaults;
ALTER TABLE staff_assignment_role_permission_defaults_next
  RENAME TO staff_assignment_role_permission_defaults;

CREATE TRIGGER trg_staff_assignment_role_permission_defaults_no_update
BEFORE UPDATE ON staff_assignment_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT,
    'staff_assignment_role_permission_defaults_are_immutable');
END;

CREATE TRIGGER trg_staff_assignment_role_permission_defaults_no_delete
BEFORE DELETE ON staff_assignment_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT,
    'staff_assignment_role_permission_defaults_are_immutable');
END;

-- Add the scheduled-operation permission to Personal DENY/GRANT persistence so
-- the existing final-DENY formula is enforceable for every published code.
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
    'ASSIGNMENT_AVAILABILITY_MANAGE'
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
SELECT
  staff_id,permission_code,effect,status,reason,assigned_by_staff_id,
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

-- Every active Staff authorization context changed at the cutover.  Invalidate
-- both authorization and session versions, revoke all old sessions, and append
-- immutable authorization/audit evidence.
UPDATE staff_sessions
SET
  status='REVOKED',
  revoked_at=(SELECT applied_at FROM staff_role_consolidation_cutovers),
  revoked_reason='STAFF_ROLE_CONSOLIDATION',
  updated_at=MAX(
    updated_at,
    (SELECT applied_at FROM staff_role_consolidation_cutovers)
  )
WHERE status='ACTIVE';

UPDATE staff_users
SET
  authorization_version=authorization_version+1,
  session_version=session_version+1,
  version=version+1,
  updated_at=MAX(
    updated_at,
    (SELECT applied_at FROM staff_role_consolidation_cutovers)
  )
WHERE status='ACTIVE';

INSERT INTO staff_authorization_events (
  id,staff_id,authorization_version,event_type,actor_staff_id,
  request_id,idempotency_key,change_summary_json,created_at
)
SELECT
  'm13-auth-' || lower(hex(randomblob(16))),
  mapping.staff_id,
  mapping.authorization_version_after,
  'STAFF_ROLE_CONSOLIDATED',
  mapping.approved_by_staff_id,
  NULL,NULL,
  json_object(
    'mapping_version',mapping.mapping_version,
    'source_roles',json(mapping.source_roles_json),
    'target_role',mapping.target_role_code,
    'approval_required',json(CASE mapping.approval_required
      WHEN 1 THEN 'true' ELSE 'false' END),
    'approval_audit_event_id',mapping.approval_audit_event_id,
    'approval_hash',mapping.approval_hash
  ),
  mapping.applied_at
FROM staff_role_consolidation_mappings mapping;

INSERT INTO audit_events (
  id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,
  actor_roles_json,request_id,idempotency_key,previous_state_json,
  next_state_json,reason,metadata_json,created_at
)
SELECT
  'm13-role-cutover-' || mapping.staff_id,
  'STAFF_ROLE_CONSOLIDATION',
  mapping.staff_id,
  'STAFF_ROLE_CONSOLIDATED',
  CASE WHEN mapping.approved_by_staff_id IS NULL THEN 'SYSTEM' ELSE 'STAFF' END,
  mapping.approved_by_staff_id,
  CASE WHEN mapping.approved_by_staff_id IS NULL THEN '[]' ELSE '["owner"]' END,
  NULL,NULL,
  json_object(
    'authorization_version',mapping.authorization_version_before,
    'active_roles',json(mapping.source_roles_json)
  ),
  json_object(
    'authorization_version',mapping.authorization_version_after,
    'active_role',mapping.target_role_code,
    'sessions_revoked',json('true')
  ),
  'STAFF_ROLE_CONSOLIDATION',
  json_object(
    'mapping_version',mapping.mapping_version,
    'approval_audit_event_id',mapping.approval_audit_event_id,
    'approval_hash',mapping.approval_hash
  ),
  mapping.applied_at
FROM staff_role_consolidation_mappings mapping;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1 FROM staff_users staff
    WHERE staff.status='ACTIVE'
      AND 1<>(
        SELECT COUNT(*) FROM staff_role_assignments assignment
        WHERE assignment.staff_id=staff.id AND assignment.status='ACTIVE'
          AND assignment.role_code IN (
            'owner','pre_sales','seller_ops','buyer_refund'
          )
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM staff_role_assignments
    WHERE status='ACTIVE' AND role_code NOT IN (
      'owner','pre_sales','seller_ops','buyer_refund'
    )
  )
  AND NOT EXISTS (SELECT 1 FROM staff_sessions WHERE status='ACTIVE')
  AND NOT EXISTS (
    SELECT 1 FROM staff_role_consolidation_mappings mapping
    JOIN staff_users staff ON staff.id=mapping.staff_id
    WHERE staff.authorization_version<>mapping.authorization_version_after
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=35,installed_at=(
  SELECT applied_at FROM staff_role_consolidation_cutovers
)
WHERE singleton_id=1 AND schema_version=34;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
