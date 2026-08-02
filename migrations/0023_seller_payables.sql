PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Wave 11 / Phase 3J: immutable seller payable facts.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=22
) THEN 1 ELSE 0 END;

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

CREATE INDEX idx_seller_payables_organization_due
ON seller_payables (
  seller_organization_id, payable_type, due_at, id
);

CREATE INDEX idx_seller_payables_snapshot
ON seller_payables (financial_snapshot_id, payable_type, id);

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

CREATE TRIGGER trg_seller_payables_no_update
BEFORE UPDATE ON seller_payables
BEGIN
  SELECT RAISE(ABORT, 'seller_payables_are_immutable');
END;

CREATE TRIGGER trg_seller_payables_no_delete
BEFORE DELETE ON seller_payables
BEGIN
  SELECT RAISE(ABORT, 'seller_payables_are_immutable');
END;

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

CREATE INDEX idx_seller_payable_events_payable
ON seller_payable_events (payable_id, created_at, id);

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

CREATE TRIGGER trg_seller_payable_events_no_update
BEFORE UPDATE ON seller_payable_events
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_events_are_immutable');
END;

CREATE TRIGGER trg_seller_payable_events_no_delete
BEFORE DELETE ON seller_payable_events
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_events_are_immutable');
END;

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

CREATE INDEX idx_seller_payable_reconciliation_conflicts_detected
ON seller_payable_reconciliation_conflicts (
  detected_at, entity_type, entity_id, reason_code
);

CREATE TRIGGER trg_seller_payable_conflicts_no_update
BEFORE UPDATE ON seller_payable_reconciliation_conflicts
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_reconciliation_conflicts_are_immutable');
END;

CREATE TRIGGER trg_seller_payable_conflicts_no_delete
BEFORE DELETE ON seller_payable_reconciliation_conflicts
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_reconciliation_conflicts_are_immutable');
END;

-- Record historical conflicts instead of guessing. Every internal primary key
-- is a fixed-length opaque value; business uniqueness provides idempotency.
INSERT OR IGNORE INTO seller_payable_reconciliation_conflicts (
  id, entity_type, entity_id, reason_code, detected_at
)
SELECT
  lower(hex(randomblob(16))),
  'FORMAL_ORDER', formal_order.id, 'FINANCIAL_SNAPSHOT_MISSING',
  CAST(unixepoch('now') AS INTEGER) * 1000
FROM formal_orders formal_order
WHERE NOT EXISTS (
  SELECT 1 FROM formal_order_financial_snapshots snapshot
  WHERE snapshot.formal_order_id=formal_order.id
);

INSERT OR IGNORE INTO seller_payable_reconciliation_conflicts (
  id, entity_type, entity_id, reason_code, detected_at
)
SELECT
  lower(hex(randomblob(16))),
  'FORMAL_ORDER', formal_order.id, 'FINANCIAL_SNAPSHOT_MULTIPLE',
  CAST(unixepoch('now') AS INTEGER) * 1000
FROM formal_orders formal_order
WHERE (
  SELECT COUNT(*) FROM formal_order_financial_snapshots snapshot
  WHERE snapshot.formal_order_id=formal_order.id
)>1;

INSERT OR IGNORE INTO seller_payable_reconciliation_conflicts (
  id, entity_type, entity_id, reason_code, detected_at
)
SELECT
  lower(hex(randomblob(16))),
  'REVIEW_CASE', review_case.id, 'REVIEW_APPROVAL_SOURCE_CONFLICT',
  CAST(unixepoch('now') AS INTEGER) * 1000
FROM review_cases review_case
WHERE review_case.status='APPROVED'
  AND (
    SELECT COUNT(*) FROM review_events approval
    WHERE approval.review_case_id=review_case.id
      AND approval.event_type='REVIEW_APPROVED'
  )<>1;

INSERT OR IGNORE INTO seller_payable_reconciliation_conflicts (
  id, entity_type, entity_id, reason_code, detected_at
)
SELECT
  lower(hex(randomblob(16))),
  'REVIEW_CASE', review_case.id, 'SELLER_ORGANIZATION_MISMATCH',
  CAST(unixepoch('now') AS INTEGER) * 1000
FROM review_cases review_case
JOIN formal_orders formal_order ON formal_order.id=review_case.formal_order_id
WHERE review_case.status='APPROVED'
  AND review_case.seller_organization_id<>formal_order.seller_organization_id;

