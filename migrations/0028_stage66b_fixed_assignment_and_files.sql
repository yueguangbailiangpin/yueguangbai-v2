-- Stage 6.6B (D-056): four fixed staff roles with duty-based fixed
-- assignment (no pool/round-robin/fallback/availability/reassignment/org
-- chart), seller organization-wide member visibility with product primary
-- contacts, one-time reservation participation exceptions, unified
-- ORDER_COMMUNICATION_SCREENSHOT files, and exactly one payment screenshot
-- per order evidence version. Forward-only; no production data exists.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=27 THEN 1 ELSE 0 END;


-- Retire every trigger touching rebuilt/dropped objects up front so no
-- dangling reference survives any intermediate statement.

DROP TRIGGER IF EXISTS trg_acquisition_assignment_insert_guard;
DROP TRIGGER IF EXISTS trg_archive_bundle_files_insert_guard;
DROP TRIGGER IF EXISTS trg_buyer_advance_principal_entry_files_guard;
DROP TRIGGER IF EXISTS trg_buyer_refund_payment_entry_file_guard;
DROP TRIGGER IF EXISTS trg_buyer_staff_assignments_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_staff_assignments_revoke_only;
DROP TRIGGER IF EXISTS trg_buyer_staff_assignments_staff_guard;
DROP TRIGGER IF EXISTS trg_explicit_file_link_revoke_only;
DROP TRIGGER IF EXISTS trg_file_audience_grant_link_guard;
DROP TRIGGER IF EXISTS trg_file_entity_links_verified_guard;
DROP TRIGGER IF EXISTS trg_file_objects_intent_guard;
DROP TRIGGER IF EXISTS trg_file_objects_verified_guard;
DROP TRIGGER IF EXISTS trg_file_read_intent_link_guard;
DROP TRIGGER IF EXISTS trg_file_read_intents_verified_guard;
DROP TRIGGER IF EXISTS trg_formal_order_financial_self_pay_guard;
DROP TRIGGER IF EXISTS trg_formal_order_instruction_guard;
DROP TRIGGER IF EXISTS trg_formal_order_number_claim_source_guard;
DROP TRIGGER IF EXISTS trg_formal_order_number_claim_transition_guard;
DROP TRIGGER IF EXISTS trg_formal_order_source_guard;
DROP TRIGGER IF EXISTS trg_order_archive_closure_insert_guard;
DROP TRIGGER IF EXISTS trg_order_archive_closure_reclose_source_guard;
DROP TRIGGER IF EXISTS trg_order_archive_closure_update_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_duplicate_signal_after_version;
DROP TRIGGER IF EXISTS trg_order_evidence_event_identity_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_instruction_snapshot_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_internal_files_no_delete;
DROP TRIGGER IF EXISTS trg_order_evidence_internal_files_no_update;
DROP TRIGGER IF EXISTS trg_order_evidence_single_image_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_version_file_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_version_files_no_delete;
DROP TRIGGER IF EXISTS trg_order_evidence_version_files_no_update;
DROP TRIGGER IF EXISTS trg_order_evidence_version_submission_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_versions_no_delete;
DROP TRIGGER IF EXISTS trg_order_evidence_versions_no_update;
DROP TRIGGER IF EXISTS trg_order_instruction_historical_marker_guard;
DROP TRIGGER IF EXISTS trg_order_instruction_version_main_image_guard;
DROP TRIGGER IF EXISTS trg_product_image_file_links_no_delete;
DROP TRIGGER IF EXISTS trg_product_image_file_links_no_update;
DROP TRIGGER IF EXISTS trg_product_version_main_image_guard;
DROP TRIGGER IF EXISTS trg_review_evidence_version_file_guard;
DROP TRIGGER IF EXISTS trg_seller_member_portal_grant_no_delete;
DROP TRIGGER IF EXISTS trg_seller_member_portal_grant_no_update;
DROP TRIGGER IF EXISTS trg_seller_member_portal_grant_scope_guard;
DROP TRIGGER IF EXISTS trg_seller_payment_proof_guard;
DROP TRIGGER IF EXISTS trg_seller_scope_events_no_delete;
DROP TRIGGER IF EXISTS trg_seller_scope_events_no_update;
DROP TRIGGER IF EXISTS trg_seller_staff_assignments_staff_guard;
DROP TRIGGER IF EXISTS trg_staff_assignment_fallbacks_insert_guard;
DROP TRIGGER IF EXISTS trg_staff_assignment_fallbacks_update_guard;
DROP TRIGGER IF EXISTS trg_staff_assignment_role_permission_defaults_no_delete;
DROP TRIGGER IF EXISTS trg_staff_assignment_role_permission_defaults_no_update;
DROP TRIGGER IF EXISTS trg_staff_permission_override_deny_only_insert;
DROP TRIGGER IF EXISTS trg_staff_permission_override_deny_only_update;
DROP TRIGGER IF EXISTS trg_staff_reactivated_restore_primary_scope;
DROP TRIGGER IF EXISTS trg_staff_role_assignments_no_delete;
DROP TRIGGER IF EXISTS trg_staff_role_assignments_revoke_only;
DROP TRIGGER IF EXISTS trg_staff_work_item_marketplace_after_insert;
DROP TRIGGER IF EXISTS trg_staff_work_items_assignment_guard;
DROP TRIGGER IF EXISTS trg_staff_work_items_no_delete;
DROP TRIGGER IF EXISTS trg_staff_work_items_update_guard;

DROP VIEW IF EXISTS staff_effective_assignment_permissions;



