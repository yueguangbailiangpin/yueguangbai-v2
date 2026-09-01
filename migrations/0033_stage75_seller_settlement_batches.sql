-- Stage 7.5 (batch 3): immutable seller settlement batches.
-- Append-only model on top of the existing payables/payments/reconciliation
-- facts: drafts select eligible payables; confirmation freezes membership,
-- integer amounts and key order snapshot references; cancellation releases
-- members. A payable can never sit in two active batches (partial unique
-- index). Payments keep flowing through the existing ledger — batch status
-- beyond DRAFT/CONFIRMED/CANCELLED is DERIVED at read time.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=32 THEN 1 ELSE 0 END;

CREATE TABLE seller_settlement_batches (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 200),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
  frozen_total_cny_fen INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(frozen_total_cny_fen)='integer' AND frozen_total_cny_fen>=0
  ),
  frozen_payable_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(frozen_payable_count)='integer' AND frozen_payable_count>=0
  ),
  frozen_at INTEGER CHECK (frozen_at IS NULL OR (status='CONFIRMED' AND frozen_at>=0)),
  cancelled_at INTEGER CHECK (cancelled_at IS NULL OR (status='CANCELLED' AND cancelled_at>=0)),
  cancel_reason TEXT CHECK (
    cancel_reason IS NULL
    OR (status='CANCELLED' AND length(cancel_reason) BETWEEN 1 AND 2000)
  ),
  version INTEGER NOT NULL CHECK (version>=1),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at)
) STRICT;

CREATE INDEX idx_seller_settlement_batches_org_status
ON seller_settlement_batches (seller_organization_id, status, created_at DESC, id DESC);

CREATE TABLE seller_settlement_batch_members (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 200),
  batch_id TEXT NOT NULL REFERENCES seller_settlement_batches(id),
  payable_id TEXT NOT NULL REFERENCES seller_payables(id),
  -- Redundant on purpose: guards reject cross-organization mixing outright.
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  amazon_order_number_normalized TEXT NOT NULL
    CHECK (length(amazon_order_number_normalized) BETWEEN 1 AND 100),
  payable_type TEXT NOT NULL CHECK (
    payable_type IN ('SELLER_PRINCIPAL','SELLER_SERVICE_FEE')
  ),
  financial_snapshot_id TEXT NOT NULL
    REFERENCES formal_order_financial_snapshots(id),
  frozen_amount_cny_fen INTEGER NOT NULL CHECK (
    typeof(frozen_amount_cny_fen)='integer' AND frozen_amount_cny_fen>0
  ),
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  added_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  added_at INTEGER NOT NULL CHECK (added_at>=0),
  removed_at INTEGER CHECK (removed_at IS NULL OR removed_at>=0),
  removal_reason TEXT CHECK (
    removal_reason IS NULL OR length(removal_reason) BETWEEN 1 AND 2000
  ),
  UNIQUE (payable_id, batch_id),
  -- DRAFT batches only hold ACTIVE members; removal flips the flag.
  CHECK (
    (active=1 AND removed_at IS NULL AND removal_reason IS NULL)
    OR (active=0 AND removed_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_seller_settlement_batch_members_batch
ON seller_settlement_batch_members (batch_id, active, payable_type, id);

-- One payable can never sit in two active batches simultaneously.
CREATE UNIQUE INDEX uq_active_batch_payable
ON seller_settlement_batch_members (payable_id) WHERE active=1;

CREATE TABLE seller_settlement_batch_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 200),
  batch_id TEXT NOT NULL REFERENCES seller_settlement_batches(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'BATCH_CREATED','MEMBER_ADDED','MEMBER_REMOVED',
    'BATCH_CONFIRMED','BATCH_CANCELLED','BATCH_EXPORTED'
  )),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

CREATE INDEX idx_seller_settlement_batch_events_batch
ON seller_settlement_batch_events (batch_id, created_at, id);

-- Members may only join/leave while the batch is a DRAFT.
CREATE TRIGGER trg_settlement_member_draft_only
BEFORE INSERT ON seller_settlement_batch_members
WHEN NOT EXISTS (
  SELECT 1 FROM seller_settlement_batches batch
  WHERE batch.id=NEW.batch_id AND batch.status='DRAFT'
)
BEGIN
  SELECT RAISE (ABORT, 'settlement_member_draft_only');
END;

CREATE TRIGGER trg_settlement_member_removal_draft_only
BEFORE UPDATE ON seller_settlement_batch_members
WHEN NEW.active=0 AND NOT (
  EXISTS (
    SELECT 1 FROM seller_settlement_batches batch
    WHERE batch.id=NEW.batch_id AND batch.status='DRAFT'
  )
  OR (
    -- Cancellation releases members with the canonical release marker only.
    NEW.removal_reason='BATCH_CANCELLED'
    AND EXISTS (
      SELECT 1 FROM seller_settlement_batches batch
      WHERE batch.id=NEW.batch_id
        AND batch.status='CANCELLED'
        AND batch.cancelled_at=NEW.removed_at
    )
  )
)
BEGIN
  SELECT RAISE (ABORT, 'settlement_member_removal_draft_only');
END;

