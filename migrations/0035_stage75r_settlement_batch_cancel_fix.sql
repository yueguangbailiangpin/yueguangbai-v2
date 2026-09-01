-- Stage 7.5R: allow cancelling a CONFIRMED settlement batch. The 0033 table
-- CHECK tied frozen_at to status='CONFIRMED', while the transition trigger
-- (and the batch design) require CONFIRMED→CANCELLED to KEEP the frozen
-- facts — so cancelling a confirmed batch could only ever fail with a CHECK
-- violation. Rebuild the table (0034 pattern) with the corrected CHECK and
-- restore its index and triggers verbatim. Members/events tables untouched.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=34 THEN 1 ELSE 0 END;

-- Member-table triggers reference seller_settlement_batches by name in their
-- bodies; they must come out before the rebuild (0028 pattern) and return
-- verbatim after the rename.
DROP TRIGGER IF EXISTS trg_settlement_member_draft_only;
DROP TRIGGER IF EXISTS trg_settlement_member_removal_draft_only;
DROP TRIGGER IF EXISTS trg_settlement_member_org_guard;
DROP TRIGGER IF EXISTS trg_settlement_member_frozen_columns;

CREATE TABLE "seller_settlement_batches_stage75r_new" (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 200),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
  frozen_total_cny_fen INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(frozen_total_cny_fen)='integer' AND frozen_total_cny_fen>=0
  ),
  frozen_payable_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(frozen_payable_count)='integer' AND frozen_payable_count>=0
  ),
  frozen_at INTEGER CHECK (
    frozen_at IS NULL
    OR (status IN ('CONFIRMED','CANCELLED') AND frozen_at>=0)
  ),
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

INSERT INTO seller_settlement_batches_stage75r_new (
  id, seller_organization_id, status, frozen_total_cny_fen,
  frozen_payable_count, frozen_at, cancelled_at, cancel_reason, version,
  created_by_staff_id, created_at, updated_at
)
SELECT
  id, seller_organization_id, status, frozen_total_cny_fen,
  frozen_payable_count, frozen_at, cancelled_at, cancel_reason, version,
  created_by_staff_id, created_at, updated_at
FROM seller_settlement_batches;

DROP TABLE seller_settlement_batches;
ALTER TABLE seller_settlement_batches_stage75r_new RENAME TO seller_settlement_batches;

CREATE INDEX idx_seller_settlement_batches_org_status
ON seller_settlement_batches (seller_organization_id, status, created_at DESC, id DESC);

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

CREATE TRIGGER trg_settlement_batch_cancel_release
AFTER UPDATE ON seller_settlement_batches
WHEN OLD.status<>'CANCELLED' AND NEW.status='CANCELLED'
BEGIN
  UPDATE seller_settlement_batch_members
  SET active=0, removed_at=NEW.cancelled_at,
    removal_reason='BATCH_CANCELLED'
  WHERE batch_id=NEW.id AND active=1;
END;

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

UPDATE app_schema_state
SET
  schema_version=35,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=34;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=35 THEN 1 ELSE 0 END;