-- ===== staff_role_assignments =====
CREATE TABLE "staff_role_assignments_stage66b_new" (
  id TEXT PRIMARY KEY DEFAULT ('role-' || lower(hex(randomblob(16))))
    CHECK (length(id) BETWEEN 1 AND 200),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  role_code TEXT NOT NULL CHECK (
    (status='ACTIVE' AND role_code IN (
      'owner','pre_sales','seller_ops','buyer_refund'
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
INSERT INTO staff_role_assignments_stage66b_new (id, staff_id, role_code, status, assigned_by_staff_id, assigned_at, revoked_at, revoked_by_staff_id, revoked_reason, created_at, updated_at) SELECT id, staff_id, role_code, status, assigned_by_staff_id, assigned_at, revoked_at, revoked_by_staff_id, revoked_reason, created_at, updated_at FROM staff_role_assignments;
DROP TABLE staff_role_assignments;
ALTER TABLE staff_role_assignments_stage66b_new RENAME TO staff_role_assignments;

-- ===== staff_marketplace_scopes =====
CREATE TABLE staff_marketplace_scopes_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  role_code TEXT NOT NULL CHECK (role_code IN (
    'pre_sales','seller_ops','buyer_refund'
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
INSERT INTO staff_marketplace_scopes_stage66b_new (id, staff_id, role_code, marketplace_code, status, assigned_by_staff_id, assigned_at, revoked_at, reason, created_at, updated_at, scope_kind) SELECT id, staff_id, role_code, marketplace_code, status, assigned_by_staff_id, assigned_at, revoked_at, reason, created_at, updated_at, scope_kind FROM staff_marketplace_scopes;
DROP TABLE staff_marketplace_scopes;
ALTER TABLE staff_marketplace_scopes_stage66b_new RENAME TO staff_marketplace_scopes;

-- ===== staff_permission_overrides =====
CREATE TABLE "staff_permission_overrides_stage66b_new" (
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
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND','ASSIGNMENT_AVAILABILITY_MANAGE','ACQUISITION_ADMIN',
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
INSERT INTO staff_permission_overrides_stage66b_new (staff_id, permission_code, effect, status, reason, assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at) SELECT staff_id, permission_code, effect, status, reason, assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at FROM staff_permission_overrides;
DROP TABLE staff_permission_overrides;
ALTER TABLE staff_permission_overrides_stage66b_new RENAME TO staff_permission_overrides;

DELETE FROM staff_assignment_role_permission_defaults
WHERE permission_code IN (
  'TASK_VIEW_OPEN','TASK_CLAIM','TASK_VIEW_TEAM','TASK_ASSIGN_TEAM',
  'TASK_REASSIGN_TEAM','TASK_TAKEOVER_TEAM','TASK_COLLABORATE_TEAM',
  'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES','ASSIGNMENT_BATCH_TRANSFER',
  'ASSIGNMENT_AVAILABILITY_MANAGE'
);

-- ===== staff_assignment_role_permission_defaults =====
CREATE TABLE "staff_assignment_role_permission_defaults_stage66b_new" (
  role_code TEXT NOT NULL CHECK (role_code IN (
    'owner','pre_sales','seller_ops','buyer_refund'
  )),
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
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY (role_code,permission_code)
) STRICT;
INSERT INTO staff_assignment_role_permission_defaults_stage66b_new (role_code, permission_code, created_at) SELECT role_code, permission_code, created_at FROM staff_assignment_role_permission_defaults;
DROP TABLE staff_assignment_role_permission_defaults;
ALTER TABLE staff_assignment_role_permission_defaults_stage66b_new RENAME TO staff_assignment_role_permission_defaults;

DROP TABLE staff_assignment_cursors;
DROP TABLE staff_assignment_fallbacks;
DROP TABLE staff_availability;
DROP TABLE staff_reassignment_batches;
DROP TABLE staff_reassignment_batch_items;
DROP TABLE staff_departments;
DROP TABLE staff_teams;
DROP TABLE staff_team_memberships;
DROP TABLE staff_team_leaders;
DROP TABLE staff_role_consolidation_cutovers;
DROP TABLE staff_role_consolidation_mappings;


-- ===== buyer_staff_assignments =====
CREATE TABLE buyer_staff_assignments_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'BUYER_PRE_SALES_OWNER',
    'BUYER_REFUND_OWNER'
  )),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  source TEXT NOT NULL CHECK (source IN (
    'AUTO_INITIAL', 'MANUAL_REASSIGN'
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
INSERT INTO buyer_staff_assignments_stage66b_new (id, buyer_customer_id, duty_code, staff_id, status, source, assigned_by_actor_type, assigned_by_actor_id, reason, version, created_at, updated_at, revoked_at) SELECT id, buyer_customer_id, duty_code, staff_id, status, source, assigned_by_actor_type, assigned_by_actor_id, reason, version, created_at, updated_at, revoked_at FROM buyer_staff_assignments;
DROP TABLE buyer_staff_assignments;
ALTER TABLE buyer_staff_assignments_stage66b_new RENAME TO buyer_staff_assignments;

UPDATE buyer_staff_assignments
SET duty_code='BUYER_REFUND_OWNER'
WHERE duty_code='BUYER_AFTER_SALES_OWNER';

-- ===== staff_work_items =====
CREATE TABLE "staff_work_items_stage66b_new" (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  work_type TEXT NOT NULL CHECK (work_type IN (
    'PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW','RESERVATION_DECISION',
    'ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW','REVIEW_DECISION',
    'BUYER_REFUND_PROCESSING'
  )),
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN (
    'PRODUCT_APPLICATION','DEMAND_BATCH','RESERVATION','ORDER_INSTRUCTION',
    'ORDER_EVIDENCE','REVIEW_CASE','BUYER_REFUND_OBLIGATION'
  )),
  source_entity_id TEXT NOT NULL CHECK (length(source_entity_id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT REFERENCES buyer_customers(id),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  store_id TEXT REFERENCES seller_stores(id),
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'SELLER_ACCOUNT_MANAGER','BUYER_PRE_SALES_OWNER','BUYER_REFUND_OWNER'
  )),
  fixed_assignment_type TEXT NOT NULL CHECK (
    fixed_assignment_type IN ('BUYER','SELLER')
  ),
  fixed_assignment_id TEXT NOT NULL CHECK (length(fixed_assignment_id) BETWEEN 1 AND 200),
  assigned_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER,
  cancelled_at INTEGER, marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR'
  )),
  CHECK (
    (work_type IN ('PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW')
      AND source_entity_type IN ('PRODUCT_APPLICATION','DEMAND_BATCH')
      AND duty_code='SELLER_ACCOUNT_MANAGER'
      AND fixed_assignment_type='SELLER'
      AND seller_organization_id IS NOT NULL)
    OR
    (work_type IN (
        'RESERVATION_DECISION','ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW'
      )
      AND source_entity_type IN (
        'RESERVATION','ORDER_INSTRUCTION','ORDER_EVIDENCE'
      )
      AND duty_code='BUYER_PRE_SALES_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
    OR
    (work_type='REVIEW_DECISION'
      AND source_entity_type='REVIEW_CASE'
      AND duty_code='BUYER_REFUND_OWNER'
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
    OR (status='COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='CANCELLED' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  )
) STRICT;
INSERT INTO staff_work_items_stage66b_new (id, work_type, source_entity_type, source_entity_id, buyer_customer_id, seller_organization_id, store_id, duty_code, fixed_assignment_type, fixed_assignment_id, assigned_staff_id, status, version, created_at, updated_at, completed_at, cancelled_at, marketplace_code) SELECT id, work_type, source_entity_type, source_entity_id, buyer_customer_id, seller_organization_id, store_id, duty_code, fixed_assignment_type, fixed_assignment_id, assigned_staff_id, status, version, created_at, updated_at, completed_at, cancelled_at, marketplace_code FROM staff_work_items;
DROP TABLE staff_work_items;
ALTER TABLE staff_work_items_stage66b_new RENAME TO staff_work_items;

UPDATE staff_work_items
SET duty_code='BUYER_REFUND_OWNER'
WHERE duty_code='BUYER_AFTER_SALES_OWNER';

DROP TABLE seller_member_portal_store_grants;
DROP TABLE seller_member_store_scopes;
DROP TABLE seller_member_store_scope_events;

-- ===== products =====
CREATE TABLE "products_stage66b_new" (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL,
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
  asin_display TEXT NOT NULL
    CHECK (length(asin_display)=10),
  asin_normalized TEXT NOT NULL
    CHECK (
      length(asin_normalized)=10
      AND asin_normalized NOT GLOB '*[^A-Z0-9]*'
    ),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  primary_contact_member_id TEXT
    REFERENCES seller_organization_members(id),
  current_version_no INTEGER NOT NULL
    CHECK (current_version_no >= 1),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  disabled_at INTEGER,
  UNIQUE (
    marketplace_code,
    asin_normalized
  ),
  UNIQUE (
    id,
    organization_id
  ),
  FOREIGN KEY (
    store_id,
    organization_id,
    marketplace_code
  ) REFERENCES seller_stores (
    id,
    organization_id,
    marketplace_code
  ),
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;
INSERT INTO products_stage66b_new (id, organization_id, store_id, marketplace_code, asin_display, asin_normalized, status, current_version_no, version, created_at, updated_at, disabled_at) SELECT id, organization_id, store_id, marketplace_code, asin_display, asin_normalized, status, current_version_no, version, created_at, updated_at, disabled_at FROM products;
DROP TABLE products;
ALTER TABLE products_stage66b_new RENAME TO products;

CREATE TABLE seller_product_primary_contact_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  product_id TEXT NOT NULL REFERENCES products(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  previous_member_id TEXT REFERENCES seller_organization_members(id),
  next_member_id TEXT REFERENCES seller_organization_members(id),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_seller_product_primary_contact_events_product
ON seller_product_primary_contact_events (product_id, created_at, id);

CREATE TRIGGER trg_seller_product_primary_contact_events_no_delete
BEFORE DELETE ON seller_product_primary_contact_events
BEGIN
  SELECT RAISE(ABORT, 'seller_product_primary_contact_event_is_immutable');
END;

CREATE TRIGGER trg_seller_product_primary_contact_events_no_update
BEFORE UPDATE ON seller_product_primary_contact_events
BEGIN
  SELECT RAISE(ABORT, 'seller_product_primary_contact_event_is_immutable');
END;

CREATE TRIGGER trg_seller_product_primary_contact_member_guard
BEFORE UPDATE OF primary_contact_member_id ON products
WHEN NEW.primary_contact_member_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM seller_organization_members member
  WHERE member.id=NEW.primary_contact_member_id
    AND member.organization_id=NEW.organization_id
    AND member.status='ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT, 'product_primary_contact_must_be_active_member');
END;

CREATE TRIGGER trg_seller_product_primary_contact_insert_guard
BEFORE INSERT ON products
WHEN NEW.primary_contact_member_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM seller_organization_members member
  WHERE member.id=NEW.primary_contact_member_id
    AND member.organization_id=NEW.organization_id
    AND member.status='ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT, 'product_primary_contact_must_be_active_member');
END;

CREATE TABLE reservation_participation_exceptions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  demand_batch_id TEXT NOT NULL REFERENCES demand_batches(id),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  valid_until INTEGER NOT NULL CHECK (valid_until >= 0),
  used_at INTEGER,
  used_by_reservation_id TEXT REFERENCES product_reservations(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (used_at IS NULL OR used_at >= created_at)
) STRICT;

CREATE INDEX idx_reservation_participation_exceptions_buyer
ON reservation_participation_exceptions (
  buyer_customer_id, seller_organization_id, demand_batch_id, created_at, id
);

CREATE TRIGGER trg_reservation_participation_exceptions_no_update
BEFORE UPDATE ON reservation_participation_exceptions
WHEN OLD.used_at IS NOT NULL
   OR NEW.buyer_customer_id<>OLD.buyer_customer_id
   OR NEW.seller_organization_id<>OLD.seller_organization_id
   OR NEW.demand_batch_id<>OLD.demand_batch_id
   OR NEW.reason<>OLD.reason
   OR NEW.created_by_staff_id<>OLD.created_by_staff_id
   OR NEW.valid_until<>OLD.valid_until
   OR NEW.created_at<>OLD.created_at
   OR NEW.used_at IS NULL
   OR (OLD.used_by_reservation_id IS NULL
     AND NEW.used_by_reservation_id IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'reservation_participation_exception_is_immutable_once_used');
END;

CREATE TRIGGER trg_reservation_participation_exceptions_no_delete
BEFORE DELETE ON reservation_participation_exceptions
WHEN OLD.used_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'used_reservation_participation_exception_cannot_be_deleted');
END;

-- ===== file_upload_intents =====
CREATE TABLE file_upload_intents_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  owner_actor_type TEXT NOT NULL CHECK (owner_actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  owner_actor_id TEXT NOT NULL CHECK (length(owner_actor_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE','PRODUCT_IMAGE','ORDER_EVIDENCE',
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_COMMUNICATION_SCREENSHOT',
    'REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF',
    'SUPPORT_ATTACHMENT'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'ISSUED','VERIFYING','VERIFIED','FAILED','EXPIRED','CANCELLED'
  )),
  requested_file_count INTEGER NOT NULL CHECK (requested_file_count BETWEEN 1 AND 10),
  manifest_hash TEXT NOT NULL CHECK (
    length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (
    (status IN ('ISSUED','VERIFYING') AND completed_at IS NULL AND failure_code IS NULL)
    OR (status='VERIFIED' AND completed_at IS NOT NULL AND failure_code IS NULL)
    OR (status IN ('FAILED','EXPIRED','CANCELLED') AND completed_at IS NOT NULL)
  )
) STRICT;
INSERT INTO file_upload_intents_stage66b_new (id, owner_actor_type, owner_actor_id, purpose, visibility, status, requested_file_count, manifest_hash, version, expires_at, failure_code, created_at, updated_at, completed_at) SELECT id, owner_actor_type, owner_actor_id, CASE WHEN purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION' THEN 'ORDER_COMMUNICATION_SCREENSHOT' ELSE purpose END, visibility, status, requested_file_count, manifest_hash, version, expires_at, failure_code, created_at, updated_at, completed_at FROM file_upload_intents;
DROP TABLE file_upload_intents;
ALTER TABLE file_upload_intents_stage66b_new RENAME TO file_upload_intents;

-- ===== file_objects =====
CREATE TABLE file_objects_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  upload_intent_id TEXT NOT NULL REFERENCES file_upload_intents(id),
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 1 AND 10),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE','PRODUCT_IMAGE','ORDER_EVIDENCE',
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_COMMUNICATION_SCREENSHOT',
    'REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF',
    'SUPPORT_ATTACHMENT'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  object_key TEXT NOT NULL UNIQUE CHECK (
    length(object_key) BETWEEN 40 AND 300
    AND object_key GLOB 'files/v1/*'
    AND object_key NOT GLOB '*[^a-z0-9/_-]*'
  ),
  client_file_name TEXT NOT NULL CHECK (length(client_file_name) BETWEEN 3 AND 180),
  extension TEXT NOT NULL CHECK (extension IN ('jpg','jpeg','png','webp','pdf')),
  declared_mime TEXT NOT NULL CHECK (declared_mime IN (
    'image/jpeg','image/png','image/webp','application/pdf'
  )),
  expected_byte_size INTEGER NOT NULL CHECK (expected_byte_size BETWEEN 1 AND 26214400),
  status TEXT NOT NULL CHECK (status IN (
    'RESERVED','UPLOADED','VERIFIED','REJECTED','DELETION_PENDING','DELETED'
  )),
  upload_token_hash TEXT NOT NULL CHECK (
    length(upload_token_hash)=64 AND upload_token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  upload_expires_at INTEGER NOT NULL CHECK (upload_expires_at >= 0),
  uploaded_byte_size INTEGER CHECK (uploaded_byte_size IS NULL OR uploaded_byte_size >= 1),
  detected_mime TEXT CHECK (detected_mime IS NULL OR detected_mime IN (
    'image/jpeg','image/png','image/webp','application/pdf'
  )),
  uploaded_sha256 TEXT CHECK (
    uploaded_sha256 IS NULL OR (
      length(uploaded_sha256)=64 AND uploaded_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
  delete_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (delete_attempt_count >= 0),
  next_delete_at INTEGER CHECK (next_delete_at IS NULL OR next_delete_at >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  uploaded_at INTEGER,
  verified_at INTEGER,
  deleted_at INTEGER,
  UNIQUE (upload_intent_id,slot_no),
  CHECK (upload_expires_at >= created_at),
  CHECK (
    (status='RESERVED' AND uploaded_byte_size IS NULL AND detected_mime IS NULL
      AND uploaded_sha256 IS NULL AND uploaded_at IS NULL
      AND verified_at IS NULL AND deleted_at IS NULL)
    OR (status='REJECTED' AND verified_at IS NULL AND deleted_at IS NULL
      AND failure_code IS NOT NULL)
    OR (status IN ('UPLOADED','VERIFIED','DELETION_PENDING','DELETED')
      AND uploaded_byte_size IS NOT NULL AND detected_mime IS NOT NULL
      AND uploaded_sha256 IS NOT NULL AND uploaded_at IS NOT NULL)
  ),
  CHECK (
    (status='VERIFIED' AND verified_at IS NOT NULL AND deleted_at IS NULL)
    OR (status<>'VERIFIED' AND verified_at IS NULL)
  ),
  CHECK (
    (status='DELETION_PENDING' AND failure_code IS NOT NULL
      AND next_delete_at IS NOT NULL AND deleted_at IS NULL)
    OR (status='DELETED' AND failure_code IS NOT NULL
      AND next_delete_at IS NULL AND deleted_at IS NOT NULL)
    OR (status NOT IN ('DELETION_PENDING','DELETED'))
  ),
  CHECK (
    (declared_mime='image/jpeg' AND extension IN ('jpg','jpeg'))
    OR (declared_mime='image/png' AND extension='png')
    OR (declared_mime='image/webp' AND extension='webp')
    OR (declared_mime='application/pdf' AND extension='pdf')
  ),
  CHECK (
    purpose<>'ORDER_INSTRUCTION_KEYWORD_IMAGE'
    OR (declared_mime='image/png' AND extension='png')
  ),
  CHECK (
    purpose<>'ORDER_COMMUNICATION_SCREENSHOT'
    OR declared_mime IN ('image/jpeg','image/png','image/webp')
  )
) STRICT;
INSERT INTO file_objects_stage66b_new (id, upload_intent_id, slot_no, purpose, visibility, object_key, client_file_name, extension, declared_mime, expected_byte_size, status, upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime, uploaded_sha256, failure_code, delete_attempt_count, next_delete_at, version, created_at, updated_at, uploaded_at, verified_at, deleted_at) SELECT id, upload_intent_id, slot_no, CASE WHEN purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION' THEN 'ORDER_COMMUNICATION_SCREENSHOT' ELSE purpose END, visibility, object_key, client_file_name, extension, declared_mime, expected_byte_size, status, upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime, uploaded_sha256, failure_code, delete_attempt_count, next_delete_at, version, created_at, updated_at, uploaded_at, verified_at, deleted_at FROM file_objects;
DROP TABLE file_objects;
ALTER TABLE file_objects_stage66b_new RENAME TO file_objects;

-- ===== file_entity_links =====
CREATE TABLE file_entity_links_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'PRODUCT_APPLICATION','PRODUCT_VERSION','ORDER_INSTRUCTION_VERSION',
    'ORDER_EVIDENCE_SUBMISSION','ORDER','REVIEW','BUYER_REFUND',
    'SELLER_SETTLEMENT','SUPPORT_CASE'
  )),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE','PRODUCT_IMAGE','ORDER_EVIDENCE',
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_COMMUNICATION_SCREENSHOT',
    'REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF',
    'SUPPORT_ATTACHMENT'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  linked_by_actor_type TEXT NOT NULL CHECK (linked_by_actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  linked_by_actor_id TEXT NOT NULL CHECK (length(linked_by_actor_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  authorization_mode TEXT NOT NULL DEFAULT 'LEGACY_VISIBILITY'
    CHECK (authorization_mode IN ('LEGACY_VISIBILITY','EXPLICIT_AUDIENCES')),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= created_at),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (file_object_id,entity_type,entity_id),
  CHECK (
    (purpose='PRODUCT_APPLICATION_IMAGE' AND entity_type='PRODUCT_APPLICATION')
    OR (purpose='PRODUCT_IMAGE'
      AND entity_type IN ('PRODUCT_VERSION','ORDER_INSTRUCTION_VERSION'))
    OR (purpose='ORDER_INSTRUCTION_KEYWORD_IMAGE'
      AND entity_type='ORDER_INSTRUCTION_VERSION')
    OR (purpose='ORDER_COMMUNICATION_SCREENSHOT'
      AND entity_type='ORDER')
    OR (purpose='ORDER_EVIDENCE' AND entity_type='ORDER')
    OR (purpose='REVIEW_EVIDENCE' AND entity_type='REVIEW')
    OR (purpose='BUYER_REFUND_PROOF' AND entity_type='BUYER_REFUND')
    OR (purpose='SELLER_SETTLEMENT_PROOF' AND entity_type='SELLER_SETTLEMENT')
    OR (purpose='SUPPORT_ATTACHMENT' AND entity_type='SUPPORT_CASE')
  )
) STRICT;
INSERT INTO file_entity_links_stage66b_new (id, file_object_id, entity_type, entity_id, purpose, visibility, linked_by_actor_type, linked_by_actor_id, created_at, authorization_mode, expires_at, revoked_at) SELECT id, file_object_id, entity_type, entity_id, purpose, visibility, linked_by_actor_type, linked_by_actor_id, created_at, authorization_mode, expires_at, revoked_at FROM file_entity_links;
DROP TABLE file_entity_links;
ALTER TABLE file_entity_links_stage66b_new RENAME TO file_entity_links;

-- ===== file_entity_audience_grants =====
-- Rebuilt without the staff_teams foreign key: the team subject is retired
-- (D-056) and staff_team_id stays as an always-NULL compatibility column,
-- otherwise every INSERT would fail to resolve the dropped parent table.
CREATE TABLE file_entity_audience_grants_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  file_entity_link_id TEXT NOT NULL REFERENCES file_entity_links(id),
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'BUYER','SELLER_ORGANIZATION','STAFF_INTERNAL'
  )),
  buyer_customer_id TEXT REFERENCES buyer_customers(id),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  staff_permission_code TEXT CHECK (
    staff_permission_code IS NULL OR length(staff_permission_code) BETWEEN 1 AND 100
  ),
  staff_scope_type TEXT CHECK (
    staff_scope_type IS NULL OR staff_scope_type IN ('GLOBAL','TEAM')
  ),
  staff_team_id TEXT,
  granted_by_actor_type TEXT NOT NULL CHECK (granted_by_actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  granted_by_actor_id TEXT NOT NULL CHECK (length(granted_by_actor_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at > created_at),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (
    (subject_type='BUYER' AND buyer_customer_id IS NOT NULL
      AND seller_organization_id IS NULL AND staff_permission_code IS NULL
      AND staff_scope_type IS NULL AND staff_team_id IS NULL)
    OR (subject_type='SELLER_ORGANIZATION' AND buyer_customer_id IS NULL
      AND seller_organization_id IS NOT NULL AND staff_permission_code IS NULL
      AND staff_scope_type IS NULL AND staff_team_id IS NULL)
    OR (subject_type='STAFF_INTERNAL' AND buyer_customer_id IS NULL
      AND seller_organization_id IS NULL AND staff_permission_code IS NOT NULL
      AND staff_scope_type IS NOT NULL
      AND ((staff_scope_type='GLOBAL' AND staff_team_id IS NULL)
        OR (staff_scope_type='TEAM' AND staff_team_id IS NOT NULL)))
  )
) STRICT;
INSERT INTO file_entity_audience_grants_stage66b_new (id, file_entity_link_id, subject_type, buyer_customer_id, seller_organization_id, staff_permission_code, staff_scope_type, staff_team_id, granted_by_actor_type, granted_by_actor_id, created_at, expires_at, revoked_at) SELECT id, file_entity_link_id, subject_type, buyer_customer_id, seller_organization_id, staff_permission_code, staff_scope_type, staff_team_id, granted_by_actor_type, granted_by_actor_id, created_at, expires_at, revoked_at FROM file_entity_audience_grants;
DROP TABLE file_entity_audience_grants;
ALTER TABLE file_entity_audience_grants_stage66b_new RENAME TO file_entity_audience_grants;

CREATE INDEX idx_file_audience_grants_buyer
ON file_entity_audience_grants (
  buyer_customer_id,file_entity_link_id,revoked_at,expires_at,id
) WHERE subject_type='BUYER';
CREATE INDEX idx_file_audience_grants_seller
ON file_entity_audience_grants (
  seller_organization_id,file_entity_link_id,revoked_at,expires_at,id
) WHERE subject_type='SELLER_ORGANIZATION';
CREATE INDEX idx_file_audience_grants_staff
ON file_entity_audience_grants (
  file_entity_link_id,staff_permission_code,staff_scope_type,
  staff_team_id,revoked_at,expires_at,id
) WHERE subject_type='STAFF_INTERNAL';
CREATE UNIQUE INDEX uq_file_audience_grant_subject
ON file_entity_audience_grants (
  file_entity_link_id,subject_type,
  ifnull(buyer_customer_id,''),ifnull(seller_organization_id,'')
);

-- ===== archive_bundle_files =====
CREATE TABLE archive_bundle_files_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  bundle_id TEXT NOT NULL REFERENCES archive_bundles(id),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  entry_index INTEGER NOT NULL CHECK (typeof(entry_index)='integer' AND entry_index>=0),
  safe_name TEXT NOT NULL CHECK (
    length(safe_name) BETWEEN 6 AND 200
    AND safe_name GLOB '[0-9][0-9][0-9][0-9]-[0-9a-f]*.*'
    AND safe_name NOT GLOB '*[^0-9a-zA-Z._-]*'),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF','ORDER_COMMUNICATION_SCREENSHOT'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'image/jpeg','image/png','image/webp','application/pdf'
  )),
  byte_size INTEGER NOT NULL CHECK (typeof(byte_size)='integer' AND byte_size>=0),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  source_etag TEXT CHECK (source_etag IS NULL OR length(source_etag) BETWEEN 1 AND 256),
  source_version INTEGER NOT NULL CHECK (typeof(source_version)='integer' AND source_version>=1),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'PRODUCT_APPLICATION','PRODUCT_VERSION','ORDER_INSTRUCTION_VERSION','ORDER',
    'ORDER_EVIDENCE_SUBMISSION','REVIEW','BUYER_REFUND','SELLER_SETTLEMENT','SUPPORT_CASE'
  )),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  source_created_at INTEGER NOT NULL CHECK (typeof(source_created_at)='integer' AND source_created_at>=0),
  delete_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (delete_state IN ('PENDING','DELETED')),
  deleted_at INTEGER CHECK (
    (delete_state='PENDING' AND deleted_at IS NULL)
    OR (delete_state='DELETED' AND typeof(deleted_at)='integer' AND deleted_at>=0)
  ),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (bundle_id, file_object_id),
  UNIQUE (bundle_id, safe_name)
) STRICT;
INSERT INTO archive_bundle_files_stage66b_new (id, bundle_id, file_object_id, entry_index, safe_name, purpose, visibility, mime_type, byte_size, sha256, source_etag, source_version, entity_type, entity_id, source_created_at, delete_state, deleted_at, created_at) SELECT id, bundle_id, file_object_id, entry_index, safe_name, CASE WHEN purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION' THEN 'ORDER_COMMUNICATION_SCREENSHOT' ELSE purpose END, visibility, mime_type, byte_size, sha256, source_etag, source_version, entity_type, entity_id, source_created_at, delete_state, deleted_at, created_at FROM archive_bundle_files;
DROP TABLE archive_bundle_files;
ALTER TABLE archive_bundle_files_stage66b_new RENAME TO archive_bundle_files;

-- ===== historical_order_files =====
CREATE TABLE historical_order_files_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  import_batch_id TEXT NOT NULL REFERENCES historical_import_batches(id),
  historical_order_id TEXT NOT NULL REFERENCES historical_orders(id),
  source_row_key TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN (
    'ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF','ORDER_COMMUNICATION_SCREENSHOT'
  )),
  audience TEXT NOT NULL CHECK (audience IN ('INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE')),
  source_column TEXT NOT NULL CHECK (length(source_column) BETWEEN 1 AND 60),
  source_ref TEXT CHECK (source_ref IS NULL OR length(source_ref) BETWEEN 1 AND 500),
  source_ref_sha256 TEXT CHECK (source_ref_sha256 IS NULL OR (length(source_ref_sha256)=64 AND source_ref_sha256 NOT GLOB '*[^0-9a-f]*')),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR (length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
  mime_type TEXT CHECK (mime_type IS NULL OR mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size>=0),
  classification TEXT NOT NULL CHECK (classification IN (
    'HOT_R2','COLD_ARCHIVE_ELIGIBLE','QUARANTINE','MISSING','CORRUPT','ORPHAN'
  )),
  classification_reason TEXT CHECK (classification_reason IS NULL OR length(classification_reason) BETWEEN 1 AND 200),
  physical_dedup_key TEXT CHECK (physical_dedup_key IS NULL OR length(physical_dedup_key)=64),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (import_batch_id, historical_order_id, source_column, source_ref)
) STRICT;
INSERT INTO historical_order_files_stage66b_new (id, import_batch_id, historical_order_id, source_row_key, purpose, audience, source_column, source_ref, source_ref_sha256, content_sha256, mime_type, byte_size, classification, classification_reason, physical_dedup_key, created_at) SELECT id, import_batch_id, historical_order_id, source_row_key, CASE WHEN purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION' THEN 'ORDER_COMMUNICATION_SCREENSHOT' ELSE purpose END, audience, source_column, source_ref, source_ref_sha256, content_sha256, mime_type, byte_size, classification, classification_reason, physical_dedup_key, created_at FROM historical_order_files;
DROP TABLE historical_order_files;
ALTER TABLE historical_order_files_stage66b_new RENAME TO historical_order_files;

-- ===== historical_image_inventory_files =====
CREATE TABLE historical_image_inventory_files_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  inventory_batch_id TEXT NOT NULL REFERENCES historical_image_inventory_batches(id),
  relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 1000
    AND relative_path NOT LIKE '/%'
    AND relative_path NOT LIKE '%..%'
    AND relative_path NOT LIKE '%\%'),
  logical_file_id TEXT NOT NULL CHECK (length(logical_file_id)=72
    AND logical_file_id LIKE 'histimg-%'
    AND substr(logical_file_id,9) NOT GLOB '*[^0-9a-f]*'),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size>=0),
  sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  mime_type TEXT CHECK (mime_type IS NULL OR mime_type IN (
    'image/jpeg','image/png','image/webp','image/gif','application/pdf'
  )),
  extension TEXT CHECK (extension IS NULL OR length(extension) BETWEEN 1 AND 16),
  read_status TEXT NOT NULL CHECK (read_status IN ('READ_OK','READ_FAILED')),
  extension_mime_consistent INTEGER NOT NULL CHECK (extension_mime_consistent IN (0,1)),
  business_relation TEXT CHECK (business_relation IS NULL OR business_relation IN (
    'LINKED','ORPHAN','QUARANTINE'
  )),
  business_import_batch_id TEXT REFERENCES historical_import_batches(id),
  business_order_id TEXT CHECK (business_order_id IS NULL OR length(business_order_id) BETWEEN 1 AND 200),
  business_purpose TEXT CHECK (business_purpose IS NULL OR business_purpose IN (
    'ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF','ORDER_COMMUNICATION_SCREENSHOT'
  )),
  business_audience TEXT CHECK (business_audience IS NULL OR business_audience IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (inventory_batch_id, relative_path)
) STRICT;
INSERT INTO historical_image_inventory_files_stage66b_new (id, inventory_batch_id, relative_path, logical_file_id, byte_size, sha256, mime_type, extension, read_status, extension_mime_consistent, business_relation, business_import_batch_id, business_order_id, business_purpose, business_audience, created_at) SELECT id, inventory_batch_id, relative_path, logical_file_id, byte_size, sha256, mime_type, extension, read_status, extension_mime_consistent, business_relation, business_import_batch_id, business_order_id, CASE WHEN business_purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION' THEN 'ORDER_COMMUNICATION_SCREENSHOT' ELSE business_purpose END, business_audience, created_at FROM historical_image_inventory_files;
DROP TABLE historical_image_inventory_files;
ALTER TABLE historical_image_inventory_files_stage66b_new RENAME TO historical_image_inventory_files;

-- The three historical tables above were rebuilt, dropping their stage 5/6.5
-- safety triggers with the table swap; restore them unchanged.
CREATE TRIGGER trg_historical_order_files_no_delete
BEFORE DELETE ON historical_order_files
BEGIN SELECT RAISE(ABORT,'historical_order_files_are_immutable'); END;

CREATE TRIGGER trg_historical_file_insert_guard
BEFORE INSERT ON historical_order_files
WHEN NEW.classification='COLD_ARCHIVE_ELIGIBLE'
  AND NOT EXISTS (
    SELECT 1 FROM historical_orders hist
    WHERE hist.id=NEW.historical_order_id
      AND hist.review_approved_on IS NOT NULL
      AND hist.refunded_on IS NOT NULL
      AND hist.settled_on IS NOT NULL
  )
BEGIN SELECT RAISE(ABORT,'historical_file_cold_requires_complete_closure'); END;

CREATE TRIGGER trg_hist_img_files_no_delete
BEFORE DELETE ON historical_image_inventory_files
BEGIN SELECT RAISE(ABORT,'historical_image_inventory_files_are_immutable'); END;

CREATE TRIGGER trg_hist_img_files_update_guard
BEFORE UPDATE ON historical_image_inventory_files
WHEN NEW.id<>OLD.id OR NEW.inventory_batch_id<>OLD.inventory_batch_id
  OR NEW.relative_path<>OLD.relative_path OR NEW.logical_file_id<>OLD.logical_file_id
  OR NEW.byte_size<>OLD.byte_size OR NEW.sha256<>OLD.sha256 OR NEW.mime_type<>OLD.mime_type
  OR NEW.extension<>OLD.extension OR NEW.read_status<>OLD.read_status
  OR NEW.extension_mime_consistent<>OLD.extension_mime_consistent
  OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'historical_image_inventory_facts_are_immutable'); END;



-- ===== order_evidence_versions =====
CREATE TABLE "order_evidence_versions_stage66b_new" (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL
    REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  amazon_order_number_raw TEXT NOT NULL
    CHECK (length(amazon_order_number_raw) BETWEEN 1 AND 100),
  amazon_order_number_normalized TEXT NOT NULL
    CHECK (
      length(amazon_order_number_normalized)=19
      AND substr(amazon_order_number_normalized, 4, 1)='-'
      AND substr(amazon_order_number_normalized, 12, 1)='-'
      AND length(replace(amazon_order_number_normalized, '-', ''))=17
      AND replace(amazon_order_number_normalized, '-', '')
        NOT GLOB '*[^0-9]*'
    ),
  final_paid_jpy INTEGER NOT NULL
    CHECK (final_paid_jpy BETWEEN 0 AND 9007199254740991),
  submitted_by_buyer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  buyer_note TEXT
    CHECK (
      buyer_note IS NULL
      OR length(buyer_note) BETWEEN 1 AND 2000
    ),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0), order_instruction_id TEXT REFERENCES order_instructions(id), order_instruction_version_id TEXT REFERENCES order_instruction_versions(id), instruction_deadline_snapshot INTEGER
  CHECK (
    instruction_deadline_snapshot IS NULL
    OR instruction_deadline_snapshot >= 0
  ), reference_order_amount_jpy_snapshot INTEGER
  CHECK (
    reference_order_amount_jpy_snapshot IS NULL
    OR reference_order_amount_jpy_snapshot BETWEEN 0 AND 9007199254740991
  ), buyer_self_pay_bps_snapshot INTEGER
  CHECK (
    buyer_self_pay_bps_snapshot IS NULL
    OR buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  ), buyer_self_pay_jpy INTEGER
  CHECK (
    buyer_self_pay_jpy IS NULL
    OR buyer_self_pay_jpy BETWEEN 0 AND 9007199254740991
  ), buyer_refundable_principal_jpy INTEGER
  CHECK (
    buyer_refundable_principal_jpy IS NULL
    OR buyer_refundable_principal_jpy BETWEEN 0 AND 9007199254740991
  ), price_mismatch INTEGER
  CHECK (price_mismatch IS NULL OR price_mismatch IN (0, 1)), price_difference_jpy INTEGER
  CHECK (
    price_difference_jpy IS NULL
    OR price_difference_jpy BETWEEN -9007199254740991 AND 9007199254740991
  ), submitted_before_deadline INTEGER
  CHECK (submitted_before_deadline IS NULL OR submitted_before_deadline IN (0, 1)), amazon_order_date TEXT
  CHECK (
    amazon_order_date IS NULL
    OR (
      length(amazon_order_date)=10
      AND amazon_order_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(amazon_order_date) IS NOT NULL
      AND date(amazon_order_date)=amazon_order_date
    )
  ),
  UNIQUE (submission_id, version_no)
) STRICT;
INSERT INTO order_evidence_versions_stage66b_new (id, submission_id, reservation_id, buyer_customer_id, marketplace_code, version_no, amazon_order_number_raw, amazon_order_number_normalized, final_paid_jpy, submitted_by_buyer_id, buyer_note, created_at, order_instruction_id, order_instruction_version_id, instruction_deadline_snapshot, reference_order_amount_jpy_snapshot, buyer_self_pay_bps_snapshot, buyer_self_pay_jpy, buyer_refundable_principal_jpy, price_mismatch, price_difference_jpy, submitted_before_deadline, amazon_order_date) SELECT id, submission_id, reservation_id, buyer_customer_id, marketplace_code, version_no, amazon_order_number_raw, amazon_order_number_normalized, final_paid_jpy, submitted_by_buyer_id, buyer_note, created_at, order_instruction_id, order_instruction_version_id, instruction_deadline_snapshot, reference_order_amount_jpy_snapshot, buyer_self_pay_bps_snapshot, buyer_self_pay_jpy, buyer_refundable_principal_jpy, price_mismatch, price_difference_jpy, submitted_before_deadline, amazon_order_date FROM order_evidence_versions;
DROP TABLE order_evidence_versions;
ALTER TABLE order_evidence_versions_stage66b_new RENAME TO order_evidence_versions;

