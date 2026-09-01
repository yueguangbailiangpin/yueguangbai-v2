-- Stage 7.5R-5 (schema 36): make 'BATCH_CANCELLED' a database-reserved
-- release marker on seller settlement batch members.
--
-- The two-pass CSV export identifies the confirmation-time frozen member
-- set with `removal_reason='BATCH_CANCELLED'` (stage 7.5R-4). Until now
-- that string was only written by the cancellation release trigger
-- (trg_settlement_batch_cancel_release, 0033) — but a DRAFT-stage manual
-- removal could still write the same string and get a member wrongly
-- counted into the frozen set. This trigger closes that hole.
--
-- The reserved value may only be written by the cancellation release path,
-- whose fingerprint is checked directly against the parent batch:
--   * the batch row is already CANCELLED (the release trigger runs AFTER
--     the batch UPDATE that flips it), and
--   * the member's removed_at equals the batch's cancelled_at.
-- Any other write — a draft-stage manual removal, a reason-string
-- collision, or a tampered row — is rejected. Manual removals keep
-- working with any other reason. Members can never be touched again once
-- released (trg_settlement_member_frozen_columns, 0033), so the reserved
-- value cannot be rewritten afterwards either.

CREATE TRIGGER trg_settlement_member_cancelled_reason_reserved
BEFORE UPDATE ON seller_settlement_batch_members
WHEN NEW.removal_reason='BATCH_CANCELLED'
  AND NOT EXISTS (
    SELECT 1
    FROM seller_settlement_batches batch
    WHERE batch.id=NEW.batch_id
      AND batch.status='CANCELLED'
      AND batch.cancelled_at=NEW.removed_at
  )
BEGIN
  SELECT RAISE (ABORT, 'settlement_cancelled_reason_reserved');
END;

UPDATE app_schema_state
SET
  schema_version=36,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=35;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=36
  AND EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='trigger'
      AND name='trg_settlement_member_cancelled_reason_reserved'
      AND sql LIKE '%seller_settlement_batch_members%'
  )
THEN 1 ELSE 0 END;
