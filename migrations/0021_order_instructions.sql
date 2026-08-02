PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Wave 10 / Phase 3G: Order Instructions Full Flow.
-- This migration is intentionally deterministic and upgrades schema 20 -> 21.
-- Historical rows remain unchanged; new business facts are required by guards.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=20
) THEN 1 ELSE 0 END;

-- ---------------------------------------------------------------------------
-- Product, Demand, Reservation and evidence/order snapshots.
-- ---------------------------------------------------------------------------
ALTER TABLE product_versions
ADD COLUMN default_buyer_self_pay_bps INTEGER NOT NULL DEFAULT 0
  CHECK (
    typeof(default_buyer_self_pay_bps)='integer'
    AND default_buyer_self_pay_bps BETWEEN 0 AND 10000
  );

CREATE TRIGGER trg_product_versions_self_pay_insert_guard
BEFORE INSERT ON product_versions
WHEN typeof(NEW.default_buyer_self_pay_bps)<>'integer'
  OR NEW.default_buyer_self_pay_bps NOT BETWEEN 0 AND 10000
BEGIN
  SELECT RAISE(ABORT, 'product_version_buyer_self_pay_bps_invalid');
END;

ALTER TABLE demand_batches
ADD COLUMN buyer_self_pay_bps_snapshot INTEGER
  CHECK (
    buyer_self_pay_bps_snapshot IS NULL
    OR (
      typeof(buyer_self_pay_bps_snapshot)='integer'
      AND buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
    )
  );
ALTER TABLE demand_batches
ADD COLUMN buyer_self_pay_source TEXT
  CHECK (
    buyer_self_pay_source IS NULL
    OR buyer_self_pay_source IN ('PRODUCT_DEFAULT', 'STAFF_OVERRIDE')
  );
ALTER TABLE demand_batches
ADD COLUMN buyer_self_pay_override_reason TEXT
  CHECK (
    buyer_self_pay_override_reason IS NULL
    OR length(buyer_self_pay_override_reason) BETWEEN 1 AND 1000
  );