-- ===== order_evidence_version_files =====
CREATE TABLE order_evidence_version_files_stage66b_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  version_id TEXT NOT NULL REFERENCES order_evidence_versions(id),
  submission_id TEXT NOT NULL REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('INTERNAL_ONLY','BUYER_VISIBLE')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  -- D-056 §4.2: exactly one payment screenshot per order evidence version.
  UNIQUE (version_id)
) STRICT;
INSERT INTO order_evidence_version_files_stage66b_new (id, version_id, submission_id, reservation_id, buyer_customer_id, file_object_id, file_entity_link_id, visibility, created_at) SELECT id, version_id, submission_id, reservation_id, buyer_customer_id, file_object_id, file_entity_link_id, visibility, created_at FROM order_evidence_version_files;
DROP TABLE order_evidence_version_files;
ALTER TABLE order_evidence_version_files_stage66b_new RENAME TO order_evidence_version_files;

DROP TABLE order_evidence_internal_files;

-- ===== recreated indexes (subject tables rebuilt) =====
CREATE INDEX idx_staff_marketplace_scope_role_market
ON staff_marketplace_scopes(role_code,marketplace_code,status,staff_id);
CREATE INDEX idx_staff_marketplace_scope_support
ON staff_marketplace_scopes(role_code,marketplace_code,scope_kind,status,staff_id);
CREATE INDEX idx_staff_permission_override_effect_status
ON staff_permission_overrides(effect,status,permission_code,staff_id);
CREATE INDEX idx_staff_role_assignment_role_status
ON staff_role_assignments(role_code,status,staff_id);
CREATE UNIQUE INDEX uq_staff_marketplace_role_primary
ON staff_marketplace_scopes(role_code,marketplace_code)
WHERE status='ACTIVE' AND scope_kind='PRIMARY';
CREATE UNIQUE INDEX uq_staff_marketplace_scope_active
ON staff_marketplace_scopes(staff_id,marketplace_code)
WHERE status='ACTIVE';
CREATE UNIQUE INDEX uq_staff_role_assignment_one_active
ON staff_role_assignments(staff_id) WHERE status='ACTIVE';
CREATE INDEX idx_file_entity_links_authorization
ON file_entity_links (
  authorization_mode,file_object_id,revoked_at,expires_at,created_at,id
);
CREATE INDEX idx_file_entity_links_entity
ON file_entity_links (entity_type,entity_id,purpose,created_at,id);
CREATE INDEX idx_file_objects_cleanup
ON file_objects (status,next_delete_at,delete_attempt_count,id);
CREATE INDEX idx_file_objects_intent_status
ON file_objects (upload_intent_id,status,slot_no,id);
CREATE INDEX idx_file_upload_intents_expiry
ON file_upload_intents (status,expires_at,id);
CREATE INDEX idx_file_upload_intents_owner_status
ON file_upload_intents (owner_actor_type,owner_actor_id,status,created_at,id);
CREATE UNIQUE INDEX uq_product_image_file_object
ON file_entity_links (file_object_id)
WHERE purpose='PRODUCT_IMAGE' AND entity_type='PRODUCT_VERSION';
CREATE INDEX idx_order_evidence_version_files_object
ON order_evidence_version_files (file_object_id,submission_id,version_id,id);
CREATE INDEX idx_order_evidence_version_files_submission
ON order_evidence_version_files (submission_id,version_id,created_at,id);
CREATE INDEX idx_buyer_staff_assignment_staff_status
ON buyer_staff_assignments (staff_id, status, duty_code, buyer_customer_id);
CREATE UNIQUE INDEX uq_buyer_staff_assignment_active
ON buyer_staff_assignments (buyer_customer_id, duty_code)
WHERE status='ACTIVE';
CREATE INDEX idx_products_org_status
ON products (
  organization_id,
  status,
  created_at,
  id
);
CREATE INDEX idx_products_store_status
ON products (
  store_id,
  status,
  asin_normalized,
  id
);
CREATE UNIQUE INDEX uq_products_id_org_store_marketplace
ON products (
  id,
  organization_id,
  store_id,
  marketplace_code
);
CREATE INDEX idx_order_evidence_version_normalized_order
ON order_evidence_versions (
  marketplace_code,
  amazon_order_number_normalized,
  created_at,
  id
);
CREATE INDEX idx_order_evidence_version_reservation
ON order_evidence_versions (
  reservation_id,
  version_no,
  id
);
CREATE INDEX idx_order_evidence_versions_instruction
ON order_evidence_versions (
  order_instruction_id,
  order_instruction_version_id,
  version_no,
  id
);
CREATE INDEX idx_staff_work_items_assignee_status
ON staff_work_items (assigned_staff_id,status,created_at,id);
CREATE INDEX idx_staff_work_items_buyer_status
ON staff_work_items (buyer_customer_id,status,duty_code,id)
WHERE buyer_customer_id IS NOT NULL;
CREATE INDEX idx_staff_work_items_marketplace_status
ON staff_work_items(marketplace_code,status,work_type,created_at,id);
CREATE INDEX idx_staff_work_items_seller_status
ON staff_work_items (seller_organization_id,status,duty_code,id)
WHERE seller_organization_id IS NOT NULL;
CREATE INDEX idx_staff_work_items_status_created
ON staff_work_items (status, created_at, id);
CREATE UNIQUE INDEX uq_staff_work_item_open_source
ON staff_work_items (source_entity_type,source_entity_id,work_type)
WHERE status='OPEN';
CREATE INDEX idx_archive_bundle_files_file
ON archive_bundle_files (file_object_id, delete_state, id);
CREATE INDEX idx_archive_bundle_files_pending_delete
ON archive_bundle_files (bundle_id, delete_state, entry_index);
CREATE INDEX idx_historical_order_files_batch
ON historical_order_files (import_batch_id, classification, id);
CREATE INDEX idx_historical_order_files_dedup
ON historical_order_files (physical_dedup_key, id) WHERE physical_dedup_key IS NOT NULL;
CREATE INDEX idx_hist_img_files_sha
ON historical_image_inventory_files (inventory_batch_id, sha256, relative_path)
WHERE sha256 IS NOT NULL;
CREATE INDEX idx_hist_img_files_relation
ON historical_image_inventory_files (inventory_batch_id, business_relation, relative_path)
WHERE business_relation IS NOT NULL;

