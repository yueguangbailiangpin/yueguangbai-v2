-- Baseline 0013 seller_settlements (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=12 THEN 1 ELSE 0 END;

CREATE TABLE seller_payables (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  payable_type TEXT NOT NULL CHECK (
    payable_type IN ('SELLER_PRINCIPAL','SELLER_SERVICE_FEE')
  ),
  amount_cny_fen INTEGER NOT NULL CHECK (
    typeof(amount_cny_fen)='integer'
    AND amount_cny_fen BETWEEN 0 AND 9007199254740991
  ),
  financial_snapshot_id TEXT NOT NULL
    REFERENCES formal_order_financial_snapshots(id),
  source_type TEXT NOT NULL CHECK (
    source_type IN ('FORMAL_ORDER','REVIEW_APPROVAL')
  ),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  due_at INTEGER NOT NULL CHECK (typeof(due_at)='integer' AND due_at>=0),
  created_at INTEGER NOT NULL CHECK (
    typeof(created_at)='integer' AND created_at>=0
  ),
  UNIQUE (formal_order_id, payable_type),
  UNIQUE (source_type, source_id, payable_type)
) STRICT;

CREATE TABLE seller_payable_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  payable_id TEXT NOT NULL REFERENCES seller_payables(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('PAYABLE_CREATED','PAYABLE_RECONCILED')
  ),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','SYSTEM')),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  amount_cny_fen INTEGER NOT NULL CHECK (
    typeof(amount_cny_fen)='integer'
    AND amount_cny_fen BETWEEN 0 AND 9007199254740991
  ),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  UNIQUE (payable_id, event_type)
) STRICT;

CREATE TABLE seller_payable_reconciliation_conflicts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 240),
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('FORMAL_ORDER','REVIEW_CASE')
  ),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'FINANCIAL_SNAPSHOT_MISSING',
    'FINANCIAL_SNAPSHOT_MULTIPLE',
    'REVIEW_APPROVAL_SOURCE_CONFLICT',
    'SELLER_ORGANIZATION_MISMATCH',
    'SOURCE_RELATION_CONFLICT'
  )),
  detected_at INTEGER NOT NULL CHECK (typeof(detected_at)='integer' AND detected_at>=0),
  UNIQUE (entity_type, entity_id, reason_code)
) STRICT;

CREATE TABLE seller_payments (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  amount_cny_fen INTEGER NOT NULL CHECK (
    typeof(amount_cny_fen)='integer'
    AND amount_cny_fen BETWEEN 1 AND 9007199254740991
  ),
  paid_at INTEGER NOT NULL CHECK (typeof(paid_at)='integer' AND paid_at>=0),
  recorded_at INTEGER NOT NULL CHECK (
    typeof(recorded_at)='integer' AND recorded_at>=0 AND paid_at<=recorded_at
  ),
  recorded_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  version INTEGER NOT NULL CHECK (typeof(version)='integer' AND version>=1),
  created_at INTEGER NOT NULL CHECK (created_at=recorded_at),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at)
) STRICT;

CREATE TABLE seller_payment_allocations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  payment_id TEXT NOT NULL REFERENCES seller_payments(id),
  payable_id TEXT NOT NULL REFERENCES seller_payables(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  amount_cny_fen INTEGER NOT NULL CHECK (
    typeof(amount_cny_fen)='integer'
    AND amount_cny_fen BETWEEN 1 AND 9007199254740991
  ),
  allocated_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  allocated_at INTEGER NOT NULL CHECK (typeof(allocated_at)='integer' AND allocated_at>=0),
  created_at INTEGER NOT NULL CHECK (created_at=allocated_at)
) STRICT;

CREATE TABLE seller_payment_allocation_reversals (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  allocation_id TEXT NOT NULL REFERENCES seller_payment_allocations(id),
  payment_id TEXT NOT NULL REFERENCES seller_payments(id),
  payable_id TEXT NOT NULL REFERENCES seller_payables(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  amount_cny_fen INTEGER NOT NULL CHECK (
    typeof(amount_cny_fen)='integer'
    AND amount_cny_fen BETWEEN 1 AND 9007199254740991
  ),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  reversed_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  reversed_at INTEGER NOT NULL CHECK (typeof(reversed_at)='integer' AND reversed_at>=0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (created_at=reversed_at),
  UNIQUE (reversed_by_staff_id, idempotency_key)
) STRICT;

CREATE TABLE seller_payment_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  payment_id TEXT NOT NULL REFERENCES seller_payments(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'PAYMENT_RECORDED','PAYMENT_PAID_AT_CORRECTED','PAYMENT_REVERSED'
  )),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  payment_version INTEGER NOT NULL CHECK (payment_version>=1),
  amount_cny_fen INTEGER NOT NULL CHECK (
    typeof(amount_cny_fen)='integer'
    AND amount_cny_fen BETWEEN 1 AND 9007199254740991
  ),
  previous_paid_at INTEGER CHECK (previous_paid_at IS NULL OR previous_paid_at>=0),
  next_paid_at INTEGER CHECK (next_paid_at IS NULL OR next_paid_at>=0),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 2000),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0),
  CHECK (
    (event_type='PAYMENT_RECORDED'
      AND payment_version=1
      AND previous_paid_at IS NULL
      AND next_paid_at IS NOT NULL
      AND reason IS NULL)
    OR
    (event_type='PAYMENT_PAID_AT_CORRECTED'
      AND payment_version>1
      AND previous_paid_at IS NOT NULL
      AND next_paid_at IS NOT NULL
      AND reason IS NOT NULL)
    OR
    (event_type='PAYMENT_REVERSED'
      AND previous_paid_at IS NULL
      AND next_paid_at IS NULL
      AND reason IS NOT NULL)
  )
) STRICT;

