PRAGMA foreign_keys = ON;

-- Formal migration 0017: only advances schema_version from 16 to 17.
-- Any other preceding schema version must fail before any DDL is applied.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM app_schema_state
  WHERE singleton_id=1
    AND schema_version=16
) THEN 1 ELSE 0 END;

CREATE TABLE buyer_refund_obligations (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  source_review_event_id TEXT NOT NULL UNIQUE
    REFERENCES review_events(id),
  review_case_id TEXT NOT NULL
    REFERENCES review_cases(id),
  formal_order_id TEXT NOT NULL UNIQUE
    REFERENCES formal_orders(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  due_amount_cny_fen INTEGER NOT NULL
    CHECK (due_amount_cny_fen BETWEEN 0 AND 9007199254740991),
  version INTEGER NOT NULL
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_buyer_refund_obligations_buyer
ON buyer_refund_obligations (
  buyer_customer_id,
  updated_at,
  id
);

CREATE TRIGGER trg_buyer_refund_obligation_source_guard
BEFORE INSERT ON buyer_refund_obligations
WHEN NOT EXISTS (
  SELECT 1
  FROM review_events source_event
  JOIN review_cases review_case
    ON review_case.id=source_event.review_case_id
    AND review_case.formal_order_id=source_event.formal_order_id
  JOIN formal_orders formal_order
    ON formal_order.id=source_event.formal_order_id
    AND formal_order.buyer_customer_id=review_case.buyer_customer_id
  WHERE source_event.id=NEW.source_review_event_id
    AND source_event.event_type='BUYER_REFUND_BECAME_DUE'
    AND source_event.next_status='APPROVED'
    AND source_event.amount_cny_fen=NEW.due_amount_cny_fen
    AND source_event.review_case_id=NEW.review_case_id
    AND source_event.formal_order_id=NEW.formal_order_id
    AND review_case.status='APPROVED'
    AND review_case.buyer_customer_id=NEW.buyer_customer_id
    AND NEW.version=1
    AND NEW.created_at=NEW.updated_at
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_obligation_source_mismatch');
END;

CREATE TRIGGER trg_buyer_refund_obligation_version_guard
BEFORE UPDATE ON buyer_refund_obligations
WHEN
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.source_review_event_id IS OLD.source_review_event_id)
  OR NOT (NEW.review_case_id IS OLD.review_case_id)
  OR NOT (NEW.formal_order_id IS OLD.formal_order_id)
  OR NOT (NEW.buyer_customer_id IS OLD.buyer_customer_id)
  OR NOT (NEW.due_amount_cny_fen IS OLD.due_amount_cny_fen)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<=OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_obligation_invalid_update');
END;

CREATE TRIGGER trg_buyer_refund_obligations_no_delete
BEFORE DELETE ON buyer_refund_obligations
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_obligations_are_immutable');
END;

CREATE TABLE buyer_refund_payment_entries (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  obligation_id TEXT NOT NULL
    REFERENCES buyer_refund_obligations(id),
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('PAYMENT', 'REVERSAL')),
  original_payment_entry_id TEXT
    REFERENCES buyer_refund_payment_entries(id),
  amount_cny_fen INTEGER NOT NULL
    CHECK (amount_cny_fen BETWEEN 1 AND 9007199254740991),
  paid_at INTEGER
    CHECK (paid_at IS NULL OR paid_at >= 0),
  reversed_at INTEGER
    CHECK (reversed_at IS NULL OR reversed_at >= 0),
  china_business_date TEXT NOT NULL
    CHECK (
      china_business_date GLOB '????-??-??'
      AND date(china_business_date)=china_business_date
    ),
  payment_channel TEXT NOT NULL
    CHECK (payment_channel IN (
      'WECHAT',
      'ALIPAY',
      'BANK_TRANSFER',
      'OTHER_MANUAL'
    )),
  recorded_by_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  public_note TEXT
    CHECK (public_note IS NULL OR length(public_note) BETWEEN 1 AND 2000),
  internal_note TEXT
    CHECK (internal_note IS NULL OR length(internal_note) BETWEEN 1 AND 4000),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL
    CHECK (
      length(request_hash)=64
      AND request_hash NOT GLOB '*[^0-9a-f]*'
    ),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (recorded_by_staff_id, idempotency_key),
  CHECK (
    (entry_type='PAYMENT'
      AND original_payment_entry_id IS NULL
      AND paid_at IS NOT NULL
      AND reversed_at IS NULL)
    OR
    (entry_type='REVERSAL'
      AND original_payment_entry_id IS NOT NULL
      AND paid_at IS NULL
      AND reversed_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_buyer_refund_payment_entries_obligation
ON buyer_refund_payment_entries (
  obligation_id,
  created_at,
  id
);

CREATE INDEX idx_buyer_refund_payment_entries_original
ON buyer_refund_payment_entries (
  original_payment_entry_id,
  created_at,
  id
)
WHERE entry_type='REVERSAL';

CREATE TRIGGER trg_buyer_refund_payment_entry_source_guard
BEFORE INSERT ON buyer_refund_payment_entries
WHEN
  NOT EXISTS (
    SELECT 1
    FROM buyer_refund_obligations obligation
    JOIN staff_users staff
      ON staff.id=NEW.recorded_by_staff_id
      AND staff.status='ACTIVE'
    WHERE obligation.id=NEW.obligation_id
  )
  OR (
    NEW.entry_type='REVERSAL'
    AND NOT EXISTS (
      SELECT 1
      FROM buyer_refund_payment_entries original
      WHERE original.id=NEW.original_payment_entry_id
        AND original.obligation_id=NEW.obligation_id
        AND original.entry_type='PAYMENT'
        AND original.payment_channel=NEW.payment_channel
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_entry_source_mismatch');
END;

CREATE TRIGGER trg_buyer_refund_reversal_limit_guard
BEFORE INSERT ON buyer_refund_payment_entries
WHEN NEW.entry_type='REVERSAL' AND NEW.amount_cny_fen>(
  SELECT original.amount_cny_fen-COALESCE((
    SELECT SUM(existing.amount_cny_fen)
    FROM buyer_refund_payment_entries existing
    WHERE existing.entry_type='REVERSAL'
      AND existing.original_payment_entry_id=original.id
  ), 0)
  FROM buyer_refund_payment_entries original
  WHERE original.id=NEW.original_payment_entry_id
    AND original.obligation_id=NEW.obligation_id
    AND original.entry_type='PAYMENT'
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_reversal_exceeds_payment');
END;

CREATE TRIGGER trg_buyer_refund_payment_entries_no_update
BEFORE UPDATE ON buyer_refund_payment_entries
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_entries_are_immutable');
END;

CREATE TRIGGER trg_buyer_refund_payment_entries_no_delete
BEFORE DELETE ON buyer_refund_payment_entries
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_entries_are_immutable');
END;

CREATE TABLE buyer_refund_payment_entry_files (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  obligation_id TEXT NOT NULL
    REFERENCES buyer_refund_obligations(id),
  payment_entry_id TEXT NOT NULL
    REFERENCES buyer_refund_payment_entries(id),
  file_object_id TEXT NOT NULL UNIQUE
    REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE
    REFERENCES file_entity_links(id),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (payment_entry_id, file_object_id)
) STRICT;

CREATE INDEX idx_buyer_refund_payment_entry_files_payment
ON buyer_refund_payment_entry_files (
  payment_entry_id,
  created_at,
  id
);

CREATE TRIGGER trg_buyer_refund_payment_entry_file_guard
BEFORE INSERT ON buyer_refund_payment_entry_files
WHEN NOT EXISTS (
  SELECT 1
  FROM buyer_refund_payment_entries payment
  JOIN file_objects object
    ON object.id=NEW.file_object_id
  JOIN file_upload_intents intent
    ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id
    AND link.file_object_id=object.id
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
      SELECT COUNT(*)
      FROM file_entity_audience_grants grant_row
      WHERE grant_row.file_entity_link_id=link.id
        AND grant_row.revoked_at IS NULL
        AND (
          grant_row.expires_at IS NULL
          OR grant_row.expires_at>NEW.created_at
        )
    )=1
    AND EXISTS (
      SELECT 1
      FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='BUYER_REFUND_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND (
          staff_grant.expires_at IS NULL
          OR staff_grant.expires_at>NEW.created_at
        )
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

CREATE TABLE buyer_refund_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  obligation_id TEXT NOT NULL
    REFERENCES buyer_refund_obligations(id),
  payment_entry_id TEXT
    REFERENCES buyer_refund_payment_entries(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'BUYER_REFUND_OBLIGATION_CREATED',
      'BUYER_REFUND_PAYMENT_RECORDED',
      'BUYER_REFUND_PAYMENT_REVERSED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('STAFF', 'SYSTEM')),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  obligation_version INTEGER NOT NULL
    CHECK (obligation_version >= 1),
  amount_cny_fen INTEGER NOT NULL
    CHECK (amount_cny_fen BETWEEN 0 AND 9007199254740991),
  net_paid_after_cny_fen INTEGER NOT NULL
    CHECK (net_paid_after_cny_fen BETWEEN 0 AND 9007199254740991),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  CHECK (
    (event_type='BUYER_REFUND_OBLIGATION_CREATED'
      AND payment_entry_id IS NULL
      AND actor_type IN ('STAFF', 'SYSTEM')
      AND obligation_version=1
      AND net_paid_after_cny_fen=0)
    OR
    (event_type='BUYER_REFUND_PAYMENT_RECORDED'
      AND payment_entry_id IS NOT NULL
      AND actor_type='STAFF'
      AND amount_cny_fen>0)
    OR
    (event_type='BUYER_REFUND_PAYMENT_REVERSED'
      AND payment_entry_id IS NOT NULL
      AND actor_type='STAFF'
      AND amount_cny_fen>0)
  )
) STRICT;

CREATE INDEX idx_buyer_refund_events_obligation
ON buyer_refund_events (
  obligation_id,
  created_at,
  id
);

CREATE UNIQUE INDEX uq_buyer_refund_obligation_created_event
ON buyer_refund_events (obligation_id, event_type)
WHERE event_type='BUYER_REFUND_OBLIGATION_CREATED';

CREATE UNIQUE INDEX uq_buyer_refund_payment_event
ON buyer_refund_events (payment_entry_id, event_type)
WHERE payment_entry_id IS NOT NULL;

CREATE TRIGGER trg_buyer_refund_event_identity_guard
BEFORE INSERT ON buyer_refund_events
WHEN
  NOT EXISTS (
    SELECT 1
    FROM buyer_refund_obligations obligation
    WHERE obligation.id=NEW.obligation_id
      AND obligation.version=NEW.obligation_version
  )
  OR (
    NEW.event_type='BUYER_REFUND_OBLIGATION_CREATED'
    AND NOT EXISTS (
      SELECT 1
      FROM buyer_refund_obligations obligation
      WHERE obligation.id=NEW.obligation_id
        AND obligation.due_amount_cny_fen=NEW.amount_cny_fen
    )
  )
  OR (
    NEW.event_type='BUYER_REFUND_PAYMENT_RECORDED'
    AND NOT EXISTS (
      SELECT 1
      FROM buyer_refund_payment_entries payment
      WHERE payment.id=NEW.payment_entry_id
        AND payment.obligation_id=NEW.obligation_id
        AND payment.entry_type='PAYMENT'
        AND payment.amount_cny_fen=NEW.amount_cny_fen
        AND payment.recorded_by_staff_id=NEW.actor_id
    )
  )
  OR (
    NEW.event_type='BUYER_REFUND_PAYMENT_REVERSED'
    AND NOT EXISTS (
      SELECT 1
      FROM buyer_refund_payment_entries reversal
      WHERE reversal.id=NEW.payment_entry_id
        AND reversal.obligation_id=NEW.obligation_id
        AND reversal.entry_type='REVERSAL'
        AND reversal.amount_cny_fen=NEW.amount_cny_fen
        AND reversal.recorded_by_staff_id=NEW.actor_id
    )
  )
  OR NEW.net_paid_after_cny_fen<>(
    SELECT COALESCE(SUM(
      CASE
        WHEN entry.entry_type='PAYMENT' THEN entry.amount_cny_fen
        ELSE -entry.amount_cny_fen
      END
    ), 0)
    FROM buyer_refund_payment_entries entry
    WHERE entry.obligation_id=NEW.obligation_id
  )
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_event_identity_mismatch');
END;

CREATE TRIGGER trg_buyer_refund_events_no_update
BEFORE UPDATE ON buyer_refund_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_refund_events_no_delete
BEFORE DELETE ON buyer_refund_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_events_are_immutable');
END;

CREATE VIEW buyer_refund_ledger_balances AS
SELECT
  obligation.id AS obligation_id,
  obligation.source_review_event_id,
  obligation.review_case_id,
  obligation.formal_order_id,
  obligation.buyer_customer_id,
  obligation.due_amount_cny_fen,
  COALESCE(SUM(
    CASE WHEN entry.entry_type='PAYMENT'
      THEN entry.amount_cny_fen ELSE 0 END
  ), 0) AS gross_paid_cny_fen,
  COALESCE(SUM(
    CASE WHEN entry.entry_type='REVERSAL'
      THEN entry.amount_cny_fen ELSE 0 END
  ), 0) AS reversed_cny_fen,
  COALESCE(SUM(
    CASE
      WHEN entry.entry_type='PAYMENT' THEN entry.amount_cny_fen
      WHEN entry.entry_type='REVERSAL' THEN -entry.amount_cny_fen
      ELSE 0
    END
  ), 0) AS net_paid_cny_fen,
  CASE
    WHEN COALESCE(SUM(
      CASE
        WHEN entry.entry_type='PAYMENT' THEN entry.amount_cny_fen
        WHEN entry.entry_type='REVERSAL' THEN -entry.amount_cny_fen
        ELSE 0
      END
    ), 0)=0 THEN 'DUE'
    WHEN COALESCE(SUM(
      CASE
        WHEN entry.entry_type='PAYMENT' THEN entry.amount_cny_fen
        WHEN entry.entry_type='REVERSAL' THEN -entry.amount_cny_fen
        ELSE 0
      END
    ), 0)<obligation.due_amount_cny_fen THEN 'PARTIALLY_PAID'
    WHEN COALESCE(SUM(
      CASE
        WHEN entry.entry_type='PAYMENT' THEN entry.amount_cny_fen
        WHEN entry.entry_type='REVERSAL' THEN -entry.amount_cny_fen
        ELSE 0
      END
    ), 0)=obligation.due_amount_cny_fen THEN 'PAID'
    ELSE 'OVERPAID'
  END AS status,
  obligation.version,
  obligation.created_at,
  obligation.updated_at
FROM buyer_refund_obligations obligation
LEFT JOIN buyer_refund_payment_entries entry
  ON entry.obligation_id=obligation.id
GROUP BY obligation.id;

UPDATE app_schema_state
SET
  schema_version=17,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=16;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