-- ===== recreated triggers (subject tables rebuilt) =====

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

CREATE TRIGGER trg_archive_bundle_files_insert_guard
BEFORE INSERT ON archive_bundle_files
WHEN NOT EXISTS (
  SELECT 1 FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN archive_bundles bundle ON bundle.id=NEW.bundle_id
  WHERE object.id=NEW.file_object_id AND object.status='VERIFIED'
    AND intent.status='VERIFIED' AND object.purpose=NEW.purpose
    AND object.visibility=NEW.visibility
    AND object.detected_mime=NEW.mime_type
    AND object.uploaded_byte_size=NEW.byte_size
    AND object.uploaded_sha256=NEW.sha256
    AND object.version=NEW.source_version
    AND bundle.sealed_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'archive_bundle_file_source_mismatch'); END;

-- The rebuilt archive_bundle_files table dropped its old triggers with the
-- table swap; restore the sealed-manifest immutability guards (D-019/D-055
-- immutable manifest contract).
CREATE TRIGGER trg_archive_bundle_files_no_delete
BEFORE DELETE ON archive_bundle_files
WHEN EXISTS (
  SELECT 1 FROM archive_bundles bundle
  WHERE bundle.id=OLD.bundle_id AND bundle.sealed_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'sealed_manifest_entries_are_immutable'); END;