-- Safe, deterministic and idempotent historical principal reconciliation.
INSERT OR IGNORE INTO seller_payables (
  id, seller_organization_id, formal_order_id, payable_type,
  amount_cny_fen, financial_snapshot_id, source_type, source_id,
  due_at, created_at
)
SELECT
  lower(hex(randomblob(16))),
  formal_order.seller_organization_id,
  formal_order.id,
  'SELLER_PRINCIPAL',
  snapshot.seller_expected_principal_cny_fen,
  snapshot.id,
  'FORMAL_ORDER',
  formal_order.id,
  formal_order.confirmed_at,
  formal_order.confirmed_at
FROM formal_orders formal_order
JOIN formal_order_financial_snapshots snapshot
  ON snapshot.formal_order_id=formal_order.id
WHERE formal_order.status='CONFIRMED'
  AND (
    SELECT COUNT(*) FROM formal_order_financial_snapshots one_snapshot
    WHERE one_snapshot.formal_order_id=formal_order.id
  )=1;

INSERT OR IGNORE INTO seller_payable_events (
  id, payable_id, event_type, actor_type, actor_id,
  amount_cny_fen, metadata_json, idempotency_key, created_at
)
SELECT
  lower(hex(randomblob(16))),
  payable.id,
  'PAYABLE_RECONCILED',
  'SYSTEM',
  'migration:0023',
  payable.amount_cny_fen,
  '{"source":"historical_formal_order"}',
  'migration:0023:principal',
  payable.created_at
FROM seller_payables payable
WHERE payable.payable_type='SELLER_PRINCIPAL';

-- Safe historical service-fee reconciliation requires one approval event and
-- one immutable financial snapshot.
INSERT OR IGNORE INTO seller_payables (
  id, seller_organization_id, formal_order_id, payable_type,
  amount_cny_fen, financial_snapshot_id, source_type, source_id,
  due_at, created_at
)
SELECT
  lower(hex(randomblob(16))),
  review_case.seller_organization_id,
  review_case.formal_order_id,
  'SELLER_SERVICE_FEE',
  snapshot.service_fee_cny_fen,
  snapshot.id,
  'REVIEW_APPROVAL',
  review_case.id,
  approval.created_at,
  approval.created_at
FROM review_cases review_case
JOIN formal_orders formal_order
  ON formal_order.id=review_case.formal_order_id
  AND formal_order.seller_organization_id=review_case.seller_organization_id
JOIN review_events approval
  ON approval.review_case_id=review_case.id
  AND approval.formal_order_id=review_case.formal_order_id
  AND approval.event_type='REVIEW_APPROVED'
JOIN formal_order_financial_snapshots snapshot
  ON snapshot.formal_order_id=review_case.formal_order_id
WHERE review_case.status='APPROVED'
  AND (
    SELECT COUNT(*) FROM review_events one_approval
    WHERE one_approval.review_case_id=review_case.id
      AND one_approval.event_type='REVIEW_APPROVED'
  )=1
  AND (
    SELECT COUNT(*) FROM formal_order_financial_snapshots one_snapshot
    WHERE one_snapshot.formal_order_id=review_case.formal_order_id
  )=1;

INSERT OR IGNORE INTO seller_payable_events (
  id, payable_id, event_type, actor_type, actor_id,
  amount_cny_fen, metadata_json, idempotency_key, created_at
)
SELECT
  lower(hex(randomblob(16))),
  payable.id,
  'PAYABLE_RECONCILED',
  'SYSTEM',
  'migration:0023',
  payable.amount_cny_fen,
  '{"source":"historical_review_approval"}',
  'migration:0023:service-fee',
  payable.created_at
FROM seller_payables payable
WHERE payable.payable_type='SELLER_SERVICE_FEE';

CREATE VIEW seller_payable_balances AS
SELECT
  payable.id AS payable_id,
  payable.seller_organization_id,
  payable.formal_order_id,
  payable.payable_type,
  payable.amount_cny_fen,
  0 AS paid_amount_cny_fen,
  payable.amount_cny_fen AS outstanding_amount_cny_fen,
  CASE WHEN payable.amount_cny_fen=0 THEN 'PAID' ELSE 'UNPAID' END AS derived_status,
  payable.financial_snapshot_id,
  payable.source_type,
  payable.source_id,
  payable.due_at,
  payable.created_at
FROM seller_payables payable;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=formal_order.id
    WHERE formal_order.status='CONFIRMED'
      AND (
        SELECT COUNT(*) FROM formal_order_financial_snapshots one_snapshot
        WHERE one_snapshot.formal_order_id=formal_order.id
      )=1
      AND NOT EXISTS (
        SELECT 1 FROM seller_payables payable
        WHERE payable.formal_order_id=formal_order.id
          AND payable.payable_type='SELLER_PRINCIPAL'
      )
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='view' AND name='seller_payable_balances'
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET
  schema_version=23,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=22;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;