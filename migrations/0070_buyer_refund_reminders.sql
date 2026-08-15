-- T7 buyer-initiated refund reminders. This is forward-only from Schema 69.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=69 THEN 1 ELSE 0 END;

CREATE TABLE buyer_refund_reminders (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  obligation_id TEXT NOT NULL REFERENCES buyer_refund_obligations(id),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  reminded_at INTEGER NOT NULL CHECK (reminded_at>=0),
  created_at INTEGER NOT NULL CHECK (created_at=reminded_at),
  UNIQUE (buyer_customer_id, idempotency_key)
) STRICT;

CREATE INDEX idx_buyer_refund_reminders_obligation_recent
ON buyer_refund_reminders (obligation_id, reminded_at DESC, id DESC);

CREATE TRIGGER trg_buyer_refund_reminders_source_guard
BEFORE INSERT ON buyer_refund_reminders
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_reminder_source_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM buyer_refund_obligations obligation
    WHERE obligation.id=NEW.obligation_id
      AND obligation.buyer_customer_id=NEW.buyer_customer_id
  );
END;

CREATE TRIGGER trg_buyer_refund_reminders_no_update
BEFORE UPDATE ON buyer_refund_reminders
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_reminders_are_immutable');
END;

CREATE TRIGGER trg_buyer_refund_reminders_no_delete
BEFORE DELETE ON buyer_refund_reminders
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_reminders_are_immutable');
END;

UPDATE app_schema_state SET schema_version=70 WHERE singleton_id=1;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