-- Member organization must match the batch organization, and the payable
-- must be outstanding at join time (double guard behind the unique index).
CREATE TRIGGER trg_settlement_member_org_guard
BEFORE INSERT ON seller_settlement_batch_members
WHEN NOT EXISTS (
  SELECT 1
  FROM seller_settlement_batches batch
  JOIN seller_payables payable ON payable.id=NEW.payable_id
  WHERE batch.id=NEW.batch_id
    AND batch.seller_organization_id=NEW.seller_organization_id
    AND payable.seller_organization_id=batch.seller_organization_id
    AND payable.formal_order_id=NEW.formal_order_id
    AND payable.payable_type=NEW.payable_type
    AND payable.financial_snapshot_id=NEW.financial_snapshot_id
    AND NEW.frozen_amount_cny_fen=payable.amount_cny_fen
    AND NOT EXISTS (
      SELECT 1 FROM seller_payment_allocations allocation
      WHERE allocation.payable_id=payable.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM seller_settlement_batch_members existing
      WHERE existing.payable_id=NEW.payable_id AND existing.active=1
    )
)
BEGIN
  SELECT RAISE (ABORT, 'settlement_member_ineligible');
END;

-- Frozen columns never change; membership churn only flips active/removed_*.
CREATE TRIGGER trg_settlement_member_frozen_columns
BEFORE UPDATE ON seller_settlement_batch_members
WHEN
  NEW.id IS NOT OLD.id
  OR NEW.batch_id IS NOT OLD.batch_id
  OR NEW.payable_id IS NOT OLD.payable_id
  OR NEW.seller_organization_id IS NOT OLD.seller_organization_id
  OR NEW.formal_order_id IS NOT OLD.formal_order_id
  OR NEW.amazon_order_number_normalized
    IS NOT OLD.amazon_order_number_normalized
  OR NEW.payable_type IS NOT OLD.payable_type
  OR NEW.financial_snapshot_id IS NOT OLD.financial_snapshot_id
  OR NEW.frozen_amount_cny_fen IS NOT OLD.frozen_amount_cny_fen
  OR NEW.added_by_staff_id IS NOT OLD.added_by_staff_id
  OR NEW.added_at IS NOT OLD.added_at
  OR NOT (OLD.active=1 AND NEW.active=0)
  OR NEW.removed_at IS NULL
  OR NEW.removal_reason IS NULL
  OR length(NEW.removal_reason)>2000
BEGIN
  SELECT RAISE (ABORT, 'settlement_member_columns_frozen');
END;

-- Batches never delete; status transitions only DRAFT→CONFIRMED/CANCELLED
-- and the frozen totals only ever freeze once.
CREATE TRIGGER trg_settlement_batch_no_delete
BEFORE DELETE ON seller_settlement_batches
BEGIN
  SELECT RAISE (ABORT, 'settlement_batches_are_immutable');
END;

CREATE TRIGGER trg_settlement_batch_transition_guard
BEFORE UPDATE ON seller_settlement_batches
WHEN NOT (
  (
    OLD.status='DRAFT' AND NEW.status='DRAFT'
    AND NEW.frozen_total_cny_fen=0
    AND NEW.frozen_payable_count=0
    AND NEW.frozen_at IS NULL AND NEW.cancelled_at IS NULL
    AND NEW.cancel_reason IS NULL
  )
  OR (
    OLD.status='DRAFT' AND NEW.status='CONFIRMED'
    AND NEW.version=OLD.version+1
    AND NEW.frozen_at>=OLD.created_at
    AND NEW.cancelled_at IS NULL AND NEW.cancel_reason IS NULL
    AND NEW.frozen_payable_count>0
    AND NEW.frozen_total_cny_fen=(
      SELECT COALESCE(SUM(member.frozen_amount_cny_fen),0)
      FROM seller_settlement_batch_members member
      WHERE member.batch_id=OLD.id AND member.active=1
    )
    AND NEW.frozen_payable_count=(
      SELECT COUNT(*) FROM seller_settlement_batch_members member
      WHERE member.batch_id=OLD.id AND member.active=1
    )
  )
  OR (
    OLD.status IN ('DRAFT','CONFIRMED') AND NEW.status='CANCELLED'
    AND NEW.version=OLD.version+1
    AND NEW.frozen_total_cny_fen=OLD.frozen_total_cny_fen
    AND NEW.frozen_payable_count=OLD.frozen_payable_count
    AND NEW.frozen_at IS OLD.frozen_at
    AND NEW.cancelled_at>=OLD.created_at
    AND NEW.cancel_reason IS NOT NULL
    AND length(NEW.cancel_reason) BETWEEN 1 AND 2000
  )
)
BEGIN
  SELECT RAISE (ABORT, 'settlement_batch_invalid_transition');
END;

-- Cancelling releases every active member (payables re-eligible elsewhere).
CREATE TRIGGER trg_settlement_batch_cancel_release
AFTER UPDATE ON seller_settlement_batches
WHEN OLD.status<>'CANCELLED' AND NEW.status='CANCELLED'
BEGIN
  UPDATE seller_settlement_batch_members
  SET active=0, removed_at=NEW.cancelled_at,
    removal_reason='BATCH_CANCELLED'
  WHERE batch_id=NEW.id AND active=1;
END;

UPDATE app_schema_state
SET
  schema_version=33,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=32;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=33 THEN 1 ELSE 0 END;
