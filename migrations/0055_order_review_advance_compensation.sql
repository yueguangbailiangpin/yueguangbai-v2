PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=54
) THEN 1 ELSE 0 END;

-- Formal order confirmation remains immutable. Later platform/business problems
-- are compensation events layered above the confirmed order.
CREATE TABLE formal_order_operational_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'PLATFORM_CANCELLED','RETURN_REFUND','BUSINESS_VOID','MANUAL_INVESTIGATION','RESOLVED'
  )),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 2000),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE INDEX idx_formal_order_operational_events_order
ON formal_order_operational_events(formal_order_id,created_at DESC,id DESC);
CREATE TRIGGER trg_formal_order_operational_events_no_update
BEFORE UPDATE ON formal_order_operational_events
BEGIN SELECT RAISE(ABORT,'formal_order_operational_events_are_immutable'); END;
CREATE TRIGGER trg_formal_order_operational_events_no_delete
BEFORE DELETE ON formal_order_operational_events
BEGIN SELECT RAISE(ABORT,'formal_order_operational_events_are_immutable'); END;

CREATE VIEW formal_order_effective_operational_state AS
SELECT formal_order.id AS formal_order_id,
  COALESCE((
    SELECT CASE event.event_type WHEN 'RESOLVED' THEN 'NORMAL' ELSE event.event_type END
    FROM formal_order_operational_events event
    WHERE event.formal_order_id=formal_order.id
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1
  ),'NORMAL') AS operational_state,
  (
    SELECT event.created_at FROM formal_order_operational_events event
    WHERE event.formal_order_id=formal_order.id
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1
  ) AS state_changed_at
FROM formal_orders formal_order;

-- Financial corrections are append-only signed adjustments. Frozen snapshots
-- and original payable/refund facts are never rewritten.
CREATE TABLE formal_order_financial_adjustments (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  source_operational_event_id TEXT REFERENCES formal_order_operational_events(id),
  adjustment_scope TEXT NOT NULL CHECK (adjustment_scope IN (
    'PROJECTED_GROSS_PROFIT','COMPLETED_GROSS_PROFIT','SELLER_PRINCIPAL_DUE',
    'SELLER_SERVICE_FEE_DUE','BUYER_REFUND_DUE'
  )),
  amount_cny_fen INTEGER NOT NULL CHECK (amount_cny_fen<>0),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 2000),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE INDEX idx_formal_order_financial_adjustments_order
ON formal_order_financial_adjustments(formal_order_id,adjustment_scope,created_at,id);
CREATE TRIGGER trg_formal_order_financial_adjustments_no_update
BEFORE UPDATE ON formal_order_financial_adjustments
BEGIN SELECT RAISE(ABORT,'formal_order_financial_adjustments_are_immutable'); END;
CREATE TRIGGER trg_formal_order_financial_adjustments_no_delete
BEFORE DELETE ON formal_order_financial_adjustments
BEGIN SELECT RAISE(ABORT,'formal_order_financial_adjustments_are_immutable'); END;

-- Review approval is a historical decision. Marketplace display health is a
-- separate observation stream so dropped/not-shown reviews do not rewrite approval.
CREATE TABLE review_visibility_observations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  review_case_id TEXT NOT NULL REFERENCES review_cases(id),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  visibility_status TEXT NOT NULL CHECK (visibility_status IN (
    'VISIBLE','NOT_VISIBLE','DROPPED','RECHECK_REQUIRED'
  )),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  observed_at INTEGER NOT NULL CHECK (observed_at>=0),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;
CREATE INDEX idx_review_visibility_case
ON review_visibility_observations(review_case_id,observed_at DESC,id DESC);
CREATE TRIGGER trg_review_visibility_observations_no_update
BEFORE UPDATE ON review_visibility_observations
BEGIN SELECT RAISE(ABORT,'review_visibility_observations_are_immutable'); END;
CREATE TRIGGER trg_review_visibility_observations_no_delete
BEFORE DELETE ON review_visibility_observations
BEGIN SELECT RAISE(ABORT,'review_visibility_observations_are_immutable'); END;

-- Advance buyer principal payments happen before a formal refund obligation.
-- They remain their own immutable ledger and are later settled against the
-- obligation instead of pretending the obligation existed earlier.
CREATE TABLE buyer_advance_principal_entries (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('PAYMENT','REVERSAL')),
  original_payment_entry_id TEXT REFERENCES buyer_advance_principal_entries(id),
  amount_cny_fen INTEGER NOT NULL CHECK (amount_cny_fen>0),
  paid_at INTEGER,
  reversed_at INTEGER,
  china_business_date TEXT NOT NULL CHECK (
    china_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(china_business_date)=china_business_date
  ),
  payment_channel TEXT NOT NULL CHECK (payment_channel IN ('WECHAT','ALIPAY','BANK_TRANSFER','OTHER_MANUAL')),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  CHECK (
    (entry_type='PAYMENT' AND original_payment_entry_id IS NULL AND paid_at IS NOT NULL AND reversed_at IS NULL)
    OR
    (entry_type='REVERSAL' AND original_payment_entry_id IS NOT NULL AND paid_at IS NULL AND reversed_at IS NOT NULL)
  )
) STRICT;
CREATE INDEX idx_buyer_advance_principal_order
ON buyer_advance_principal_entries(formal_order_id,created_at,id);
CREATE TRIGGER trg_buyer_advance_principal_entries_no_update
BEFORE UPDATE ON buyer_advance_principal_entries
BEGIN SELECT RAISE(ABORT,'buyer_advance_principal_entries_are_immutable'); END;
CREATE TRIGGER trg_buyer_advance_principal_entries_no_delete
BEFORE DELETE ON buyer_advance_principal_entries
BEGIN SELECT RAISE(ABORT,'buyer_advance_principal_entries_are_immutable'); END;

CREATE TABLE buyer_advance_principal_settlements (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  advance_payment_entry_id TEXT NOT NULL UNIQUE REFERENCES buyer_advance_principal_entries(id),
  buyer_refund_obligation_id TEXT NOT NULL REFERENCES buyer_refund_obligations(id),
  buyer_refund_payment_entry_id TEXT NOT NULL UNIQUE REFERENCES buyer_refund_payment_entries(id),
  settled_amount_cny_fen INTEGER NOT NULL CHECK (settled_amount_cny_fen>0),
  settled_at INTEGER NOT NULL CHECK (settled_at>=0)
) STRICT;
CREATE TRIGGER trg_buyer_advance_principal_settlements_no_update
BEFORE UPDATE ON buyer_advance_principal_settlements
BEGIN SELECT RAISE(ABORT,'buyer_advance_principal_settlements_are_immutable'); END;
CREATE TRIGGER trg_buyer_advance_principal_settlements_no_delete
BEFORE DELETE ON buyer_advance_principal_settlements
BEGIN SELECT RAISE(ABORT,'buyer_advance_principal_settlements_are_immutable'); END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='view' AND name='formal_order_effective_operational_state')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='formal_order_financial_adjustments')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='review_visibility_observations')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='buyer_advance_principal_entries')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='buyer_advance_principal_settlements')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=55,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=54;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