CREATE TRIGGER trg_archive_bundle_files_update_guard
BEFORE UPDATE ON archive_bundle_files
WHEN NEW.id IS NOT OLD.id OR NEW.bundle_id IS NOT OLD.bundle_id
  OR NEW.file_object_id IS NOT OLD.file_object_id OR NEW.entry_index IS NOT OLD.entry_index
  OR NEW.safe_name IS NOT OLD.safe_name OR NEW.purpose IS NOT OLD.purpose
  OR NEW.visibility IS NOT OLD.visibility OR NEW.mime_type IS NOT OLD.mime_type
  OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256
  OR NEW.source_etag IS NOT OLD.source_etag OR NEW.source_version IS NOT OLD.source_version
  OR NEW.entity_type IS NOT OLD.entity_type OR NEW.entity_id IS NOT OLD.entity_id
  OR NEW.source_created_at IS NOT OLD.source_created_at
  OR NEW.created_at IS NOT OLD.created_at
  OR NOT (
    (OLD.delete_state='PENDING' AND NEW.delete_state IN ('PENDING','DELETED'))
    OR (OLD.delete_state='DELETED' AND NEW.delete_state='DELETED')
  )
  OR (NEW.delete_state='DELETED' AND NEW.deleted_at IS NULL)
  OR (NEW.delete_state='PENDING' AND NEW.deleted_at IS NOT NULL)
  OR (NEW.delete_state='DELETED' AND NOT EXISTS (
    SELECT 1 FROM archive_bundles bundle
    WHERE bundle.id=NEW.bundle_id AND bundle.drive_verified_at IS NOT NULL
  ))
BEGIN SELECT RAISE(ABORT,'archive_bundle_file_invalid_transition'); END;