CREATE TABLE seller_payment_proofs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  payment_id TEXT NOT NULL UNIQUE REFERENCES seller_payments(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_at INTEGER NOT NULL CHECK (typeof(created_at)='integer' AND created_at>=0)
) STRICT;

CREATE TABLE seller_payment_reversals (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  payment_id TEXT NOT NULL UNIQUE REFERENCES seller_payments(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  amount_cny_fen INTEGER NOT NULL CHECK (
    typeof(amount_cny_fen)='integer'
    AND amount_cny_fen BETWEEN 1 AND 9007199254740991
  ),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  reversed_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  reversed_at INTEGER NOT NULL CHECK (typeof(reversed_at)='integer' AND reversed_at>=0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (created_at=reversed_at)
) STRICT;

CREATE INDEX idx_seller_allocation_reversals_allocation
ON seller_payment_allocation_reversals (allocation_id, reversed_at, id);

CREATE INDEX idx_seller_payable_events_payable
ON seller_payable_events (payable_id, created_at, id);

CREATE INDEX idx_seller_payable_reconciliation_conflicts_detected
ON seller_payable_reconciliation_conflicts (
  detected_at, entity_type, entity_id, reason_code
);

CREATE INDEX idx_seller_payables_organization_due
ON seller_payables (
  seller_organization_id, payable_type, due_at, id
);

CREATE INDEX idx_seller_payables_snapshot
ON seller_payables (financial_snapshot_id, payable_type, id);

CREATE INDEX idx_seller_payment_allocations_payable
ON seller_payment_allocations (payable_id, allocated_at, id);

CREATE INDEX idx_seller_payment_allocations_payment
ON seller_payment_allocations (payment_id, allocated_at, id);

CREATE INDEX idx_seller_payment_events_payment
ON seller_payment_events (payment_id, created_at, id);

CREATE INDEX idx_seller_payment_proofs_organization
ON seller_payment_proofs (seller_organization_id, payment_id);

CREATE INDEX idx_seller_payment_reversals_organization
ON seller_payment_reversals (seller_organization_id, reversed_at, id);

CREATE INDEX idx_seller_payments_organization_paid
ON seller_payments (seller_organization_id, paid_at, id);

CREATE UNIQUE INDEX uq_seller_payment_recorded_event
ON seller_payment_events (payment_id, event_type)
WHERE event_type='PAYMENT_RECORDED';

CREATE UNIQUE INDEX uq_seller_payment_reversed_event
ON seller_payment_events (payment_id, event_type)
WHERE event_type='PAYMENT_REVERSED';

CREATE TRIGGER trg_review_service_fee_requires_normal_order
BEFORE INSERT ON seller_payables
WHEN NEW.source_type='REVIEW_APPROVAL'
  AND COALESCE((
    SELECT state.operational_state
    FROM formal_order_effective_operational_state state
    WHERE state.formal_order_id=NEW.formal_order_id
  ),'NORMAL')<>'NORMAL'
BEGIN
  SELECT RAISE(ABORT,'seller_service_fee_blocked_by_order_operational_state');
END;

CREATE TRIGGER trg_seller_allocation_guard
BEFORE INSERT ON seller_payment_allocations
WHEN
  NOT EXISTS (
    SELECT 1
    FROM seller_payments payment
    JOIN seller_payables payable
      ON payable.id=NEW.payable_id
      AND payable.seller_organization_id=payment.seller_organization_id
    JOIN staff_users staff
      ON staff.id=NEW.allocated_by_staff_id AND staff.status='ACTIVE'
    WHERE payment.id=NEW.payment_id
      AND payment.seller_organization_id=NEW.seller_organization_id
      AND payable.seller_organization_id=NEW.seller_organization_id
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_reversals reversal
        WHERE reversal.payment_id=payment.id
      )
  )
  OR NEW.amount_cny_fen>(
    SELECT payment.amount_cny_fen-COALESCE((
      SELECT SUM(allocation.amount_cny_fen-COALESCE((
        SELECT SUM(reversal.amount_cny_fen)
        FROM seller_payment_allocation_reversals reversal
        WHERE reversal.allocation_id=allocation.id
      ),0))
      FROM seller_payment_allocations allocation
      WHERE allocation.payment_id=payment.id
    ),0)
    FROM seller_payments payment WHERE payment.id=NEW.payment_id
  )
  OR NEW.amount_cny_fen>(
    SELECT payable.amount_cny_fen-COALESCE((
      SELECT SUM(allocation.amount_cny_fen-COALESCE((
        SELECT SUM(reversal.amount_cny_fen)
        FROM seller_payment_allocation_reversals reversal
        WHERE reversal.allocation_id=allocation.id
      ),0))
      FROM seller_payment_allocations allocation
      WHERE allocation.payable_id=payable.id
    ),0)
    FROM seller_payables payable WHERE payable.id=NEW.payable_id
  )
BEGIN
  SELECT RAISE(ABORT, 'seller_allocation_exceeds_available_balance');
END;

CREATE TRIGGER trg_seller_allocation_reversal_guard
BEFORE INSERT ON seller_payment_allocation_reversals
WHEN
  NOT EXISTS (
    SELECT 1
    FROM seller_payment_allocations allocation
    JOIN staff_users staff
      ON staff.id=NEW.reversed_by_staff_id AND staff.status='ACTIVE'
    WHERE allocation.id=NEW.allocation_id
      AND allocation.payment_id=NEW.payment_id
      AND allocation.payable_id=NEW.payable_id
      AND allocation.seller_organization_id=NEW.seller_organization_id
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_reversals reversal
        WHERE reversal.payment_id=allocation.payment_id
      )
  )
  OR NEW.amount_cny_fen>(
    SELECT allocation.amount_cny_fen-COALESCE((
      SELECT SUM(existing.amount_cny_fen)
      FROM seller_payment_allocation_reversals existing
      WHERE existing.allocation_id=allocation.id
    ),0)
    FROM seller_payment_allocations allocation
    WHERE allocation.id=NEW.allocation_id
  )
