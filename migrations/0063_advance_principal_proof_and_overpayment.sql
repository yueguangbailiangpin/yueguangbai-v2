PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=62
) THEN 1 ELSE 0 END;

CREATE TABLE buyer_advance_principal_entry_files (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 16 AND 120),
  advance_payment_entry_id TEXT NOT NULL REFERENCES buyer_advance_principal_entries(id),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  UNIQUE(advance_payment_entry_id,file_object_id)
) STRICT;
CREATE INDEX idx_buyer_advance_principal_entry_files_payment
ON buyer_advance_principal_entry_files(advance_payment_entry_id,created_at,id);
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
CREATE TRIGGER trg_buyer_advance_principal_entry_files_no_update
BEFORE UPDATE ON buyer_advance_principal_entry_files
BEGIN SELECT RAISE(ABORT,'advance_principal_entry_files_are_immutable'); END;
CREATE TRIGGER trg_buyer_advance_principal_entry_files_no_delete
BEFORE DELETE ON buyer_advance_principal_entry_files
BEGIN SELECT RAISE(ABORT,'advance_principal_entry_files_are_immutable'); END;

-- If an advance payment exceeded the later formal refund obligation, only the
-- amount actually due is settled into the refund ledger. The excess remains an
-- explicit Owner-visible overpayment fact instead of silently inflating PAID.
CREATE TABLE buyer_advance_principal_overpayments (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 16 AND 120),
  advance_payment_entry_id TEXT NOT NULL UNIQUE REFERENCES buyer_advance_principal_entries(id),
  buyer_refund_obligation_id TEXT NOT NULL REFERENCES buyer_refund_obligations(id),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  excess_amount_cny_fen INTEGER NOT NULL CHECK(excess_amount_cny_fen>0),
  recognized_at INTEGER NOT NULL CHECK(recognized_at>=0)
) STRICT;
CREATE INDEX idx_buyer_advance_principal_overpayments_order
ON buyer_advance_principal_overpayments(formal_order_id,recognized_at,id);
CREATE TRIGGER trg_buyer_advance_principal_overpayments_no_update
BEFORE UPDATE ON buyer_advance_principal_overpayments
BEGIN SELECT RAISE(ABORT,'advance_principal_overpayments_are_immutable'); END;
CREATE TRIGGER trg_buyer_advance_principal_overpayments_no_delete
BEFORE DELETE ON buyer_advance_principal_overpayments
BEGIN SELECT RAISE(ABORT,'advance_principal_overpayments_are_immutable'); END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='buyer_advance_principal_entry_files')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='buyer_advance_principal_overpayments')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_buyer_advance_principal_entry_files_guard')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=63,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=62;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