CREATE TRIGGER trg_buyer_advance_principal_entry_files_guard
BEFORE INSERT ON buyer_advance_principal_entry_files
WHEN NOT EXISTS(
  SELECT 1 FROM buyer_advance_principal_entries entry
  JOIN file_entity_links link ON link.id=NEW.file_entity_link_id
  WHERE entry.id=NEW.advance_payment_entry_id
    AND entry.entry_type='PAYMENT'
    AND link.file_object_id=NEW.file_object_id
    AND link.entity_type='BUYER_REFUND'
    AND link.entity_id=NEW.advance_payment_entry_id
    AND link.purpose='BUYER_REFUND_PROOF'
    AND link.visibility='INTERNAL_ONLY'
    AND link.revoked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_proof_link_mismatch');
END;

CREATE TRIGGER trg_buyer_refund_payment_entry_file_guard
BEFORE INSERT ON buyer_refund_payment_entry_files
WHEN NOT EXISTS (
  SELECT 1
  FROM buyer_refund_payment_entries payment
  JOIN file_objects object ON object.id=NEW.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id AND link.file_object_id=object.id
  WHERE payment.id=NEW.payment_entry_id
    AND payment.obligation_id=NEW.obligation_id
    AND payment.entry_type='PAYMENT'
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
    AND object.purpose='BUYER_REFUND_PROOF'
    AND intent.purpose='BUYER_REFUND_PROOF'
    AND object.visibility='INTERNAL_ONLY'
    AND intent.visibility='INTERNAL_ONLY'
    AND intent.owner_actor_type='STAFF'
    AND intent.owner_actor_id=payment.recorded_by_staff_id
    AND link.entity_type='BUYER_REFUND'
    AND link.entity_id=payment.id
    AND link.purpose='BUYER_REFUND_PROOF'
    AND link.visibility='INTERNAL_ONLY'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND (
      SELECT COUNT(*) FROM file_entity_audience_grants grant_row
      WHERE grant_row.file_entity_link_id=link.id
        AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL
          OR grant_row.expires_at>NEW.created_at)
    )=1
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='BUYER_REFUND_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND (staff_grant.expires_at IS NULL
          OR staff_grant.expires_at>NEW.created_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_file_authority_mismatch');
END;

CREATE TRIGGER trg_buyer_staff_assignments_no_delete
BEFORE DELETE ON buyer_staff_assignments
BEGIN
  SELECT RAISE(ABORT, 'buyer_staff_assignments_are_immutable');
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

CREATE TRIGGER trg_explicit_file_link_revoke_only
BEFORE UPDATE ON file_entity_links
WHEN OLD.authorization_mode='EXPLICIT_AUDIENCES' AND (
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.file_object_id IS OLD.file_object_id)
  OR NOT (NEW.entity_type IS OLD.entity_type)
  OR NOT (NEW.entity_id IS OLD.entity_id)
  OR NOT (NEW.purpose IS OLD.purpose)
  OR NOT (NEW.visibility IS OLD.visibility)
  OR NOT (NEW.linked_by_actor_type IS OLD.linked_by_actor_type)
  OR NOT (NEW.linked_by_actor_id IS OLD.linked_by_actor_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NOT (NEW.authorization_mode IS OLD.authorization_mode)
  OR NOT (NEW.expires_at IS OLD.expires_at)
  OR OLD.revoked_at IS NOT NULL
  OR NEW.revoked_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'explicit_file_link_is_immutable'); END;

-- The rebuilt file_entity_audience_grants table dropped its triggers with
-- the table swap; restore the immutability guards.
CREATE TRIGGER trg_file_audience_grants_no_delete
BEFORE DELETE ON file_entity_audience_grants
BEGIN SELECT RAISE(ABORT,'file_audience_grants_are_immutable'); END;

CREATE TRIGGER trg_file_audience_grants_revoke_only
BEFORE UPDATE ON file_entity_audience_grants
WHEN
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.file_entity_link_id IS OLD.file_entity_link_id)
  OR NOT (NEW.subject_type IS OLD.subject_type)
  OR NOT (NEW.buyer_customer_id IS OLD.buyer_customer_id)
  OR NOT (NEW.seller_organization_id IS OLD.seller_organization_id)
  OR NOT (NEW.staff_permission_code IS OLD.staff_permission_code)
  OR NOT (NEW.staff_scope_type IS OLD.staff_scope_type)
  OR NOT (NEW.staff_team_id IS OLD.staff_team_id)
  OR NOT (NEW.granted_by_actor_type IS OLD.granted_by_actor_type)
  OR NOT (NEW.granted_by_actor_id IS OLD.granted_by_actor_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NOT (NEW.expires_at IS OLD.expires_at)
  OR OLD.revoked_at IS NOT NULL
  OR NEW.revoked_at IS NULL
BEGIN SELECT RAISE(ABORT,'file_audience_grant_is_immutable'); END;

CREATE TRIGGER trg_file_audience_grant_link_guard
BEFORE INSERT ON file_entity_audience_grants
WHEN NOT EXISTS (
  SELECT 1 FROM file_entity_links link
  JOIN file_objects object ON object.id=link.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  WHERE link.id=NEW.file_entity_link_id
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND object.status='VERIFIED' AND intent.status='VERIFIED'
)
BEGIN SELECT RAISE(ABORT,'file_audience_grant_link_not_active'); END;

CREATE TRIGGER trg_file_entity_links_verified_guard
BEFORE INSERT ON file_entity_links
WHEN NOT EXISTS (
  SELECT 1 FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED' AND intent.status='VERIFIED'
    AND object.purpose=NEW.purpose
    AND (
      object.visibility=NEW.visibility
      OR (NEW.entity_type='ORDER_INSTRUCTION_VERSION'
        AND NEW.purpose='PRODUCT_IMAGE'
        AND NEW.visibility='BUYER_VISIBLE')
      OR (NEW.entity_type='ORDER_INSTRUCTION_VERSION'
        AND NEW.purpose='ORDER_INSTRUCTION_KEYWORD_IMAGE'
        AND object.visibility='INTERNAL_ONLY'
        AND NEW.visibility='BUYER_VISIBLE')
    )
)
BEGIN SELECT RAISE(ABORT,'file_object_not_verified'); END;

CREATE TRIGGER trg_file_objects_intent_guard
BEFORE INSERT ON file_objects
WHEN NOT EXISTS (
  SELECT 1 FROM file_upload_intents intent
  WHERE intent.id=NEW.upload_intent_id
    AND intent.status='ISSUED'
    AND intent.purpose=NEW.purpose
    AND intent.visibility=NEW.visibility
    AND NEW.slot_no<=intent.requested_file_count
    AND NEW.upload_expires_at=intent.expires_at
)
BEGIN SELECT RAISE(ABORT,'file_object_intent_mismatch'); END;

CREATE TRIGGER trg_file_objects_verified_guard
BEFORE UPDATE OF status ON file_objects
WHEN NEW.status='VERIFIED' AND NOT EXISTS (
  SELECT 1 FROM file_upload_intents intent
  WHERE intent.id=NEW.upload_intent_id AND intent.status='VERIFIED'
)
BEGIN SELECT RAISE(ABORT,'file_intent_not_verified'); END;

CREATE TRIGGER trg_file_read_intent_link_guard
BEFORE INSERT ON file_read_intents
WHEN NEW.file_entity_link_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM file_entity_links link
  WHERE link.id=NEW.file_entity_link_id
    AND link.file_object_id=NEW.file_object_id
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
)
BEGIN SELECT RAISE(ABORT,'file_entity_link_not_readable'); END;

CREATE TRIGGER trg_file_read_intents_verified_guard
BEFORE INSERT ON file_read_intents
WHEN NOT EXISTS (
  SELECT 1 FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link ON link.file_object_id=object.id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED' AND intent.status='VERIFIED'
)
BEGIN SELECT RAISE(ABORT,'file_object_not_readable'); END;

