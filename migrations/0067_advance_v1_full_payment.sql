PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=66
) THEN 1 ELSE 0 END;

-- Do not silently reinterpret immutable history as the V1 full-payment model.
-- Every existing payment must already equal its formal-order snapshot.
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN NOT EXISTS(
  SELECT 1
  FROM buyer_advance_principal_entries payment
  WHERE payment.entry_type='PAYMENT'
    AND NOT EXISTS(
      SELECT 1
      FROM formal_order_financial_snapshots snapshot
      WHERE snapshot.formal_order_id=payment.formal_order_id
        AND snapshot.buyer_expected_principal_cny_fen=payment.amount_cny_fen
        AND snapshot.buyer_expected_principal_cny_fen>0
    )
) THEN 1 ELSE 0 END;

-- V1 permits either no reversal or exactly one full reversal.
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN NOT EXISTS(
  SELECT 1
  FROM buyer_advance_principal_entries payment
  WHERE payment.entry_type='PAYMENT'
    AND (
      (SELECT COUNT(*) FROM buyer_advance_principal_entries reversal
       WHERE reversal.entry_type='REVERSAL'
         AND reversal.original_payment_entry_id=payment.id)>1
      OR COALESCE((
        SELECT SUM(reversal.amount_cny_fen)
        FROM buyer_advance_principal_entries reversal
        WHERE reversal.entry_type='REVERSAL'
          AND reversal.original_payment_entry_id=payment.id
      ),0) NOT IN (0,payment.amount_cny_fen)
    )
) THEN 1 ELSE 0 END;

-- At most one payment per order may still have a positive balance.
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN NOT EXISTS(
  SELECT payment.formal_order_id
  FROM buyer_advance_principal_entries payment
  WHERE payment.entry_type='PAYMENT'
    AND payment.amount_cny_fen>COALESCE((
      SELECT SUM(reversal.amount_cny_fen)
      FROM buyer_advance_principal_entries reversal
      WHERE reversal.entry_type='REVERSAL'
        AND reversal.original_payment_entry_id=payment.id
    ),0)
  GROUP BY payment.formal_order_id
  HAVING COUNT(*)>1
) THEN 1 ELSE 0 END;

CREATE TRIGGER trg_advance_principal_full_payment_amount_guard
BEFORE INSERT ON buyer_advance_principal_entries
WHEN NEW.entry_type='PAYMENT' AND NOT EXISTS(
  SELECT 1
  FROM formal_order_financial_snapshots snapshot
  WHERE snapshot.formal_order_id=NEW.formal_order_id
    AND snapshot.buyer_expected_principal_cny_fen=NEW.amount_cny_fen
    AND snapshot.buyer_expected_principal_cny_fen>0
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_payment_must_equal_snapshot');
END;

CREATE TRIGGER trg_advance_principal_single_outstanding_payment_guard
BEFORE INSERT ON buyer_advance_principal_entries
WHEN NEW.entry_type='PAYMENT' AND EXISTS(
  SELECT 1
  FROM buyer_advance_principal_entries payment
  WHERE payment.entry_type='PAYMENT'
    AND payment.formal_order_id=NEW.formal_order_id
    AND payment.amount_cny_fen>COALESCE((
      SELECT SUM(reversal.amount_cny_fen)
      FROM buyer_advance_principal_entries reversal
      WHERE reversal.entry_type='REVERSAL'
        AND reversal.original_payment_entry_id=payment.id
    ),0)
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_outstanding_payment_exists');
END;

CREATE TRIGGER trg_advance_principal_full_reversal_guard
BEFORE INSERT ON buyer_advance_principal_entries
WHEN NEW.entry_type='REVERSAL' AND NOT EXISTS(
  SELECT 1
  FROM buyer_advance_principal_entries payment
  WHERE payment.id=NEW.original_payment_entry_id
    AND payment.entry_type='PAYMENT'
    AND NEW.amount_cny_fen=payment.amount_cny_fen
    AND NEW.payment_channel=payment.payment_channel
    AND NOT EXISTS(
      SELECT 1
      FROM buyer_advance_principal_entries prior_reversal
      WHERE prior_reversal.entry_type='REVERSAL'
        AND prior_reversal.original_payment_entry_id=payment.id
    )
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_reversal_must_be_one_full_entry');
END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_advance_principal_reversal_source_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_advance_principal_reversal_total_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_advance_principal_full_payment_amount_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_advance_principal_single_outstanding_payment_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
    AND name='trg_advance_principal_full_reversal_guard')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=67,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=66;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
