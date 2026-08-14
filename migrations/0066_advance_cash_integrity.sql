PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=65
) THEN 1 ELSE 0 END;

-- Refuse to bless an already-corrupt immutable ledger. Any historical excess
-- must be investigated and compensated explicitly before this migration runs.
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN NOT EXISTS(
  SELECT 1
  FROM buyer_advance_principal_entries payment
  WHERE payment.entry_type='PAYMENT'
    AND COALESCE((
      SELECT SUM(reversal.amount_cny_fen)
      FROM buyer_advance_principal_entries reversal
      WHERE reversal.entry_type='REVERSAL'
        AND reversal.original_payment_entry_id=payment.id
    ),0)>payment.amount_cny_fen
) THEN 1 ELSE 0 END;

-- D1/SQLite serializes writes. Keeping the aggregate assertion in a BEFORE
-- INSERT trigger closes the stale read -> check -> insert race at commit time.
CREATE TRIGGER trg_advance_principal_reversal_total_guard
BEFORE INSERT ON buyer_advance_principal_entries
WHEN NEW.entry_type='REVERSAL' AND EXISTS(
  SELECT 1
  FROM buyer_advance_principal_entries payment
  WHERE payment.id=NEW.original_payment_entry_id
    AND payment.entry_type='PAYMENT'
    AND NEW.amount_cny_fen>payment.amount_cny_fen-COALESCE((
      SELECT SUM(reversal.amount_cny_fen)
      FROM buyer_advance_principal_entries reversal
      WHERE reversal.entry_type='REVERSAL'
        AND reversal.original_payment_entry_id=payment.id
    ),0)
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_reversal_exceeds_payment');
END;

-- Company cash flow follows real money movement time. The refund-ledger entry
-- produced when an advance is settled is an accounting mirror, not a second
-- payment, so both it and any reversal referencing it are excluded here.
DROP VIEW internal_finance_cash_movements;
CREATE VIEW internal_finance_cash_movements AS
SELECT
  payment.id AS movement_id,
  'SELLER_PAYMENT' AS movement_type,
  payment.seller_organization_id,
  NULL AS formal_order_id,
  payment.paid_at AS occurred_at,
  date(payment.paid_at / 1000, 'unixepoch', '+8 hours') AS cash_business_date,
  payment.amount_cny_fen AS amount_cny_fen
FROM seller_payments payment
UNION ALL
SELECT
  reversal.id,
  'SELLER_PAYMENT_REVERSAL',
  reversal.seller_organization_id,
  NULL,
  reversal.reversed_at,
  date(reversal.reversed_at / 1000, 'unixepoch', '+8 hours'),
  reversal.amount_cny_fen
FROM seller_payment_reversals reversal
UNION ALL
SELECT
  entry.id,
  CASE WHEN entry.entry_type='PAYMENT'
    THEN 'BUYER_REFUND_PAYMENT' ELSE 'BUYER_REFUND_REVERSAL' END,
  formal_order.seller_organization_id,
  obligation.formal_order_id,
  CASE WHEN entry.entry_type='PAYMENT' THEN entry.paid_at ELSE entry.reversed_at END,
  entry.china_business_date,
  entry.amount_cny_fen
FROM buyer_refund_payment_entries entry
JOIN buyer_refund_obligations obligation ON obligation.id=entry.obligation_id
JOIN formal_orders formal_order ON formal_order.id=obligation.formal_order_id
WHERE NOT EXISTS(
  SELECT 1
  FROM buyer_advance_principal_settlements settlement
  WHERE settlement.buyer_refund_payment_entry_id=CASE
    WHEN entry.entry_type='PAYMENT' THEN entry.id
    ELSE entry.original_payment_entry_id
  END
)
UNION ALL
SELECT
  entry.id,
  CASE WHEN entry.entry_type='PAYMENT'
    THEN 'BUYER_ADVANCE_PAYMENT' ELSE 'BUYER_ADVANCE_REVERSAL' END,
  formal_order.seller_organization_id,
  entry.formal_order_id,
  CASE WHEN entry.entry_type='PAYMENT' THEN entry.paid_at ELSE entry.reversed_at END,
  entry.china_business_date,
  entry.amount_cny_fen
FROM buyer_advance_principal_entries entry
JOIN formal_orders formal_order ON formal_order.id=entry.formal_order_id;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema
    WHERE type='trigger' AND name='trg_advance_principal_reversal_total_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema
    WHERE type='view' AND name='internal_finance_cash_movements')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=66,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=65;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