CREATE TRIGGER trg_demand_buyer_self_pay_publish_guard_insert
BEFORE INSERT ON demand_batches
WHEN NEW.status='PUBLISHED'
  AND NOT (
    (NEW.buyer_self_pay_bps_snapshot IS NULL
      AND NEW.buyer_self_pay_source IS NULL
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.buyer_self_pay_source IN ('PRODUCT_DEFAULT', 'STAFF_OVERRIDE')
  AND (
    (NEW.buyer_self_pay_source='PRODUCT_DEFAULT'
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR
    (NEW.buyer_self_pay_source='STAFF_OVERRIDE'
      AND NEW.buyer_self_pay_override_reason IS NOT NULL
      AND length(NEW.buyer_self_pay_override_reason) BETWEEN 1 AND 1000)
  )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'demand_buyer_self_pay_snapshot_required');
END;

CREATE TRIGGER trg_demand_buyer_self_pay_publish_guard_update
BEFORE UPDATE OF status, buyer_self_pay_bps_snapshot,
  buyer_self_pay_source, buyer_self_pay_override_reason
ON demand_batches
WHEN NEW.status='PUBLISHED' AND NOT (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.buyer_self_pay_source IN ('PRODUCT_DEFAULT', 'STAFF_OVERRIDE')
  AND (
    (NEW.buyer_self_pay_source='PRODUCT_DEFAULT'
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR
    (NEW.buyer_self_pay_source='STAFF_OVERRIDE'
      AND NEW.buyer_self_pay_override_reason IS NOT NULL
      AND length(NEW.buyer_self_pay_override_reason) BETWEEN 1 AND 1000)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'demand_buyer_self_pay_snapshot_required');
END;

CREATE TRIGGER trg_demand_buyer_self_pay_published_immutable
BEFORE UPDATE OF buyer_self_pay_bps_snapshot,
  buyer_self_pay_source, buyer_self_pay_override_reason
ON demand_batches
WHEN OLD.status='PUBLISHED' AND (
  NOT (NEW.buyer_self_pay_bps_snapshot IS OLD.buyer_self_pay_bps_snapshot)
  OR NOT (NEW.buyer_self_pay_source IS OLD.buyer_self_pay_source)
  OR NOT (NEW.buyer_self_pay_override_reason IS OLD.buyer_self_pay_override_reason)
)
BEGIN
  SELECT RAISE(ABORT, 'published_demand_buyer_self_pay_is_immutable');
END;

ALTER TABLE product_reservations
ADD COLUMN buyer_self_pay_bps_snapshot INTEGER
  CHECK (
    buyer_self_pay_bps_snapshot IS NULL
    OR buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  );
ALTER TABLE product_reservations
ADD COLUMN reference_order_amount_jpy_snapshot INTEGER
  CHECK (
    reference_order_amount_jpy_snapshot IS NULL
    OR reference_order_amount_jpy_snapshot BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE product_reservations
ADD COLUMN estimated_self_pay_jpy_snapshot INTEGER
  CHECK (
    estimated_self_pay_jpy_snapshot IS NULL
    OR estimated_self_pay_jpy_snapshot BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE product_reservations
ADD COLUMN estimated_refundable_principal_jpy_snapshot INTEGER
  CHECK (
    estimated_refundable_principal_jpy_snapshot IS NULL
    OR estimated_refundable_principal_jpy_snapshot BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE product_reservations
ADD COLUMN buyer_self_pay_accepted_at INTEGER
  CHECK (buyer_self_pay_accepted_at IS NULL OR buyer_self_pay_accepted_at >= 0);
ALTER TABLE product_reservations
ADD COLUMN buyer_self_pay_accepted_demand_version INTEGER
  CHECK (
    buyer_self_pay_accepted_demand_version IS NULL
    OR buyer_self_pay_accepted_demand_version >= 1
  );

CREATE TRIGGER trg_reservation_self_pay_snapshot_insert_guard
BEFORE INSERT ON product_reservations
WHEN NOT (
  (
    NEW.buyer_self_pay_bps_snapshot IS NULL
    AND NEW.reference_order_amount_jpy_snapshot IS NULL
    AND NEW.estimated_self_pay_jpy_snapshot IS NULL
    AND NEW.estimated_refundable_principal_jpy_snapshot IS NULL
    AND NEW.buyer_self_pay_accepted_at IS NULL
    AND NEW.buyer_self_pay_accepted_demand_version IS NULL
  )
  OR (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.reference_order_amount_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_self_pay_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_refundable_principal_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_self_pay_jpy_snapshot
      + NEW.estimated_refundable_principal_jpy_snapshot
      = NEW.reference_order_amount_jpy_snapshot
  AND NEW.buyer_self_pay_accepted_at IS NOT NULL
  AND NEW.buyer_self_pay_accepted_demand_version >= 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'reservation_buyer_self_pay_snapshot_required');
END;

CREATE TRIGGER trg_reservation_self_pay_snapshot_immutable
BEFORE UPDATE OF buyer_self_pay_bps_snapshot,
  reference_order_amount_jpy_snapshot,
  estimated_self_pay_jpy_snapshot,
  estimated_refundable_principal_jpy_snapshot,
  buyer_self_pay_accepted_at,
  buyer_self_pay_accepted_demand_version
ON product_reservations
BEGIN
  SELECT RAISE(ABORT, 'reservation_buyer_self_pay_snapshot_immutable');
END;

ALTER TABLE order_evidence_submissions
ADD COLUMN resubmission_deadline_at INTEGER
  CHECK (
    resubmission_deadline_at IS NULL
    OR resubmission_deadline_at >= submitted_at
  );

ALTER TABLE order_evidence_versions
ADD COLUMN order_instruction_id TEXT REFERENCES order_instructions(id);
ALTER TABLE order_evidence_versions
ADD COLUMN order_instruction_version_id TEXT REFERENCES order_instruction_versions(id);
ALTER TABLE order_evidence_versions
ADD COLUMN instruction_deadline_snapshot INTEGER
  CHECK (
    instruction_deadline_snapshot IS NULL
    OR instruction_deadline_snapshot >= 0
  );
ALTER TABLE order_evidence_versions
ADD COLUMN reference_order_amount_jpy_snapshot INTEGER
  CHECK (
    reference_order_amount_jpy_snapshot IS NULL
    OR reference_order_amount_jpy_snapshot BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE order_evidence_versions
ADD COLUMN buyer_self_pay_bps_snapshot INTEGER
  CHECK (
    buyer_self_pay_bps_snapshot IS NULL
    OR buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  );
ALTER TABLE order_evidence_versions
ADD COLUMN buyer_self_pay_jpy INTEGER
  CHECK (
    buyer_self_pay_jpy IS NULL
    OR buyer_self_pay_jpy BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE order_evidence_versions
ADD COLUMN buyer_refundable_principal_jpy INTEGER
  CHECK (
    buyer_refundable_principal_jpy IS NULL
    OR buyer_refundable_principal_jpy BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE order_evidence_versions
ADD COLUMN price_mismatch INTEGER
  CHECK (price_mismatch IS NULL OR price_mismatch IN (0, 1));
ALTER TABLE order_evidence_versions
ADD COLUMN price_difference_jpy INTEGER
  CHECK (
    price_difference_jpy IS NULL
    OR price_difference_jpy BETWEEN -9007199254740991 AND 9007199254740991
  );
ALTER TABLE order_evidence_versions
ADD COLUMN submitted_before_deadline INTEGER
  CHECK (submitted_before_deadline IS NULL OR submitted_before_deadline IN (0, 1));
ALTER TABLE order_evidence_versions
ADD COLUMN evidence_file_object_id TEXT REFERENCES file_objects(id);

CREATE INDEX idx_order_evidence_versions_instruction
ON order_evidence_versions (
  order_instruction_id,
  order_instruction_version_id,
  version_no,
  id
);

ALTER TABLE formal_orders
ADD COLUMN order_instruction_id TEXT REFERENCES order_instructions(id);
ALTER TABLE formal_orders
ADD COLUMN order_instruction_version_id TEXT REFERENCES order_instruction_versions(id);

CREATE INDEX idx_formal_orders_instruction
ON formal_orders (order_instruction_id, order_instruction_version_id, id);

ALTER TABLE formal_order_financial_snapshots
ADD COLUMN buyer_self_pay_bps INTEGER
  CHECK (buyer_self_pay_bps IS NULL OR buyer_self_pay_bps BETWEEN 0 AND 10000);
ALTER TABLE formal_order_financial_snapshots
ADD COLUMN buyer_self_pay_jpy INTEGER
  CHECK (
    buyer_self_pay_jpy IS NULL
    OR buyer_self_pay_jpy BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE formal_order_financial_snapshots
ADD COLUMN buyer_refundable_principal_jpy INTEGER
  CHECK (
    buyer_refundable_principal_jpy IS NULL
    OR buyer_refundable_principal_jpy BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE formal_order_financial_snapshots
ADD COLUMN buyer_gross_principal_cny_fen INTEGER
  CHECK (
    buyer_gross_principal_cny_fen IS NULL
    OR buyer_gross_principal_cny_fen BETWEEN 0 AND 9007199254740991
  );
ALTER TABLE formal_order_financial_snapshots
ADD COLUMN buyer_self_pay_contribution_cny_fen INTEGER
  CHECK (
    buyer_self_pay_contribution_cny_fen IS NULL
    OR buyer_self_pay_contribution_cny_fen BETWEEN 0 AND 9007199254740991
  );

-- ---------------------------------------------------------------------------
-- Staff permission and direct work-item enum extension.
-- ---------------------------------------------------------------------------
CREATE TABLE phase3g_backup_staff_permission_overrides AS
SELECT * FROM staff_permission_overrides;
DROP TABLE staff_permission_overrides;
CREATE TABLE staff_permission_overrides (
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  permission_code TEXT NOT NULL CHECK (permission_code IN (
    'TASK_VIEW_OPEN','TASK_CLAIM','TASK_VIEW_TEAM','TASK_ASSIGN_TEAM',
    'TASK_REASSIGN_TEAM','TASK_TAKEOVER_TEAM','TASK_COLLABORATE_TEAM',
    'BUYER_VIEW','BUYER_CREATE','BUYER_ACTIVATE_STANDARD',
    'BUYER_IDENTITY_HIGH_RISK_MANAGE','SELLER_VIEW','SELLER_MANAGE',
    'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
    'RESERVATION_VIEW','RESERVATION_DECIDE','ORDER_VIEW','ORDER_CONFIRM',
    'REVIEW_VIEW','REVIEW_DECIDE','BUYER_REFUND_VIEW','BUYER_REFUND_RECORD',
    'SELLER_SETTLEMENT_VIEW','SELLER_SETTLEMENT_RECORD',
    'BUYER_SUPPORT_VIEW','BUYER_SUPPORT_NOTE','SELLER_SUPPORT_VIEW',
    'SELLER_SUPPORT_NOTE','FINANCIAL_CORRECT','FINANCIAL_EXPORT',
    'STAFF_MANAGE','PERMISSION_MANAGE','AUDIT_VIEW',
    'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
    'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND','ASSIGNMENT_BATCH_TRANSFER',
    'ASSIGNMENT_AVAILABILITY_MANAGE',
    'ORDER_INSTRUCTION_VIEW','ORDER_INSTRUCTION_PUBLISH',
    'ORDER_INSTRUCTION_MANAGE','ORDER_INSTRUCTION_EXPIRY_RUN'
  )),
  effect TEXT NOT NULL CHECK (effect IN ('GRANT','DENY')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  assigned_by_staff_id TEXT REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL CHECK (assigned_at >= 0),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (staff_id, permission_code),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;
INSERT INTO staff_permission_overrides
SELECT * FROM phase3g_backup_staff_permission_overrides;
CREATE INDEX idx_staff_permission_override_effect_status
ON staff_permission_overrides (effect,status,permission_code,staff_id);
DROP TABLE phase3g_backup_staff_permission_overrides;

CREATE TABLE phase3g_backup_staff_assignment_role_permission_defaults AS
SELECT * FROM staff_assignment_role_permission_defaults;
DROP TABLE staff_assignment_role_permission_defaults;
CREATE TABLE staff_assignment_role_permission_defaults (
  role_code TEXT NOT NULL CHECK (role_code IN (
    'owner','pre_sales','seller_ops','seller_support','after_sales','buyer_support'
  )),
  permission_code TEXT NOT NULL CHECK (permission_code IN (
    'TASK_VIEW_OPEN','TASK_CLAIM','TASK_VIEW_TEAM','TASK_ASSIGN_TEAM',
    'TASK_REASSIGN_TEAM','TASK_TAKEOVER_TEAM','TASK_COLLABORATE_TEAM',
    'BUYER_VIEW','BUYER_CREATE','BUYER_ACTIVATE_STANDARD',
    'BUYER_IDENTITY_HIGH_RISK_MANAGE','SELLER_VIEW','SELLER_MANAGE',
    'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
    'RESERVATION_VIEW','RESERVATION_DECIDE','ORDER_VIEW','ORDER_CONFIRM',
    'REVIEW_VIEW','REVIEW_DECIDE','BUYER_REFUND_VIEW','BUYER_REFUND_RECORD',
    'SELLER_SETTLEMENT_VIEW','SELLER_SETTLEMENT_RECORD',
    'BUYER_SUPPORT_VIEW','BUYER_SUPPORT_NOTE','SELLER_SUPPORT_VIEW',
    'SELLER_SUPPORT_NOTE','FINANCIAL_CORRECT','FINANCIAL_EXPORT',
    'STAFF_MANAGE','PERMISSION_MANAGE','AUDIT_VIEW',
    'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
    'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND','ASSIGNMENT_BATCH_TRANSFER',
    'ASSIGNMENT_AVAILABILITY_MANAGE',
    'ORDER_INSTRUCTION_VIEW','ORDER_INSTRUCTION_PUBLISH',
    'ORDER_INSTRUCTION_MANAGE','ORDER_INSTRUCTION_EXPIRY_RUN'
  )),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (role_code, permission_code)
) STRICT;
INSERT INTO staff_assignment_role_permission_defaults
SELECT * FROM phase3g_backup_staff_assignment_role_permission_defaults;
INSERT OR IGNORE INTO staff_assignment_role_permission_defaults
  (role_code, permission_code, created_at)
VALUES
  ('owner','ORDER_INSTRUCTION_VIEW',CAST(unixepoch('now') AS INTEGER)*1000),
  ('owner','ORDER_INSTRUCTION_PUBLISH',CAST(unixepoch('now') AS INTEGER)*1000),
  ('owner','ORDER_INSTRUCTION_MANAGE',CAST(unixepoch('now') AS INTEGER)*1000),
  ('owner','ORDER_INSTRUCTION_EXPIRY_RUN',CAST(unixepoch('now') AS INTEGER)*1000),
  ('pre_sales','ORDER_INSTRUCTION_VIEW',CAST(unixepoch('now') AS INTEGER)*1000),
  ('pre_sales','ORDER_INSTRUCTION_PUBLISH',CAST(unixepoch('now') AS INTEGER)*1000);
DROP TABLE phase3g_backup_staff_assignment_role_permission_defaults;

CREATE TABLE phase3g_backup_staff_assignment_events AS
SELECT * FROM staff_assignment_events;
CREATE TABLE phase3g_backup_staff_work_items AS
SELECT * FROM staff_work_items;
DROP TABLE staff_assignment_events;
DROP TABLE staff_work_items;

CREATE TABLE staff_work_items (
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
    'SELLER_ACCOUNT_MANAGER','BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER','BUYER_REFUND_OWNER'
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
  cancelled_at INTEGER,
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
    OR (status='COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='CANCELLED' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  )
) STRICT;
INSERT INTO staff_work_items SELECT * FROM phase3g_backup_staff_work_items;
CREATE UNIQUE INDEX uq_staff_work_item_open_source
ON staff_work_items (source_entity_type,source_entity_id,work_type)
WHERE status='OPEN';
CREATE INDEX idx_staff_work_items_assignee_status
ON staff_work_items (assigned_staff_id,status,created_at,id);
CREATE INDEX idx_staff_work_items_buyer_status
ON staff_work_items (buyer_customer_id,status,duty_code,id)
WHERE buyer_customer_id IS NOT NULL;
CREATE INDEX idx_staff_work_items_seller_status
ON staff_work_items (seller_organization_id,status,duty_code,id)
WHERE seller_organization_id IS NOT NULL;

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
CREATE TRIGGER trg_staff_work_items_update_guard
BEFORE UPDATE ON staff_work_items
WHEN NOT (
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
    'AUTO_INITIAL_ASSIGNMENT','AUTO_REPLACEMENT','OWNER_FALLBACK',
    'MANUAL_WORK_ITEM_REASSIGN','FIXED_OWNER_CHANGED',
    'BATCH_TRANSFER_STARTED','BATCH_TRANSFER_ITEM_COMPLETED',
    'BATCH_TRANSFER_COMPLETED','AVAILABILITY_CHANGED','WORK_ITEM_CREATED',
    'WORK_ITEM_COMPLETED','WORK_ITEM_CANCELLED','ASSIGNMENT_FAILED'
  )),
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'BUYER_CUSTOMER','SELLER_ORGANIZATION','STAFF','WORK_ITEM',
    'REASSIGNMENT_BATCH','MARKETPLACE'
  )),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  duty_code TEXT CHECK (duty_code IS NULL OR duty_code IN (
    'SELLER_ACCOUNT_MANAGER','BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER','BUYER_REFUND_OWNER'
  )),
  assignment_id TEXT,
  work_item_id TEXT REFERENCES staff_work_items(id),
  batch_id TEXT,
  old_staff_id TEXT REFERENCES staff_users(id),
  new_staff_id TEXT REFERENCES staff_users(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','SYSTEM')),
  actor_id TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  request_id TEXT,
  idempotency_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object'),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;
INSERT INTO staff_assignment_events
SELECT * FROM phase3g_backup_staff_assignment_events;
CREATE INDEX idx_staff_assignment_events_subject
ON staff_assignment_events (subject_type,subject_id,created_at,id);
CREATE INDEX idx_staff_assignment_events_staff
ON staff_assignment_events (new_staff_id,old_staff_id,created_at,id);
CREATE UNIQUE INDEX uq_staff_assignment_event_work_item_terminal
ON staff_assignment_events (work_item_id,event_type)
WHERE work_item_id IS NOT NULL
  AND event_type IN ('WORK_ITEM_CREATED','WORK_ITEM_COMPLETED','WORK_ITEM_CANCELLED');
CREATE UNIQUE INDEX uq_staff_assignment_event_batch_item_completed
ON staff_assignment_events (batch_id,subject_type,subject_id,event_type)
WHERE batch_id IS NOT NULL AND event_type='BATCH_TRANSFER_ITEM_COMPLETED';
CREATE UNIQUE INDEX uq_staff_assignment_failure_idempotency
ON staff_assignment_events (
  subject_type,subject_id,duty_code,idempotency_key,event_type
)
WHERE event_type='ASSIGNMENT_FAILED' AND idempotency_key IS NOT NULL;
CREATE TRIGGER trg_staff_assignment_events_no_update
BEFORE UPDATE ON staff_assignment_events
BEGIN SELECT RAISE(ABORT,'staff_assignment_events_are_immutable'); END;
CREATE TRIGGER trg_staff_assignment_events_no_delete
BEFORE DELETE ON staff_assignment_events
BEGIN SELECT RAISE(ABORT,'staff_assignment_events_are_immutable'); END;
DROP TABLE phase3g_backup_staff_assignment_events;
DROP TABLE phase3g_backup_staff_work_items;

-- ---------------------------------------------------------------------------
-- File enum extension. Preserve the entire authorization graph and history.
-- ---------------------------------------------------------------------------
CREATE TABLE phase3g_backup_product_version_main_images AS
SELECT * FROM product_version_main_images;
CREATE TABLE phase3g_backup_file_upload_intents AS SELECT * FROM file_upload_intents;
CREATE TABLE phase3g_backup_file_objects AS SELECT * FROM file_objects;
CREATE TABLE phase3g_backup_file_entity_links AS SELECT * FROM file_entity_links;
CREATE TABLE phase3g_backup_file_read_intents AS SELECT * FROM file_read_intents;
CREATE TABLE phase3g_backup_file_events AS SELECT * FROM file_events;
CREATE TABLE phase3g_backup_file_entity_audience_grants AS
SELECT * FROM file_entity_audience_grants;
CREATE TABLE phase3g_backup_file_audience_events AS SELECT * FROM file_audience_events;
CREATE TABLE phase3g_backup_order_evidence_version_files AS
SELECT * FROM order_evidence_version_files;
CREATE TABLE phase3g_backup_review_evidence_version_files AS
SELECT * FROM review_evidence_version_files;
CREATE TABLE phase3g_backup_buyer_refund_payment_entry_files AS
SELECT * FROM buyer_refund_payment_entry_files;

DROP TABLE product_version_main_images;
DROP TABLE order_evidence_version_files;
DROP TABLE review_evidence_version_files;
DROP TABLE buyer_refund_payment_entry_files;
DROP TABLE file_audience_events;
DROP TABLE file_read_intents;
DROP TABLE file_entity_audience_grants;
DROP TABLE file_events;
DROP TABLE file_entity_links;
DROP TABLE file_objects;
DROP TABLE file_upload_intents;

CREATE TABLE file_upload_intents (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  owner_actor_type TEXT NOT NULL CHECK (owner_actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  owner_actor_id TEXT NOT NULL CHECK (length(owner_actor_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE','PRODUCT_IMAGE','ORDER_EVIDENCE',
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
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
INSERT INTO file_upload_intents SELECT * FROM phase3g_backup_file_upload_intents;
CREATE INDEX idx_file_upload_intents_owner_status
ON file_upload_intents (owner_actor_type,owner_actor_id,status,created_at,id);
CREATE INDEX idx_file_upload_intents_expiry
ON file_upload_intents (status,expires_at,id);

CREATE TABLE file_objects (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  upload_intent_id TEXT NOT NULL REFERENCES file_upload_intents(id),
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 1 AND 10),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE','PRODUCT_IMAGE','ORDER_EVIDENCE',
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
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
    purpose<>'ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
    OR declared_mime IN ('image/jpeg','image/png','image/webp')
  )
) STRICT;
INSERT INTO file_objects SELECT * FROM phase3g_backup_file_objects;
CREATE INDEX idx_file_objects_intent_status
ON file_objects (upload_intent_id,status,slot_no,id);
CREATE INDEX idx_file_objects_cleanup
ON file_objects (status,next_delete_at,delete_attempt_count,id);

CREATE TABLE file_entity_links (
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
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
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
    OR (purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
      AND entity_type='ORDER_EVIDENCE_SUBMISSION')
    OR (purpose='ORDER_EVIDENCE' AND entity_type='ORDER')
    OR (purpose='REVIEW_EVIDENCE' AND entity_type='REVIEW')
    OR (purpose='BUYER_REFUND_PROOF' AND entity_type='BUYER_REFUND')
    OR (purpose='SELLER_SETTLEMENT_PROOF' AND entity_type='SELLER_SETTLEMENT')
    OR (purpose='SUPPORT_ATTACHMENT' AND entity_type='SUPPORT_CASE')
  )
) STRICT;
INSERT INTO file_entity_links SELECT * FROM phase3g_backup_file_entity_links;
CREATE INDEX idx_file_entity_links_entity
ON file_entity_links (entity_type,entity_id,purpose,created_at,id);
CREATE INDEX idx_file_entity_links_authorization
ON file_entity_links (
  authorization_mode,file_object_id,revoked_at,expires_at,created_at,id
);
CREATE UNIQUE INDEX uq_product_image_file_object
ON file_entity_links (file_object_id)
WHERE purpose='PRODUCT_IMAGE' AND entity_type='PRODUCT_VERSION';

CREATE TABLE file_entity_audience_grants (
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
  staff_team_id TEXT REFERENCES staff_teams(id),
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
INSERT INTO file_entity_audience_grants
SELECT * FROM phase3g_backup_file_entity_audience_grants;
CREATE UNIQUE INDEX uq_file_audience_grant_subject
ON file_entity_audience_grants (
  file_entity_link_id,subject_type,
  ifnull(buyer_customer_id,''),ifnull(seller_organization_id,'')
);
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

CREATE TABLE file_read_intents (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'ISSUED','CONSUMED','EXPIRED','REVOKED'
  )),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count IN (0,1)),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  consumed_at INTEGER,
  revoked_at INTEGER,
  file_entity_link_id TEXT REFERENCES file_entity_links(id),
  CHECK (expires_at > created_at),
  CHECK (
    (status='ISSUED' AND use_count=0 AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status='CONSUMED' AND use_count=1 AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR (status='EXPIRED' AND use_count=0 AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status='REVOKED' AND use_count=0 AND consumed_at IS NULL AND revoked_at IS NOT NULL)
  )
) STRICT;
INSERT INTO file_read_intents SELECT * FROM phase3g_backup_file_read_intents;
CREATE INDEX idx_file_read_intents_actor_status
ON file_read_intents (actor_type,actor_id,status,expires_at,id);
CREATE INDEX idx_file_read_intents_file_status
ON file_read_intents (file_object_id,status,created_at,id);

CREATE TABLE file_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  upload_intent_id TEXT REFERENCES file_upload_intents(id),
  file_object_id TEXT REFERENCES file_objects(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'UPLOAD_INTENT_ISSUED','FILE_OBJECT_UPLOADED','FILE_UPLOAD_VERIFIED',
    'FILE_UPLOAD_FAILED','FILE_OBJECT_LINKED','FILE_READ_INTENT_ISSUED',
    'FILE_READ_INTENT_CONSUMED','FILE_COMPENSATION_SCHEDULED',
    'FILE_OBJECT_DELETED'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT,
  next_status TEXT NOT NULL CHECK (length(next_status) BETWEEN 1 AND 40),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (upload_intent_id IS NOT NULL OR file_object_id IS NOT NULL)
) STRICT;
INSERT INTO file_events SELECT * FROM phase3g_backup_file_events;
CREATE INDEX idx_file_events_intent ON file_events (upload_intent_id,created_at,id);
CREATE INDEX idx_file_events_object ON file_events (file_object_id,created_at,id);

CREATE TABLE file_audience_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  file_entity_link_id TEXT NOT NULL REFERENCES file_entity_links(id),
  grant_id TEXT REFERENCES file_entity_audience_grants(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'EXPLICIT_LINK_CREATED','AUDIENCE_GRANT_CREATED',
    'AUDIENCE_GRANT_REVOKED','EXPLICIT_LINK_REVOKED'
  )),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'PRODUCT_APPLICATION','PRODUCT_VERSION','ORDER_INSTRUCTION_VERSION',
    'ORDER_EVIDENCE_SUBMISSION','ORDER','REVIEW','BUYER_REFUND',
    'SELLER_SETTLEMENT','SUPPORT_CASE'
  )),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  subject_type TEXT CHECK (subject_type IS NULL OR subject_type IN (
    'BUYER','SELLER_ORGANIZATION','STAFF_INTERNAL'
  )),
  subject_authority_id TEXT CHECK (
    subject_authority_id IS NULL OR length(subject_authority_id) BETWEEN 1 AND 200
  ),
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  effective_at INTEGER NOT NULL CHECK (effective_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (
    (event_type IN ('EXPLICIT_LINK_CREATED','EXPLICIT_LINK_REVOKED')
      AND grant_id IS NULL AND subject_type IS NULL
      AND subject_authority_id IS NULL)
    OR (event_type IN ('AUDIENCE_GRANT_CREATED','AUDIENCE_GRANT_REVOKED')
      AND grant_id IS NOT NULL AND subject_type IS NOT NULL
      AND subject_authority_id IS NOT NULL)
  )
) STRICT;
INSERT INTO file_audience_events SELECT * FROM phase3g_backup_file_audience_events;
CREATE INDEX idx_file_audience_events_link
ON file_audience_events (file_entity_link_id,created_at,id);

CREATE TABLE order_evidence_version_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  version_id TEXT NOT NULL REFERENCES order_evidence_versions(id),
  submission_id TEXT NOT NULL REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('INTERNAL_ONLY','BUYER_VISIBLE')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (version_id,file_object_id)
) STRICT;
INSERT INTO order_evidence_version_files
SELECT * FROM phase3g_backup_order_evidence_version_files;
CREATE INDEX idx_order_evidence_version_files_submission
ON order_evidence_version_files (submission_id,version_id,created_at,id);
CREATE INDEX idx_order_evidence_version_files_object
ON order_evidence_version_files (file_object_id,submission_id,version_id,id);

CREATE TABLE review_evidence_version_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  review_case_id TEXT NOT NULL REFERENCES review_cases(id),
  evidence_version_id TEXT NOT NULL REFERENCES review_evidence_versions(id),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (evidence_version_id,file_object_id)
) STRICT;
INSERT INTO review_evidence_version_files
SELECT * FROM phase3g_backup_review_evidence_version_files;
CREATE INDEX idx_review_evidence_files_version
ON review_evidence_version_files (evidence_version_id,created_at,id);

CREATE TABLE buyer_refund_payment_entry_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  obligation_id TEXT NOT NULL REFERENCES buyer_refund_obligations(id),
  payment_entry_id TEXT NOT NULL REFERENCES buyer_refund_payment_entries(id),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (payment_entry_id,file_object_id)
) STRICT;
INSERT INTO buyer_refund_payment_entry_files
SELECT * FROM phase3g_backup_buyer_refund_payment_entry_files;
CREATE INDEX idx_buyer_refund_payment_entry_files_payment
ON buyer_refund_payment_entry_files (payment_entry_id,created_at,id);

-- Recreate the authority and immutability guards lost while extending the
-- shared file enums. These are Wave 8/9 guarantees, not Phase 3G relaxations.
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
CREATE TRIGGER trg_review_evidence_version_files_no_update
BEFORE UPDATE ON review_evidence_version_files
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_version_files_are_immutable');
END;
CREATE TRIGGER trg_review_evidence_version_files_no_delete
BEFORE DELETE ON review_evidence_version_files
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_version_files_are_immutable');
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
CREATE TRIGGER trg_buyer_refund_payment_entry_files_no_update
BEFORE UPDATE ON buyer_refund_payment_entry_files
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_entry_files_are_immutable');
END;
CREATE TRIGGER trg_buyer_refund_payment_entry_files_no_delete
BEFORE DELETE ON buyer_refund_payment_entry_files
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_entry_files_are_immutable');
END;

CREATE TABLE product_version_main_images (
  product_version_id TEXT PRIMARY KEY REFERENCES product_versions(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;
INSERT INTO product_version_main_images
SELECT * FROM phase3g_backup_product_version_main_images;
CREATE INDEX idx_product_version_main_images_link
ON product_version_main_images (file_entity_link_id,product_version_id);

-- Restore file graph guards.
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

CREATE TRIGGER trg_product_image_file_links_no_update
BEFORE UPDATE ON file_entity_links
WHEN OLD.purpose='PRODUCT_IMAGE' AND OLD.entity_type='PRODUCT_VERSION'
BEGIN SELECT RAISE(ABORT,'product_image_file_links_are_immutable'); END;
CREATE TRIGGER trg_product_image_file_links_no_delete
BEFORE DELETE ON file_entity_links
WHEN OLD.purpose='PRODUCT_IMAGE' AND OLD.entity_type='PRODUCT_VERSION'
BEGIN SELECT RAISE(ABORT,'product_image_file_links_are_immutable'); END;

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
CREATE TRIGGER trg_file_audience_grants_no_delete
BEFORE DELETE ON file_entity_audience_grants
BEGIN SELECT RAISE(ABORT,'file_audience_grants_are_immutable'); END;

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

CREATE TRIGGER trg_file_events_no_update BEFORE UPDATE ON file_events
BEGIN SELECT RAISE(ABORT,'file_events_are_immutable'); END;
CREATE TRIGGER trg_file_events_no_delete BEFORE DELETE ON file_events
BEGIN SELECT RAISE(ABORT,'file_events_are_immutable'); END;
CREATE TRIGGER trg_file_audience_events_no_update BEFORE UPDATE ON file_audience_events
BEGIN SELECT RAISE(ABORT,'file_audience_events_are_immutable'); END;
CREATE TRIGGER trg_file_audience_events_no_delete BEFORE DELETE ON file_audience_events
BEGIN SELECT RAISE(ABORT,'file_audience_events_are_immutable'); END;

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
CREATE TRIGGER trg_order_evidence_version_files_no_update
BEFORE UPDATE ON order_evidence_version_files
BEGIN SELECT RAISE(ABORT,'order_evidence_version_files_are_immutable'); END;
CREATE TRIGGER trg_order_evidence_version_files_no_delete
BEFORE DELETE ON order_evidence_version_files
BEGIN SELECT RAISE(ABORT,'order_evidence_version_files_are_immutable'); END;

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
CREATE TRIGGER trg_product_version_main_images_no_update
BEFORE UPDATE ON product_version_main_images
BEGIN SELECT RAISE(ABORT,'product_version_main_images_are_immutable'); END;
CREATE TRIGGER trg_product_version_main_images_no_delete
BEFORE DELETE ON product_version_main_images
BEGIN SELECT RAISE(ABORT,'product_version_main_images_are_immutable'); END;

DROP TABLE phase3g_backup_product_version_main_images;
DROP TABLE phase3g_backup_file_upload_intents;
DROP TABLE phase3g_backup_file_objects;
DROP TABLE phase3g_backup_file_entity_links;
DROP TABLE phase3g_backup_file_read_intents;
DROP TABLE phase3g_backup_file_events;
DROP TABLE phase3g_backup_file_entity_audience_grants;
DROP TABLE phase3g_backup_file_audience_events;
DROP TABLE phase3g_backup_order_evidence_version_files;
DROP TABLE phase3g_backup_review_evidence_version_files;
DROP TABLE phase3g_backup_buyer_refund_payment_entry_files;

-- ---------------------------------------------------------------------------
-- Order Instruction aggregate and immutable versions.
-- ---------------------------------------------------------------------------
CREATE TABLE order_instructions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  reservation_id TEXT NOT NULL UNIQUE REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplaces(code)
    CHECK (marketplace_code='JP'),
  status TEXT NOT NULL CHECK (status IN (
    'UNPUBLISHED', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'COMPLETED'
  )),
  current_version_no INTEGER NOT NULL DEFAULT 0 CHECK (current_version_no >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  published_at INTEGER CHECK (published_at IS NULL OR published_at >= 0),
  initial_deadline_at INTEGER CHECK (
    initial_deadline_at IS NULL OR initial_deadline_at > published_at
  ),
  resubmission_deadline_at INTEGER CHECK (
    resubmission_deadline_at IS NULL OR resubmission_deadline_at >= 0
  ),
  expired_at INTEGER CHECK (expired_at IS NULL OR expired_at >= 0),
  cancelled_at INTEGER CHECK (cancelled_at IS NULL OR cancelled_at >= 0),
  completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (status='UNPUBLISHED'
      AND current_version_no=0
      AND published_at IS NULL
      AND initial_deadline_at IS NULL
      AND expired_at IS NULL
      AND cancelled_at IS NULL
      AND completed_at IS NULL)
    OR
    (status='ACTIVE'
      AND current_version_no>=1
      AND published_at IS NOT NULL
      AND initial_deadline_at IS NOT NULL
      AND expired_at IS NULL
      AND cancelled_at IS NULL
      AND completed_at IS NULL)
    OR
    (status='EXPIRED'
      AND expired_at IS NOT NULL
      AND cancelled_at IS NULL
      AND completed_at IS NULL)
    OR
    (status='CANCELLED'
      AND cancelled_at IS NOT NULL
      AND expired_at IS NULL
      AND completed_at IS NULL)
    OR
    (status='COMPLETED'
      AND current_version_no>=1
      AND completed_at IS NOT NULL
      AND expired_at IS NULL
      AND cancelled_at IS NULL)
  )
) STRICT;

CREATE INDEX idx_order_instructions_buyer_status
ON order_instructions (buyer_customer_id, status, updated_at, id);
CREATE INDEX idx_order_instructions_expiry
ON order_instructions (
  marketplace_code, status,
  initial_deadline_at, resubmission_deadline_at, id
);

CREATE TRIGGER trg_order_instruction_reservation_guard
BEFORE INSERT ON order_instructions
WHEN NOT EXISTS (
  SELECT 1 FROM product_reservations reservation
  WHERE reservation.id=NEW.reservation_id
    AND reservation.buyer_customer_id=NEW.buyer_customer_id
    AND reservation.marketplace_code=NEW.marketplace_code
    AND reservation.status='APPROVED'
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_reservation_not_approved');
END;

CREATE TRIGGER trg_order_instruction_identity_immutable
BEFORE UPDATE OF id, reservation_id, buyer_customer_id,
  marketplace_code, created_at
ON order_instructions
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_identity_immutable');
END;

CREATE TRIGGER trg_order_instruction_transition_guard
BEFORE UPDATE ON order_instructions
WHEN NOT (
  NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND (
    (OLD.status='UNPUBLISHED' AND NEW.status IN ('ACTIVE','CANCELLED'))
    OR (OLD.status='ACTIVE' AND NEW.status IN (
      'ACTIVE','EXPIRED','CANCELLED','COMPLETED'
    ))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_invalid_transition');
END;

CREATE TRIGGER trg_order_instructions_no_delete
BEFORE DELETE ON order_instructions
BEGIN
  SELECT RAISE(ABORT, 'order_instructions_are_immutable');
END;

CREATE TABLE order_instruction_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  instruction_id TEXT NOT NULL REFERENCES order_instructions(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  reservation_id TEXT NOT NULL REFERENCES product_reservations(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_version_id TEXT NOT NULL REFERENCES product_versions(id),
  product_version_no INTEGER NOT NULL CHECK (product_version_no >= 1),
  main_image_file_entity_link_id TEXT NOT NULL REFERENCES file_entity_links(id),
  store_display_name_snapshot TEXT NOT NULL
    CHECK (length(store_display_name_snapshot) BETWEEN 1 AND 200),
  demand_buyer_visible_notes_snapshot TEXT CHECK (
    demand_buyer_visible_notes_snapshot IS NULL
    OR length(demand_buyer_visible_notes_snapshot) BETWEEN 1 AND 2000
  ),
  staff_public_note TEXT CHECK (
    staff_public_note IS NULL OR length(staff_public_note) BETWEEN 1 AND 2000
  ),
  reference_order_amount_jpy INTEGER NOT NULL CHECK (
    reference_order_amount_jpy BETWEEN 0 AND 9007199254740991
  ),
  buyer_self_pay_bps INTEGER NOT NULL CHECK (buyer_self_pay_bps BETWEEN 0 AND 10000),
  estimated_self_pay_jpy INTEGER NOT NULL CHECK (
    estimated_self_pay_jpy BETWEEN 0 AND 9007199254740991
  ),
  estimated_refundable_principal_jpy INTEGER NOT NULL CHECK (
    estimated_refundable_principal_jpy BETWEEN 0 AND 9007199254740991
  ),
  color_spec_mode TEXT NOT NULL CHECK (
    color_spec_mode IN ('MAIN_IMAGE_VARIANT', 'ANY_VARIANT')
  ),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  generator_version TEXT NOT NULL CHECK (length(generator_version) BETWEEN 1 AND 100),
  published_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  initial_deadline_at INTEGER NOT NULL CHECK (
    initial_deadline_at>published_at
  ),
  created_at INTEGER NOT NULL CHECK (created_at=published_at),
  UNIQUE (instruction_id, version_no),
  CHECK (
    estimated_self_pay_jpy + estimated_refundable_principal_jpy
      = reference_order_amount_jpy
  )
) STRICT;

CREATE INDEX idx_order_instruction_versions_instruction
ON order_instruction_versions (instruction_id, version_no DESC, id);
CREATE INDEX idx_order_instruction_versions_product_version
ON order_instruction_versions (product_version_id, instruction_id, version_no);

CREATE TRIGGER trg_order_instruction_version_source_guard
BEFORE INSERT ON order_instruction_versions
WHEN NOT EXISTS (
  SELECT 1
  FROM order_instructions instruction
  JOIN product_reservations reservation
    ON reservation.id=instruction.reservation_id
  JOIN product_versions version
    ON version.id=NEW.product_version_id
    AND version.product_id=reservation.product_id
    AND version.version_no=reservation.product_version_no
  WHERE instruction.id=NEW.instruction_id
    AND instruction.reservation_id=NEW.reservation_id
    AND reservation.id=NEW.reservation_id
    AND reservation.product_id=NEW.product_id
    AND reservation.product_version_no=NEW.product_version_no
    AND reservation.buyer_self_pay_bps_snapshot=NEW.buyer_self_pay_bps
    AND reservation.reference_order_amount_jpy_snapshot=
      NEW.reference_order_amount_jpy
    AND reservation.estimated_self_pay_jpy_snapshot=NEW.estimated_self_pay_jpy
    AND reservation.estimated_refundable_principal_jpy_snapshot=
      NEW.estimated_refundable_principal_jpy
    AND NEW.version_no=instruction.current_version_no+1
    AND (
      (instruction.current_version_no=0
        AND NEW.initial_deadline_at=NEW.published_at+21600000)
      OR
      (instruction.current_version_no>=1
        AND NEW.initial_deadline_at=instruction.initial_deadline_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_version_source_mismatch');
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

CREATE TRIGGER trg_order_instruction_versions_no_update
BEFORE UPDATE ON order_instruction_versions
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_versions_are_immutable');
END;
CREATE TRIGGER trg_order_instruction_versions_no_delete
BEFORE DELETE ON order_instruction_versions
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_versions_are_immutable');
END;

-- ---------------------------------------------------------------------------
-- Two-stage generated assets. No keyword plaintext is persisted.
-- ---------------------------------------------------------------------------
CREATE TABLE order_instruction_asset_batches (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  instruction_id TEXT NOT NULL REFERENCES order_instructions(id),
  reservation_id TEXT NOT NULL REFERENCES product_reservations(id),
  product_version_id TEXT NOT NULL REFERENCES product_versions(id),
  status TEXT NOT NULL CHECK (status IN (
    'PREPARING','READY','FAILED','CONSUMED','CANCELLED'
  )),
  idempotency_digest TEXT NOT NULL CHECK (
    length(idempotency_digest)=64
    AND idempotency_digest NOT GLOB '*[^0-9a-f]*'
  ),
  render_profile TEXT NOT NULL CHECK (length(render_profile) BETWEEN 1 AND 100),
  item_count INTEGER NOT NULL CHECK (item_count >= 1),
  ready_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  generator_version TEXT CHECK (
    generator_version IS NULL OR length(generator_version) BETWEEN 1 AND 100
  ),
  failure_code TEXT CHECK (
    failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  ready_at INTEGER,
  consumed_at INTEGER,
  cancelled_at INTEGER,
  CHECK (ready_count + failed_count <= item_count),
  CHECK (
    (status='PREPARING' AND ready_at IS NULL
      AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (status='READY' AND ready_at IS NOT NULL
      AND ready_count=item_count AND failed_count=0
      AND generator_version IS NOT NULL
      AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (status='FAILED' AND failure_code IS NOT NULL)
    OR (status='CONSUMED' AND ready_at IS NOT NULL AND consumed_at IS NOT NULL)
    OR (status='CANCELLED' AND cancelled_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_order_instruction_asset_batches_instruction
ON order_instruction_asset_batches (instruction_id, status, created_at, id);
CREATE UNIQUE INDEX uq_order_instruction_asset_batches_active_digest
ON order_instruction_asset_batches (instruction_id, idempotency_digest)
WHERE status IN ('PREPARING','READY');
CREATE INDEX idx_order_instruction_asset_batches_cleanup
ON order_instruction_asset_batches (status, updated_at, id);

CREATE TABLE order_instruction_asset_items (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  asset_batch_id TEXT NOT NULL REFERENCES order_instruction_asset_batches(id),
  keyword_position INTEGER NOT NULL CHECK (keyword_position >= 1),
  keyword_hmac_digest TEXT NOT NULL CHECK (
    length(keyword_hmac_digest)=64
    AND keyword_hmac_digest NOT GLOB '*[^0-9a-f]*'
  ),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  image_mime TEXT NOT NULL CHECK (image_mime='image/png'),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  sha256 TEXT NOT NULL CHECK (
    length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  generator_version TEXT NOT NULL CHECK (length(generator_version) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN (
    'PREPARING','READY','FAILED','ORPHANED','CONSUMED'
  )),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (asset_batch_id, keyword_position),
  CHECK (
    (status IN ('PREPARING','READY','CONSUMED') AND error_code IS NULL)
    OR (status IN ('FAILED','ORPHANED') AND error_code IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_order_instruction_asset_items_batch
ON order_instruction_asset_items (asset_batch_id, keyword_position, id);
CREATE INDEX idx_order_instruction_asset_items_orphan
ON order_instruction_asset_items (status, updated_at, id);

CREATE TABLE order_instruction_keyword_images (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  order_instruction_version_id TEXT NOT NULL
    REFERENCES order_instruction_versions(id),
  keyword_position INTEGER NOT NULL CHECK (keyword_position >= 1),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  keyword_hmac_digest TEXT NOT NULL CHECK (
    length(keyword_hmac_digest)=64
    AND keyword_hmac_digest NOT GLOB '*[^0-9a-f]*'
  ),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  generator_version TEXT NOT NULL CHECK (length(generator_version) BETWEEN 1 AND 100),
  image_mime TEXT NOT NULL CHECK (image_mime='image/png'),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  generated_at INTEGER NOT NULL CHECK (generated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= generated_at),
  UNIQUE (order_instruction_version_id, keyword_position)
) STRICT;

CREATE INDEX idx_order_instruction_keyword_images_version
ON order_instruction_keyword_images (
  order_instruction_version_id, keyword_position, id
);

CREATE TRIGGER trg_order_instruction_keyword_image_guard
BEFORE INSERT ON order_instruction_keyword_images
WHEN NOT EXISTS (
  SELECT 1 FROM file_objects object
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id
    AND link.file_object_id=object.id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED'
    AND object.purpose='ORDER_INSTRUCTION_KEYWORD_IMAGE'
    AND object.detected_mime='image/png'
    AND object.uploaded_sha256=NEW.content_hash
    AND link.entity_type='ORDER_INSTRUCTION_VERSION'
    AND link.entity_id=NEW.order_instruction_version_id
    AND link.purpose='ORDER_INSTRUCTION_KEYWORD_IMAGE'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_keyword_image_mismatch');
END;

CREATE TRIGGER trg_order_instruction_keyword_images_no_update
BEFORE UPDATE ON order_instruction_keyword_images
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_keyword_images_are_immutable');
END;
CREATE TRIGGER trg_order_instruction_keyword_images_no_delete
BEFORE DELETE ON order_instruction_keyword_images
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_keyword_images_are_immutable');
END;

CREATE TABLE order_instruction_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  instruction_id TEXT NOT NULL REFERENCES order_instructions(id),
  reservation_id TEXT NOT NULL REFERENCES product_reservations(id),
  instruction_version_id TEXT REFERENCES order_instruction_versions(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'INSTRUCTION_CREATED',
    'ASSET_PREPARATION_STARTED',
    'ASSET_PREPARATION_READY',
    'ASSET_PREPARATION_FAILED',
    'INSTRUCTION_PUBLISHED',
    'INSTRUCTION_REPUBLISHED',
    'EVIDENCE_CHANGES_REQUESTED',
    'EVIDENCE_RESUBMITTED',
    'INSTRUCTION_EXPIRED',
    'INSTRUCTION_CANCELLED',
    'INSTRUCTION_COMPLETED',
    'INSTRUCTION_RECONCILED'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'STAFF','BUYER_CUSTOMER','SYSTEM'
  )),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT CHECK (
    previous_status IS NULL OR previous_status IN (
      'UNPUBLISHED','ACTIVE','EXPIRED','CANCELLED','COMPLETED'
    )
  ),
  next_status TEXT NOT NULL CHECK (next_status IN (
    'UNPUBLISHED','ACTIVE','EXPIRED','CANCELLED','COMPLETED'
  )),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  metadata_json TEXT NOT NULL CHECK (
    json_valid(metadata_json) AND json_type(metadata_json)='object'
  ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_order_instruction_events_instruction
ON order_instruction_events (instruction_id, created_at, id);
CREATE INDEX idx_order_instruction_events_reservation
ON order_instruction_events (reservation_id, created_at, id);
CREATE TRIGGER trg_order_instruction_events_no_update
BEFORE UPDATE ON order_instruction_events
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_events_are_immutable');
END;
CREATE TRIGGER trg_order_instruction_events_no_delete
BEFORE DELETE ON order_instruction_events
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_events_are_immutable');
END;

CREATE TABLE order_instruction_expiry_scan_cursors (
  marketplace_code TEXT PRIMARY KEY REFERENCES marketplaces(code),
  deadline_at INTEGER CHECK (deadline_at IS NULL OR deadline_at >= 0),
  instruction_id TEXT CHECK (
    instruction_id IS NULL OR length(instruction_id) BETWEEN 1 AND 120
  ),
  scanned_at INTEGER NOT NULL CHECK (scanned_at >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (deadline_at IS NULL AND instruction_id IS NULL)
    OR (deadline_at IS NOT NULL AND instruction_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE order_instruction_reconciliation_markers (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  reservation_id TEXT NOT NULL UNIQUE REFERENCES product_reservations(id),
  instruction_id TEXT REFERENCES order_instructions(id),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'FORMAL_ORDER_EXISTS_SKIPPED',
    'HISTORICAL_EVIDENCE_CONTEXT',
    'UNPUBLISHED_CREATED',
    'INSUFFICIENT_PUBLISH_WINDOW'
  )),
  metadata_json TEXT NOT NULL CHECK (
    json_valid(metadata_json) AND json_type(metadata_json)='object'
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;
CREATE INDEX idx_order_instruction_reconciliation_markers_disposition
ON order_instruction_reconciliation_markers (disposition, created_at, id);

-- Only evidence that already existed before this migration receives the
-- automatic historical compatibility marker. A narrowly controlled
-- reconciliation path may mark an APPROVED pre-schema-21 reservation before
-- importing its historical evidence. New ordinary API writes cannot create
-- either form of marker and therefore cannot bypass the guards below.
INSERT OR IGNORE INTO order_instruction_reconciliation_markers (
  id, reservation_id, instruction_id, disposition, metadata_json, created_at
)
SELECT
  'historical-evidence:' || evidence.reservation_id,
  evidence.reservation_id,
  NULL,
  'HISTORICAL_EVIDENCE_CONTEXT',
  json_object('schema_version', 20, 'evidence_version_id', MIN(evidence.id)),
  MIN(evidence.created_at)
FROM order_evidence_versions evidence
WHERE evidence.order_instruction_id IS NULL
  AND evidence.order_instruction_version_id IS NULL
  AND evidence.instruction_deadline_snapshot IS NULL
  AND evidence.reference_order_amount_jpy_snapshot IS NULL
  AND evidence.buyer_self_pay_bps_snapshot IS NULL
  AND evidence.buyer_self_pay_jpy IS NULL
  AND evidence.buyer_refundable_principal_jpy IS NULL
  AND evidence.price_mismatch IS NULL
  AND evidence.price_difference_jpy IS NULL
  AND evidence.submitted_before_deadline IS NULL
  AND evidence.evidence_file_object_id IS NULL
GROUP BY evidence.reservation_id;

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
      AND evidence.evidence_file_object_id IS NULL
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
CREATE TRIGGER trg_order_instruction_reconciliation_markers_no_update
BEFORE UPDATE ON order_instruction_reconciliation_markers
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_reconciliation_markers_are_immutable');
END;
CREATE TRIGGER trg_order_instruction_reconciliation_markers_no_delete
BEFORE DELETE ON order_instruction_reconciliation_markers
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_reconciliation_markers_are_immutable');
END;

-- ---------------------------------------------------------------------------
-- Strict evidence file semantics and internal communication attachments.
-- ---------------------------------------------------------------------------
CREATE TABLE order_evidence_internal_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  order_evidence_submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  slot INTEGER NOT NULL CHECK (slot=1),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (order_evidence_submission_id, slot)
) STRICT;

CREATE INDEX idx_order_evidence_internal_files_submission
ON order_evidence_internal_files (
  order_evidence_submission_id, slot, created_at, id
);
CREATE TRIGGER trg_order_evidence_internal_files_no_update
BEFORE UPDATE ON order_evidence_internal_files
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_internal_files_are_immutable');
END;
CREATE TRIGGER trg_order_evidence_internal_files_no_delete
BEFORE DELETE ON order_evidence_internal_files
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_internal_files_are_immutable');
END;

-- New evidence versions must bind the current Instruction version and frozen
-- financial facts. Historical rows (created before schema 21) remain NULL.
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
      AND NEW.evidence_file_object_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM file_objects object
        JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
        WHERE object.id=NEW.evidence_file_object_id
          AND object.status='VERIFIED' AND intent.status='VERIFIED'
          AND object.purpose='ORDER_EVIDENCE'
          AND intent.purpose='ORDER_EVIDENCE'
          AND object.detected_mime IN ('image/jpeg','image/png','image/webp')
          AND intent.owner_actor_type='BUYER_CUSTOMER'
          AND intent.owner_actor_id=NEW.buyer_customer_id
      )
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
    AND NEW.evidence_file_object_id IS NULL
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

CREATE TRIGGER trg_order_evidence_single_image_guard
BEFORE INSERT ON order_evidence_version_files
WHEN NOT EXISTS (
  SELECT 1 FROM order_evidence_versions evidence
  WHERE evidence.id=NEW.version_id
    AND evidence.evidence_file_object_id=NEW.file_object_id
)
OR (
  SELECT COUNT(*) FROM order_evidence_version_files existing
  WHERE existing.version_id=NEW.version_id
) >= 1
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_exactly_one_image_required');
END;

-- ---------------------------------------------------------------------------
-- Formal order number database claim and immutable financial facts.
-- ---------------------------------------------------------------------------
CREATE TABLE formal_order_number_conflicts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplaces(code),
  amazon_order_number_normalized TEXT NOT NULL CHECK (
    length(amazon_order_number_normalized)=19
  ),
  formal_order_ids_json TEXT NOT NULL CHECK (
    json_valid(formal_order_ids_json)
    AND json_type(formal_order_ids_json)='array'
    AND json_array_length(formal_order_ids_json)>=2
  ),
  detected_at INTEGER NOT NULL CHECK (detected_at >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution_note TEXT CHECK (
    resolution_note IS NULL OR length(resolution_note) BETWEEN 1 AND 4000
  ),
  UNIQUE (marketplace_code, amazon_order_number_normalized),
  CHECK (
    (status='OPEN' AND resolution_note IS NULL)
    OR (status='RESOLVED' AND resolution_note IS NOT NULL)
  )
) STRICT;

INSERT INTO formal_order_number_conflicts (
  id, marketplace_code, amazon_order_number_normalized,
  formal_order_ids_json, detected_at, status, resolution_note
)
SELECT
  'formal-order-conflict:' || marketplace_code || ':' ||
    replace(amazon_order_number_normalized, '-', ''),
  marketplace_code,
  amazon_order_number_normalized,
  (
    SELECT json_group_array(ordered.id)
    FROM (
      SELECT nested.id
      FROM formal_orders nested
      WHERE nested.marketplace_code=grouped.marketplace_code
        AND nested.amazon_order_number_normalized=
          grouped.amazon_order_number_normalized
      ORDER BY nested.confirmed_at, nested.id
    ) ordered
  ),
  MAX(confirmed_at),
  'OPEN',
  NULL
FROM formal_orders grouped
GROUP BY marketplace_code, amazon_order_number_normalized
HAVING COUNT(*)>1;

CREATE TABLE formal_order_number_claims (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplaces(code),
  amazon_order_number_normalized TEXT NOT NULL CHECK (
    length(amazon_order_number_normalized)=19
  ),
  evidence_submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  current_evidence_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  formal_order_id TEXT UNIQUE
    REFERENCES formal_orders(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL CHECK (status IN ('PROVISIONAL','FINAL','RELEASED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  claimed_at INTEGER NOT NULL CHECK (claimed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= claimed_at),
  finalized_at INTEGER CHECK (finalized_at IS NULL OR finalized_at >= claimed_at),
  released_at INTEGER CHECK (released_at IS NULL OR released_at >= claimed_at),
  CHECK (
    (status='PROVISIONAL' AND formal_order_id IS NULL
      AND finalized_at IS NULL AND released_at IS NULL)
    OR (status='FINAL' AND formal_order_id IS NOT NULL
      AND finalized_at IS NOT NULL AND released_at IS NULL)
    OR (status='RELEASED' AND formal_order_id IS NULL
      AND finalized_at IS NULL AND released_at IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX uq_formal_order_number_claims_active
ON formal_order_number_claims (
  marketplace_code, amazon_order_number_normalized
)
WHERE status IN ('PROVISIONAL','FINAL');
CREATE UNIQUE INDEX uq_formal_order_number_claims_submission_active
ON formal_order_number_claims (evidence_submission_id)
WHERE status IN ('PROVISIONAL','FINAL');
CREATE INDEX idx_formal_order_number_claims_status
ON formal_order_number_claims (status, updated_at, id);

INSERT INTO formal_order_number_claims (
  id, marketplace_code, amazon_order_number_normalized,
  evidence_submission_id, current_evidence_version_id,
  formal_order_id, status, version, claimed_at, updated_at,
  finalized_at, released_at
)
SELECT
  'formal-order-claim:' || formal_order.id,
  marketplace_code,
  amazon_order_number_normalized,
  order_evidence_submission_id,
  order_evidence_version_id,
  id,
  'FINAL',
  1,
  confirmed_at,
  confirmed_at,
  confirmed_at,
  NULL
FROM formal_orders formal_order
WHERE NOT EXISTS (
  SELECT 1 FROM formal_order_number_conflicts conflict
  WHERE conflict.marketplace_code=formal_order.marketplace_code
    AND conflict.amazon_order_number_normalized=
      formal_order.amazon_order_number_normalized
    AND conflict.status='OPEN'
);

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
CREATE TRIGGER trg_formal_order_number_claims_no_delete
BEFORE DELETE ON formal_order_number_claims
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claims_are_immutable');
END;
CREATE TRIGGER trg_formal_order_number_conflicts_no_delete
BEFORE DELETE ON formal_order_number_conflicts
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_conflicts_are_immutable');
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

-- ---------------------------------------------------------------------------
-- Final state and migration assertions.
-- ---------------------------------------------------------------------------
UPDATE app_schema_state
SET schema_version=21,
    installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=20;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM app_schema_state
    WHERE singleton_id=1 AND schema_version=21
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='order_instructions'
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='order_instruction_versions'
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='formal_order_number_claims'
  )
  AND NOT EXISTS (
    SELECT 1 FROM formal_order_number_claims claim
    JOIN formal_order_number_conflicts conflict
      ON conflict.marketplace_code=claim.marketplace_code
      AND conflict.amazon_order_number_normalized=
        claim.amazon_order_number_normalized
    WHERE conflict.status='OPEN'
  )
THEN 1 ELSE 0 END;