BEGIN
  SELECT RAISE(ABORT, 'seller_allocation_reversal_exceeds_allocation');
END;

CREATE TRIGGER trg_seller_allocation_reversals_no_delete
BEFORE DELETE ON seller_payment_allocation_reversals
BEGIN
  SELECT RAISE(ABORT, 'seller_allocation_reversals_are_immutable');
END;

CREATE TRIGGER trg_seller_allocation_reversals_no_update
BEFORE UPDATE ON seller_payment_allocation_reversals
BEGIN
  SELECT RAISE(ABORT, 'seller_allocation_reversals_are_immutable');
END;

CREATE TRIGGER trg_seller_payable_conflicts_no_delete
BEFORE DELETE ON seller_payable_reconciliation_conflicts
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_reconciliation_conflicts_are_immutable');
END;

CREATE TRIGGER trg_seller_payable_conflicts_no_update
BEFORE UPDATE ON seller_payable_reconciliation_conflicts
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_reconciliation_conflicts_are_immutable');
END;

CREATE TRIGGER trg_seller_payable_event_guard
BEFORE INSERT ON seller_payable_events
WHEN NOT EXISTS (
  SELECT 1 FROM seller_payables payable
  WHERE payable.id=NEW.payable_id
    AND payable.amount_cny_fen=NEW.amount_cny_fen
)
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_event_source_mismatch');
END;

CREATE TRIGGER trg_seller_payable_events_no_delete
BEFORE DELETE ON seller_payable_events
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_events_are_immutable');
END;

CREATE TRIGGER trg_seller_payable_events_no_update
BEFORE UPDATE ON seller_payable_events
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_events_are_immutable');
END;

CREATE TRIGGER trg_seller_payable_source_guard
BEFORE INSERT ON seller_payables
WHEN
  (NEW.payable_type='SELLER_PRINCIPAL' AND NOT EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.id=NEW.financial_snapshot_id
      AND snapshot.formal_order_id=formal_order.id
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.seller_organization_id=NEW.seller_organization_id
      AND snapshot.seller_expected_principal_cny_fen=NEW.amount_cny_fen
      AND NEW.source_type='FORMAL_ORDER'
      AND NEW.source_id=formal_order.id
      AND NEW.due_at=formal_order.confirmed_at
  ))
  OR
  (NEW.payable_type='SELLER_SERVICE_FEE' AND NOT EXISTS (
    SELECT 1
    FROM review_cases review_case
    JOIN formal_orders formal_order
      ON formal_order.id=review_case.formal_order_id
    JOIN review_events approval
      ON approval.review_case_id=review_case.id
      AND approval.formal_order_id=formal_order.id
      AND approval.event_type='REVIEW_APPROVED'
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.id=NEW.financial_snapshot_id
      AND snapshot.formal_order_id=formal_order.id
    WHERE review_case.id=NEW.source_id
      AND review_case.status='APPROVED'
      AND review_case.seller_organization_id=NEW.seller_organization_id
      AND formal_order.id=NEW.formal_order_id
      AND formal_order.seller_organization_id=NEW.seller_organization_id
      AND snapshot.service_fee_cny_fen=NEW.amount_cny_fen
      AND NEW.source_type='REVIEW_APPROVAL'
      AND NEW.due_at=approval.created_at
  ))
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_source_mismatch');
END;