CREATE TRIGGER trg_formal_order_financial_self_pay_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    JOIN order_evidence_versions evidence
      ON evidence.id=formal_order.order_evidence_version_id
    WHERE formal_order.id=NEW.formal_order_id
      AND NEW.buyer_self_pay_bps=evidence.buyer_self_pay_bps_snapshot
      AND NEW.buyer_self_pay_jpy=evidence.buyer_self_pay_jpy
      AND NEW.buyer_refundable_principal_jpy=
        evidence.buyer_refundable_principal_jpy
      AND NEW.buyer_gross_principal_cny_fen>=
        NEW.buyer_expected_principal_cny_fen
      AND NEW.buyer_self_pay_contribution_cny_fen=
        NEW.buyer_gross_principal_cny_fen-
        NEW.buyer_expected_principal_cny_fen
  )
  OR (
    NEW.buyer_self_pay_bps IS NULL
    AND NEW.buyer_self_pay_jpy IS NULL
    AND NEW.buyer_refundable_principal_jpy IS NULL
    AND NEW.buyer_gross_principal_cny_fen IS NULL
    AND NEW.buyer_self_pay_contribution_cny_fen IS NULL
    AND EXISTS (
      SELECT 1
      FROM formal_orders formal_order
      JOIN order_instruction_reconciliation_markers marker
        ON marker.reservation_id=formal_order.reservation_id
        AND marker.disposition='HISTORICAL_EVIDENCE_CONTEXT'
      WHERE formal_order.id=NEW.formal_order_id
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_self_pay_snapshot_mismatch');
END;

CREATE TRIGGER trg_formal_order_instruction_guard
BEFORE INSERT ON formal_orders
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM order_instructions instruction
    JOIN order_instruction_versions instruction_version
      ON instruction_version.id=NEW.order_instruction_version_id
      AND instruction_version.instruction_id=instruction.id
    JOIN order_evidence_versions evidence
      ON evidence.id=NEW.order_evidence_version_id
      AND evidence.order_instruction_id=instruction.id
      AND evidence.order_instruction_version_id=instruction_version.id
    WHERE instruction.id=NEW.order_instruction_id
      AND instruction.reservation_id=NEW.reservation_id
      AND instruction.status='ACTIVE'
      AND instruction.current_version_no=instruction_version.version_no
  )
  OR (
    NEW.order_instruction_id IS NULL
    AND NEW.order_instruction_version_id IS NULL
    AND EXISTS (
      SELECT 1 FROM order_instruction_reconciliation_markers marker
      WHERE marker.reservation_id=NEW.reservation_id
        AND marker.disposition='HISTORICAL_EVIDENCE_CONTEXT'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_instruction_mismatch');
END;

CREATE TRIGGER trg_formal_order_number_claim_source_guard
BEFORE INSERT ON formal_order_number_claims
WHEN NOT EXISTS (
  SELECT 1 FROM order_evidence_versions evidence
  WHERE evidence.id=NEW.current_evidence_version_id
    AND evidence.submission_id=NEW.evidence_submission_id
    AND evidence.marketplace_code=NEW.marketplace_code
    AND evidence.amazon_order_number_normalized=
      NEW.amazon_order_number_normalized
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claim_source_mismatch');
END;

CREATE TRIGGER trg_formal_order_number_claim_transition_guard
BEFORE UPDATE ON formal_order_number_claims
WHEN NOT (
  NEW.id=OLD.id
  AND NEW.marketplace_code=OLD.marketplace_code
  AND NEW.amazon_order_number_normalized=OLD.amazon_order_number_normalized
  AND NEW.evidence_submission_id=OLD.evidence_submission_id
  AND NEW.claimed_at=OLD.claimed_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND OLD.status='PROVISIONAL'
  AND (
    (NEW.status='PROVISIONAL'
      AND NEW.formal_order_id IS NULL
      AND NEW.finalized_at IS NULL AND NEW.released_at IS NULL)
    OR (NEW.status='FINAL'
      AND NEW.formal_order_id IS NOT NULL
      AND NEW.finalized_at IS NOT NULL AND NEW.released_at IS NULL)
    OR (NEW.status='RELEASED'
      AND NEW.formal_order_id IS NULL
      AND NEW.finalized_at IS NULL AND NEW.released_at IS NOT NULL)
  )
  AND EXISTS (
    SELECT 1 FROM order_evidence_versions evidence
    WHERE evidence.id=NEW.current_evidence_version_id
      AND evidence.submission_id=NEW.evidence_submission_id
      AND evidence.marketplace_code=NEW.marketplace_code
      AND evidence.amazon_order_number_normalized=
        NEW.amazon_order_number_normalized
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claim_invalid_transition');
END;

CREATE TRIGGER trg_formal_order_source_guard
BEFORE INSERT ON formal_orders
WHEN
  NEW.amazon_order_date IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.id=NEW.order_evidence_version_id
      AND evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    WHERE submission.id=NEW.order_evidence_submission_id
      AND submission.reservation_id=NEW.reservation_id
      AND submission.buyer_customer_id=NEW.buyer_customer_id
      AND submission.marketplace_code=NEW.marketplace_code
      AND submission.status='VERIFIED'
      AND evidence.reservation_id=NEW.reservation_id
      AND evidence.buyer_customer_id=NEW.buyer_customer_id
      AND evidence.marketplace_code=NEW.marketplace_code
      AND evidence.amazon_order_number_raw=NEW.amazon_order_number_raw
      AND evidence.amazon_order_number_normalized=
        NEW.amazon_order_number_normalized
      AND evidence.final_paid_jpy=NEW.final_paid_jpy
      AND evidence.amazon_order_date=NEW.amazon_order_date
  )
  OR NOT EXISTS (
    SELECT 1
    FROM product_reservations reservation
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    WHERE reservation.id=NEW.reservation_id
      AND reservation.status='APPROVED'
      AND reservation.demand_batch_id=NEW.demand_batch_id
      AND reservation.buyer_customer_id=NEW.buyer_customer_id
      AND reservation.organization_id=NEW.seller_organization_id
      AND reservation.store_id=NEW.store_id
      AND reservation.product_id=NEW.product_id
      AND reservation.product_version_no=NEW.product_version_no
      AND reservation.marketplace_code=NEW.marketplace_code
      AND demand.organization_id=NEW.seller_organization_id
      AND demand.store_id=NEW.store_id
      AND demand.product_id=NEW.product_id
      AND demand.product_version_no=NEW.product_version_no
      AND demand.marketplace_code=NEW.marketplace_code
      AND demand.task_type=NEW.review_type
  )
  OR NOT EXISTS (
    SELECT 1
    FROM products product
    JOIN product_versions product_version
      ON product_version.id=NEW.product_version_id
      AND product_version.product_id=product.id
      AND product_version.version_no=NEW.product_version_no
    WHERE product.id=NEW.product_id
      AND product.organization_id=NEW.seller_organization_id
      AND product.store_id=NEW.store_id
      AND product.marketplace_code=NEW.marketplace_code
      AND product.asin_display=NEW.asin_display
      AND product.asin_normalized=NEW.asin_normalized
      AND product_version.product_name=NEW.product_name_snapshot
  )
  OR NOT EXISTS (
    SELECT 1
    FROM buyer_customers buyer
    WHERE buyer.id=NEW.buyer_customer_id
      AND buyer.marketplace_code=NEW.marketplace_code
      AND buyer.buyer_customer_no=NEW.buyer_customer_no
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_source_mismatch');
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

CREATE TRIGGER trg_order_evidence_duplicate_signal_after_version
AFTER INSERT ON order_evidence_versions
BEGIN
  INSERT OR IGNORE INTO order_evidence_duplicate_signals (
    id,
    source_version_id,
    conflicting_version_id,
    marketplace_code,
    amazon_order_number_normalized,
    detected_at
  )
  SELECT
    'duplicate:' || lower(hex(randomblob(16))),
    NEW.id,
    other.id,
    NEW.marketplace_code,
    NEW.amazon_order_number_normalized,
    NEW.created_at
  FROM order_evidence_versions other
  JOIN order_evidence_submissions other_submission
    ON other_submission.id=other.submission_id
    AND other_submission.current_version_no=other.version_no
  JOIN order_evidence_submissions new_submission
    ON new_submission.id=NEW.submission_id
  WHERE other.submission_id<>NEW.submission_id
    AND other.marketplace_code=NEW.marketplace_code
    AND other.amazon_order_number_normalized=
      NEW.amazon_order_number_normalized
    AND other_submission.status<>'WITHDRAWN'
    AND new_submission.status<>'WITHDRAWN';

  INSERT OR IGNORE INTO order_evidence_duplicate_signals (
    id,
    source_version_id,
    conflicting_version_id,
    marketplace_code,
    amazon_order_number_normalized,
    detected_at
  )
  SELECT
    'duplicate:' || lower(hex(randomblob(16))),
    other.id,
    NEW.id,
    NEW.marketplace_code,
    NEW.amazon_order_number_normalized,
    NEW.created_at
  FROM order_evidence_versions other
  JOIN order_evidence_submissions other_submission
    ON other_submission.id=other.submission_id
    AND other_submission.current_version_no=other.version_no
  JOIN order_evidence_submissions new_submission
    ON new_submission.id=NEW.submission_id
  WHERE other.submission_id<>NEW.submission_id
    AND other.marketplace_code=NEW.marketplace_code
    AND other.amazon_order_number_normalized=
      NEW.amazon_order_number_normalized
    AND other_submission.status<>'WITHDRAWN'
    AND new_submission.status<>'WITHDRAWN';
END;

CREATE TRIGGER trg_order_evidence_event_identity_guard
BEFORE INSERT ON order_evidence_events
WHEN NOT EXISTS (
  SELECT 1
  FROM order_evidence_versions evidence
  WHERE evidence.id=NEW.evidence_version_id
    AND evidence.submission_id=NEW.submission_id
    AND evidence.reservation_id=NEW.reservation_id
    AND evidence.buyer_customer_id=NEW.buyer_customer_id
)
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_event_identity_mismatch');
END;

CREATE TRIGGER trg_order_evidence_instruction_snapshot_guard
BEFORE INSERT ON order_evidence_versions
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM order_instructions instruction
    JOIN order_instruction_versions instruction_version
      ON instruction_version.id=NEW.order_instruction_version_id
      AND instruction_version.instruction_id=instruction.id
      AND instruction_version.version_no=instruction.current_version_no
    WHERE instruction.id=NEW.order_instruction_id
      AND instruction.reservation_id=NEW.reservation_id
      AND instruction.buyer_customer_id=NEW.buyer_customer_id
      AND instruction.marketplace_code=NEW.marketplace_code
      AND instruction.status='ACTIVE'
      AND NEW.instruction_deadline_snapshot IS NOT NULL
      AND NEW.submitted_before_deadline=1
      AND NEW.created_at<NEW.instruction_deadline_snapshot
      AND NEW.reference_order_amount_jpy_snapshot=
        instruction_version.reference_order_amount_jpy
      AND NEW.buyer_self_pay_bps_snapshot=instruction_version.buyer_self_pay_bps
      AND NEW.buyer_self_pay_jpy IS NOT NULL
      AND NEW.buyer_refundable_principal_jpy IS NOT NULL
      AND NEW.buyer_self_pay_jpy+NEW.buyer_refundable_principal_jpy=
        NEW.final_paid_jpy
      AND NEW.price_difference_jpy=
        NEW.final_paid_jpy-NEW.reference_order_amount_jpy_snapshot
      AND NEW.price_mismatch=CASE
        WHEN NEW.price_difference_jpy=0 THEN 0 ELSE 1 END
  )
  OR (
    NEW.order_instruction_id IS NULL
    AND NEW.order_instruction_version_id IS NULL
    AND NEW.instruction_deadline_snapshot IS NULL
    AND NEW.reference_order_amount_jpy_snapshot IS NULL
    AND NEW.buyer_self_pay_bps_snapshot IS NULL
    AND NEW.buyer_self_pay_jpy IS NULL
    AND NEW.buyer_refundable_principal_jpy IS NULL
    AND NEW.price_mismatch IS NULL
    AND NEW.price_difference_jpy IS NULL
    AND NEW.submitted_before_deadline IS NULL
    AND EXISTS (
      SELECT 1 FROM order_instruction_reconciliation_markers marker
      WHERE marker.reservation_id=NEW.reservation_id
        AND marker.disposition='HISTORICAL_EVIDENCE_CONTEXT'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_instruction_snapshot_mismatch');
END;

CREATE TRIGGER trg_order_evidence_version_file_guard
BEFORE INSERT ON order_evidence_version_files
WHEN
  NOT EXISTS (
    SELECT 1 FROM order_evidence_versions evidence
    WHERE evidence.id=NEW.version_id
      AND evidence.submission_id=NEW.submission_id
      AND evidence.reservation_id=NEW.reservation_id
      AND evidence.buyer_customer_id=NEW.buyer_customer_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM file_objects object
    JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
    WHERE object.id=NEW.file_object_id
      AND object.status='VERIFIED' AND intent.status='VERIFIED'
      AND object.purpose='ORDER_EVIDENCE' AND intent.purpose='ORDER_EVIDENCE'
      AND object.visibility=NEW.visibility AND intent.visibility=NEW.visibility
      AND NEW.visibility<>'SELLER_VISIBLE'
      AND object.detected_mime IN ('image/jpeg','image/png','image/webp')
      AND intent.owner_actor_type='BUYER_CUSTOMER'
      AND intent.owner_actor_id=NEW.buyer_customer_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM file_entity_links link
    WHERE link.id=NEW.file_entity_link_id
      AND link.file_object_id=NEW.file_object_id
      AND link.entity_type='ORDER' AND link.entity_id=NEW.version_id
      AND link.purpose='ORDER_EVIDENCE' AND link.visibility=NEW.visibility
      AND link.linked_by_actor_type='BUYER_CUSTOMER'
      AND link.linked_by_actor_id=NEW.buyer_customer_id
  )
  OR EXISTS (
    SELECT 1 FROM order_evidence_version_files existing
    WHERE existing.file_object_id=NEW.file_object_id
      AND existing.submission_id<>NEW.submission_id
  )
BEGIN SELECT RAISE(ABORT,'order_evidence_file_conflict'); END;

CREATE TRIGGER trg_order_evidence_version_files_no_delete
BEFORE DELETE ON order_evidence_version_files
BEGIN SELECT RAISE(ABORT,'order_evidence_version_files_are_immutable'); END;

CREATE TRIGGER trg_order_evidence_version_files_no_update
BEFORE UPDATE ON order_evidence_version_files
BEGIN SELECT RAISE(ABORT,'order_evidence_version_files_are_immutable'); END;

CREATE TRIGGER trg_order_evidence_version_submission_guard
BEFORE INSERT ON order_evidence_versions
WHEN NEW.amazon_order_date IS NULL OR NOT EXISTS (
  SELECT 1
  FROM order_evidence_submissions submission
  WHERE submission.id=NEW.submission_id
    AND submission.reservation_id=NEW.reservation_id
    AND submission.buyer_customer_id=NEW.buyer_customer_id
    AND submission.marketplace_code=NEW.marketplace_code
    AND NEW.submitted_by_buyer_id=NEW.buyer_customer_id
    AND (
      (
        NEW.version_no=submission.current_version_no
        AND NEW.version_no=1
        AND submission.status='PENDING_VERIFICATION'
      )
      OR
      (
        NEW.version_no=submission.current_version_no+1
        AND submission.status='CHANGES_REQUESTED'
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_version_submission_mismatch');
END;

CREATE TRIGGER trg_order_evidence_versions_no_delete
BEFORE DELETE ON order_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_versions_are_immutable');
END;

CREATE TRIGGER trg_order_evidence_versions_no_update
BEFORE UPDATE ON order_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_versions_are_immutable');
END;

CREATE TRIGGER trg_order_instruction_historical_marker_guard
BEFORE INSERT ON order_instruction_reconciliation_markers
WHEN NEW.disposition='HISTORICAL_EVIDENCE_CONTEXT' AND NOT (
  EXISTS (
    SELECT 1 FROM order_evidence_versions evidence
    WHERE evidence.reservation_id=NEW.reservation_id
      AND evidence.order_instruction_id IS NULL
      AND evidence.order_instruction_version_id IS NULL
      AND evidence.instruction_deadline_snapshot IS NULL
      AND evidence.reference_order_amount_jpy_snapshot IS NULL
      AND evidence.buyer_self_pay_bps_snapshot IS NULL
      AND evidence.buyer_self_pay_jpy IS NULL
      AND evidence.buyer_refundable_principal_jpy IS NULL
      AND evidence.price_mismatch IS NULL
      AND evidence.price_difference_jpy IS NULL
      AND evidence.submitted_before_deadline IS NULL
  )
  OR (
    NEW.instruction_id IS NULL
    AND json_extract(NEW.metadata_json,'$.controlled_reconciliation')=1
    AND json_extract(NEW.metadata_json,'$.schema_version')=21
    AND EXISTS (
      SELECT 1
      FROM product_reservations reservation
      JOIN app_schema_state schema_state ON schema_state.singleton_id=1
      WHERE reservation.id=NEW.reservation_id
        AND reservation.status='APPROVED'
        AND reservation.submitted_at<schema_state.installed_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_instructions instruction
      WHERE instruction.reservation_id=NEW.reservation_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_evidence_versions evidence
      WHERE evidence.reservation_id=NEW.reservation_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM formal_orders formal_order
      WHERE formal_order.reservation_id=NEW.reservation_id
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'historical_evidence_marker_requires_existing_context');
END;

CREATE TRIGGER trg_order_instruction_version_main_image_guard
BEFORE INSERT ON order_instruction_versions
WHEN NOT EXISTS (
  SELECT 1 FROM file_entity_links link
  JOIN file_objects object ON object.id=link.file_object_id
  WHERE link.id=NEW.main_image_file_entity_link_id
    AND link.entity_type='ORDER_INSTRUCTION_VERSION'
    AND link.entity_id=NEW.id
    AND link.purpose='PRODUCT_IMAGE'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND object.status='VERIFIED'
    AND object.purpose='PRODUCT_IMAGE'
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_main_image_mismatch');
END;

CREATE TRIGGER trg_product_image_file_links_no_delete
BEFORE DELETE ON file_entity_links
WHEN OLD.purpose='PRODUCT_IMAGE' AND OLD.entity_type='PRODUCT_VERSION'
BEGIN SELECT RAISE(ABORT,'product_image_file_links_are_immutable'); END;

CREATE TRIGGER trg_product_image_file_links_no_update
BEFORE UPDATE ON file_entity_links
WHEN OLD.purpose='PRODUCT_IMAGE' AND OLD.entity_type='PRODUCT_VERSION'
BEGIN SELECT RAISE(ABORT,'product_image_file_links_are_immutable'); END;

CREATE TRIGGER trg_product_version_main_image_guard
BEFORE INSERT ON product_version_main_images
WHEN NOT EXISTS (
  SELECT 1
  FROM product_versions version
  JOIN products product ON product.id=version.product_id
  JOIN file_entity_links link ON link.id=NEW.file_entity_link_id
  JOIN file_objects object ON object.id=link.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN staff_users staff ON staff.id=NEW.created_by_staff_id
  WHERE version.id=NEW.product_version_id
    AND staff.status='ACTIVE'
    AND link.entity_type='PRODUCT_VERSION'
    AND link.entity_id=version.id
    AND link.purpose='PRODUCT_IMAGE'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL AND link.expires_at IS NULL
    AND object.status='VERIFIED' AND object.purpose='PRODUCT_IMAGE'
    AND intent.status='VERIFIED' AND intent.purpose='PRODUCT_IMAGE'
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants seller_grant
      WHERE seller_grant.file_entity_link_id=link.id
        AND seller_grant.subject_type='SELLER_ORGANIZATION'
        AND seller_grant.seller_organization_id=product.organization_id
        AND seller_grant.revoked_at IS NULL
        AND seller_grant.expires_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='PRODUCT_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND staff_grant.expires_at IS NULL
    )
)
BEGIN SELECT RAISE(ABORT,'product_version_main_image_mismatch'); END;

CREATE TRIGGER trg_review_evidence_version_file_guard
BEFORE INSERT ON review_evidence_version_files
WHEN NOT EXISTS (
  SELECT 1
  FROM review_cases review_case
  JOIN review_evidence_versions evidence
    ON evidence.id=NEW.evidence_version_id
    AND evidence.review_case_id=review_case.id
    AND evidence.formal_order_id=review_case.formal_order_id
  JOIN file_objects object ON object.id=NEW.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id AND link.file_object_id=object.id
  WHERE review_case.id=NEW.review_case_id
    AND review_case.formal_order_id=NEW.formal_order_id
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
    AND object.purpose='REVIEW_EVIDENCE'
    AND intent.purpose='REVIEW_EVIDENCE'
    AND intent.owner_actor_type='BUYER_CUSTOMER'
    AND intent.owner_actor_id=review_case.buyer_customer_id
    AND link.entity_type='REVIEW'
    AND link.entity_id=evidence.id
    AND link.purpose='REVIEW_EVIDENCE'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND (
      SELECT COUNT(*) FROM file_entity_audience_grants grant_row
      WHERE grant_row.file_entity_link_id=link.id
        AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL
          OR grant_row.expires_at>NEW.created_at)
    )=3
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants buyer_grant
      WHERE buyer_grant.file_entity_link_id=link.id
        AND buyer_grant.subject_type='BUYER'
        AND buyer_grant.buyer_customer_id=review_case.buyer_customer_id
        AND buyer_grant.revoked_at IS NULL
        AND (buyer_grant.expires_at IS NULL
          OR buyer_grant.expires_at>NEW.created_at)
    )
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants seller_grant
      WHERE seller_grant.file_entity_link_id=link.id
        AND seller_grant.subject_type='SELLER_ORGANIZATION'
        AND seller_grant.seller_organization_id=review_case.seller_organization_id
        AND seller_grant.revoked_at IS NULL
        AND (seller_grant.expires_at IS NULL
          OR seller_grant.expires_at>NEW.created_at)
    )
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='REVIEW_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND (staff_grant.expires_at IS NULL
          OR staff_grant.expires_at>NEW.created_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_file_authority_mismatch');
END;

CREATE TRIGGER trg_seller_payment_proof_guard
BEFORE INSERT ON seller_payment_proofs
WHEN NOT EXISTS (
  SELECT 1
  FROM seller_payments payment
  JOIN file_objects object ON object.id=NEW.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id
    AND link.file_object_id=object.id
  WHERE payment.id=NEW.payment_id
    AND payment.seller_organization_id=NEW.seller_organization_id
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
    AND object.purpose='SELLER_SETTLEMENT_PROOF'
    AND intent.purpose='SELLER_SETTLEMENT_PROOF'
    AND object.visibility='INTERNAL_ONLY'
    AND intent.visibility='INTERNAL_ONLY'
    AND COALESCE(object.detected_mime, object.declared_mime)
      IN ('image/jpeg','image/png','image/webp')
    AND (
      (intent.owner_actor_type='STAFF'
        AND intent.owner_actor_id=payment.recorded_by_staff_id)
      OR intent.owner_actor_type='SYSTEM'
    )
    AND link.entity_type='SELLER_SETTLEMENT'
    AND link.entity_id=payment.id
    AND link.purpose='SELLER_SETTLEMENT_PROOF'
    AND link.visibility='INTERNAL_ONLY'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND (
      SELECT COUNT(*) FROM file_entity_audience_grants grant_row
      WHERE grant_row.file_entity_link_id=link.id
        AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL OR grant_row.expires_at>NEW.created_at)
    )=1
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='SELLER_SETTLEMENT_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND (staff_grant.expires_at IS NULL OR staff_grant.expires_at>NEW.created_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_proof_authority_mismatch');
END;

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

CREATE TRIGGER trg_staff_assignment_role_permission_defaults_no_delete
BEFORE DELETE ON staff_assignment_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT,
    'staff_assignment_role_permission_defaults_are_immutable');
END;

CREATE TRIGGER trg_staff_assignment_role_permission_defaults_no_update
BEFORE UPDATE ON staff_assignment_role_permission_defaults
BEGIN
  SELECT RAISE(ABORT,
    'staff_assignment_role_permission_defaults_are_immutable');
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

CREATE TRIGGER trg_staff_work_item_marketplace_after_insert
AFTER INSERT ON staff_work_items
BEGIN
  UPDATE staff_work_items
  SET marketplace_code = COALESCE(
    (
      SELECT mapping.marketplace_code
      FROM seller_store_marketplaces mapping
      WHERE mapping.store_id=NEW.store_id
      ORDER BY mapping.marketplace_code
      LIMIT 1
    ),
    (
      SELECT assignment.marketplace_code
      FROM buyer_marketplace_assignments assignment
      WHERE assignment.buyer_customer_id=NEW.buyer_customer_id
      ORDER BY assignment.marketplace_code
      LIMIT 1
    ),
    NEW.marketplace_code
  )
  WHERE id=NEW.id;
END;

CREATE TRIGGER trg_staff_work_items_assignment_guard
BEFORE INSERT ON staff_work_items
WHEN NOT (
  (NEW.fixed_assignment_type='BUYER' AND EXISTS (
    SELECT 1 FROM buyer_staff_assignments assignment
    WHERE assignment.id=NEW.fixed_assignment_id
      AND assignment.buyer_customer_id=NEW.buyer_customer_id
      AND assignment.duty_code=NEW.duty_code
      AND assignment.staff_id=NEW.assigned_staff_id
      AND assignment.status='ACTIVE'
  ))
  OR
  (NEW.fixed_assignment_type='SELLER' AND EXISTS (
    SELECT 1 FROM seller_staff_assignments assignment
    WHERE assignment.id=NEW.fixed_assignment_id
      AND assignment.seller_organization_id=NEW.seller_organization_id
      AND assignment.duty_code=NEW.duty_code
      AND assignment.staff_id=NEW.assigned_staff_id
      AND assignment.status='ACTIVE'
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'staff_work_item_assignment_mismatch');
END;

CREATE TRIGGER trg_staff_work_items_no_delete
BEFORE DELETE ON staff_work_items
BEGIN
  SELECT RAISE(ABORT, 'staff_work_items_are_immutable');
END;

CREATE TRIGGER trg_staff_work_items_update_guard
BEFORE UPDATE ON staff_work_items
WHEN NOT (
  (
    OLD.status='OPEN'
    AND NEW.status IN ('OPEN','COMPLETED','CANCELLED')
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
    AND NEW.marketplace_code IS OLD.marketplace_code
    AND NEW.created_at IS OLD.created_at
  )
  OR
  (
    NEW.id IS OLD.id
    AND NEW.work_type IS OLD.work_type
    AND NEW.source_entity_type IS OLD.source_entity_type
    AND NEW.source_entity_id IS OLD.source_entity_id
    AND NEW.buyer_customer_id IS OLD.buyer_customer_id
    AND NEW.seller_organization_id IS OLD.seller_organization_id
    AND NEW.store_id IS OLD.store_id
    AND NEW.duty_code IS OLD.duty_code
    AND NEW.fixed_assignment_type IS OLD.fixed_assignment_type
    AND NEW.fixed_assignment_id IS OLD.fixed_assignment_id
    AND NEW.assigned_staff_id IS OLD.assigned_staff_id
    AND NEW.status IS OLD.status
    AND NEW.version=OLD.version
    AND NEW.created_at IS OLD.created_at
    AND NEW.updated_at IS OLD.updated_at
    AND NEW.completed_at IS OLD.completed_at
    AND NEW.cancelled_at IS OLD.cancelled_at
    AND NEW.marketplace_code IS COALESCE(
      (
        SELECT mapping.marketplace_code
        FROM seller_store_marketplaces mapping
        WHERE mapping.store_id=NEW.store_id
        ORDER BY mapping.marketplace_code
        LIMIT 1
      ),
      (
        SELECT assignment.marketplace_code
        FROM buyer_marketplace_assignments assignment
        WHERE assignment.buyer_customer_id=NEW.buyer_customer_id
        ORDER BY assignment.marketplace_code
        LIMIT 1
      ),
      OLD.marketplace_code
    )
  )
)
BEGIN
  SELECT RAISE(ABORT,'staff_work_item_invalid_transition');
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


UPDATE app_schema_state
SET
  schema_version=28,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;