CREATE TRIGGER trg_seller_payables_no_delete
BEFORE DELETE ON seller_payables
BEGIN
  SELECT RAISE(ABORT, 'seller_payables_are_immutable');
END;

CREATE TRIGGER trg_seller_payables_no_update
BEFORE UPDATE ON seller_payables
BEGIN
  SELECT RAISE(ABORT, 'seller_payables_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_allocations_no_delete
BEFORE DELETE ON seller_payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_allocations_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_allocations_no_update
BEFORE UPDATE ON seller_payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_allocations_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_event_guard
BEFORE INSERT ON seller_payment_events
WHEN NOT EXISTS (
  SELECT 1 FROM seller_payments payment
  WHERE payment.id=NEW.payment_id
    AND payment.amount_cny_fen=NEW.amount_cny_fen
    AND payment.version=NEW.payment_version
    AND (
      (NEW.event_type='PAYMENT_RECORDED'
        AND payment.paid_at=NEW.next_paid_at)
      OR
      (NEW.event_type='PAYMENT_PAID_AT_CORRECTED'
        AND payment.paid_at=NEW.next_paid_at)
      OR
      (NEW.event_type='PAYMENT_REVERSED'
        AND EXISTS (
          SELECT 1 FROM seller_payment_reversals reversal
          WHERE reversal.payment_id=payment.id
            AND reversal.amount_cny_fen=payment.amount_cny_fen
        ))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_event_source_mismatch');
END;

CREATE TRIGGER trg_seller_payment_events_no_delete
BEFORE DELETE ON seller_payment_events
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_events_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_events_no_update
BEFORE UPDATE ON seller_payment_events
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_events_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_insert_guard
BEFORE INSERT ON seller_payments
WHEN NEW.version<>1
  OR NEW.created_at<>NEW.recorded_at
  OR NEW.updated_at<>NEW.recorded_at
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    WHERE staff.id=NEW.recorded_by_staff_id AND staff.status='ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_source_mismatch');
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

CREATE TRIGGER trg_seller_payment_proofs_no_delete
BEFORE DELETE ON seller_payment_proofs
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_proofs_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_proofs_no_update
BEFORE UPDATE ON seller_payment_proofs
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_proofs_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_reversal_guard
BEFORE INSERT ON seller_payment_reversals
WHEN
  NOT EXISTS (
    SELECT 1
    FROM seller_payments payment
    JOIN staff_users staff
      ON staff.id=NEW.reversed_by_staff_id AND staff.status='ACTIVE'
    WHERE payment.id=NEW.payment_id
      AND payment.seller_organization_id=NEW.seller_organization_id
      AND payment.amount_cny_fen=NEW.amount_cny_fen
  )
  OR EXISTS (
    SELECT 1
    FROM seller_payment_allocations allocation
    WHERE allocation.payment_id=NEW.payment_id
      AND allocation.amount_cny_fen>COALESCE((
        SELECT SUM(reversal.amount_cny_fen)
        FROM seller_payment_allocation_reversals reversal
        WHERE reversal.allocation_id=allocation.id
      ),0)
  )
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_reversal_has_active_allocations');
END;

CREATE TRIGGER trg_seller_payment_reversals_no_delete
BEFORE DELETE ON seller_payment_reversals
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_reversals_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_reversals_no_update
BEFORE UPDATE ON seller_payment_reversals
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_reversals_are_immutable');
END;

CREATE TRIGGER trg_seller_payment_update_guard
BEFORE UPDATE ON seller_payments
WHEN
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.seller_organization_id IS OLD.seller_organization_id)
  OR NOT (NEW.amount_cny_fen IS OLD.amount_cny_fen)
  OR NOT (NEW.recorded_at IS OLD.recorded_at)
  OR NOT (NEW.recorded_by_staff_id IS OLD.recorded_by_staff_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<=OLD.updated_at
  OR NEW.paid_at>NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_invalid_update');
END;

CREATE TRIGGER trg_seller_payments_no_delete
BEFORE DELETE ON seller_payments
BEGIN
  SELECT RAISE(ABORT, 'seller_payments_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=13,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
