PRAGMA foreign_keys = ON;

-- Migration 0041 adds an additive, versioned policy for the seller-principal
-- rate. Existing seller agreement and financial snapshot rows remain intact
-- as compatibility projections; no historical financial fact is rewritten.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=40
) THEN 1 ELSE 0 END;

CREATE TABLE seller_principal_rate_policy_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('CURRENCY_PAIR_DEFAULT', 'SELLER_ORGANIZATION')
  ),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  source_currency_code TEXT NOT NULL REFERENCES currencies(code),
  quote_currency_code TEXT NOT NULL REFERENCES currencies(code),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED','CONFIRMED','REJECTED')),
  markup_rate_value INTEGER NOT NULL CHECK (
    markup_rate_value BETWEEN 0 AND 9007199254740991
  ),
  rate_scale INTEGER NOT NULL CHECK (rate_scale=100000000),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  submitted_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  submitted_at INTEGER NOT NULL CHECK (submitted_at >= 0),
  decision_version INTEGER NOT NULL CHECK (decision_version IN (1, 2)),
  confirmed_by_staff_id TEXT REFERENCES staff_users(id),
  confirmed_at INTEGER,
  rejected_by_staff_id TEXT REFERENCES staff_users(id),
  rejected_at INTEGER,
  rejection_reason TEXT,
  CHECK (
    (scope_type='CURRENCY_PAIR_DEFAULT' AND seller_organization_id IS NULL)
    OR (scope_type='SELLER_ORGANIZATION' AND seller_organization_id IS NOT NULL)
  ),
  CHECK (
    (status='SUBMITTED' AND decision_version=1
      AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NULL AND rejected_at IS NULL
      AND rejection_reason IS NULL)
    OR (status='CONFIRMED' AND decision_version=2
      AND confirmed_at IS NOT NULL AND confirmed_by_staff_id IS NOT NULL
      AND confirmed_at >= submitted_at
      AND rejected_by_staff_id IS NULL AND rejected_at IS NULL
      AND rejection_reason IS NULL)
    OR (status='REJECTED' AND decision_version=2
      AND rejected_at IS NOT NULL AND rejected_by_staff_id IS NOT NULL
      AND rejected_at >= submitted_at
      AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL
      AND rejection_reason IS NOT NULL
      AND length(rejection_reason) BETWEEN 1 AND 1000)
  )
) STRICT;

CREATE TRIGGER trg_seller_principal_rate_policy_initial_state_guard
BEFORE INSERT ON seller_principal_rate_policy_versions
WHEN NEW.status<>'SUBMITTED' OR NEW.decision_version<>1
  OR NEW.confirmed_by_staff_id IS NOT NULL OR NEW.confirmed_at IS NOT NULL
  OR NEW.rejected_by_staff_id IS NOT NULL OR NEW.rejected_at IS NOT NULL
  OR NEW.rejection_reason IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_initial_state_must_be_submitted');
END;

CREATE TRIGGER trg_seller_principal_rate_policy_decision_guard
BEFORE UPDATE ON seller_principal_rate_policy_versions
WHEN NOT (
  OLD.status='SUBMITTED'
  AND NEW.status IN ('CONFIRMED','REJECTED')
  AND NEW.decision_version=OLD.decision_version+1
  AND NEW.id IS OLD.id
  AND NEW.scope_type IS OLD.scope_type
  AND NEW.seller_organization_id IS OLD.seller_organization_id
  AND NEW.source_currency_code IS OLD.source_currency_code
  AND NEW.quote_currency_code IS OLD.quote_currency_code
  AND NEW.version_no=OLD.version_no
  AND NEW.markup_rate_value=OLD.markup_rate_value
  AND NEW.rate_scale=OLD.rate_scale
  AND NEW.effective_from=OLD.effective_from
  AND NEW.submitted_by_staff_id IS OLD.submitted_by_staff_id
  AND NEW.submitted_at=OLD.submitted_at
  AND (
    (NEW.status='CONFIRMED'
      AND NEW.confirmed_by_staff_id IS NOT NULL
      AND NEW.confirmed_at IS NOT NULL
      AND NEW.rejected_by_staff_id IS NULL
      AND NEW.rejected_at IS NULL
      AND NEW.rejection_reason IS NULL)
    OR (NEW.status='REJECTED'
      AND NEW.confirmed_by_staff_id IS NULL
      AND NEW.confirmed_at IS NULL
      AND NEW.rejected_by_staff_id IS NOT NULL
      AND NEW.rejected_at IS NOT NULL
      AND NEW.rejection_reason IS NOT NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_decision_transition_denied');
END;

CREATE TRIGGER trg_seller_principal_rate_policy_no_delete
BEFORE DELETE ON seller_principal_rate_policy_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_versions_are_immutable');
END;

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_version
ON seller_principal_rate_policy_versions (
  scope_type, COALESCE(seller_organization_id, ''),
  source_currency_code, quote_currency_code, version_no
);

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_pending
ON seller_principal_rate_policy_versions (
  scope_type, COALESCE(seller_organization_id, ''),
  source_currency_code, quote_currency_code
)
WHERE status='SUBMITTED';

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_confirmed_effective
ON seller_principal_rate_policy_versions (
  scope_type, COALESCE(seller_organization_id, ''),
  source_currency_code, quote_currency_code, effective_from
)
WHERE status='CONFIRMED';

CREATE INDEX idx_seller_principal_rate_policy_resolve
ON seller_principal_rate_policy_versions (
  scope_type, seller_organization_id, source_currency_code,
  quote_currency_code, status, effective_from, confirmed_at, version_no
);

CREATE TABLE seller_principal_rate_policy_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  version_id TEXT NOT NULL REFERENCES seller_principal_rate_policy_versions(id),
  scope_type TEXT NOT NULL,
  seller_organization_id TEXT,
  source_currency_code TEXT NOT NULL,
  quote_currency_code TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED',
      'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED',
      'SELLER_PRINCIPAL_RATE_POLICY_REJECTED'
    )
  ),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  previous_status TEXT,
  next_status TEXT NOT NULL CHECK (next_status IN ('SUBMITTED','CONFIRMED','REJECTED')),
  markup_rate_value INTEGER NOT NULL CHECK (markup_rate_value >= 0),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  reason TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (
    (scope_type='CURRENCY_PAIR_DEFAULT' AND seller_organization_id IS NULL)
    OR (scope_type='SELLER_ORGANIZATION' AND seller_organization_id IS NOT NULL)
  ),
  CHECK (previous_status IS NULL OR previous_status IN ('SUBMITTED','CONFIRMED','REJECTED')),
  CHECK (
    (event_type='SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED'
      AND previous_status IS NULL AND next_status='SUBMITTED' AND reason IS NULL)
    OR (event_type='SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED'
      AND previous_status='SUBMITTED' AND next_status='CONFIRMED' AND reason IS NULL)
    OR (event_type='SELLER_PRINCIPAL_RATE_POLICY_REJECTED'
      AND previous_status='SUBMITTED' AND next_status='REJECTED'
      AND reason IS NOT NULL AND length(reason) BETWEEN 1 AND 1000)
  )
) STRICT;

CREATE TRIGGER trg_seller_principal_rate_policy_event_source_guard
BEFORE INSERT ON seller_principal_rate_policy_events
WHEN NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_versions policy
  WHERE policy.id=NEW.version_id
    AND policy.scope_type=NEW.scope_type
    AND policy.seller_organization_id IS NEW.seller_organization_id
    AND policy.source_currency_code=NEW.source_currency_code
    AND policy.quote_currency_code=NEW.quote_currency_code
    AND policy.version_no=NEW.version_no
    AND policy.status=NEW.next_status
    AND policy.markup_rate_value=NEW.markup_rate_value
    AND policy.effective_from=NEW.effective_from
)
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_event_source_mismatch');
END;

CREATE TRIGGER trg_seller_principal_rate_policy_event_no_update
BEFORE UPDATE ON seller_principal_rate_policy_events
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_events_are_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_policy_event_no_delete
BEFORE DELETE ON seller_principal_rate_policy_events
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_events_are_immutable');
END;

CREATE INDEX idx_seller_principal_rate_policy_events_version
ON seller_principal_rate_policy_events (version_id, created_at, id);

CREATE TABLE seller_principal_rate_snapshots (
  formal_order_id TEXT PRIMARY KEY REFERENCES formal_orders(id),
  platform_order_date TEXT NOT NULL CHECK (
    length(platform_order_date)=10
    AND platform_order_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(platform_order_date)=platform_order_date
  ),
  payment_amount_minor INTEGER NOT NULL CHECK (
    payment_amount_minor BETWEEN 0 AND 9007199254740991
  ),
  payment_currency_code TEXT NOT NULL REFERENCES currencies(code),
  base_rate_version_id TEXT NOT NULL
    REFERENCES buyer_daily_currency_rate_versions(id),
  base_rate_business_date TEXT NOT NULL,
  base_rate_confirmed_at INTEGER NOT NULL CHECK (base_rate_confirmed_at >= 0),
  base_rate_value INTEGER NOT NULL CHECK (
    base_rate_value BETWEEN 1 AND 9007199254740991
  ),
  base_rate_scale INTEGER NOT NULL CHECK (base_rate_scale=100000000),
  policy_version_id TEXT NOT NULL
    REFERENCES seller_principal_rate_policy_versions(id),
  policy_scope_type TEXT NOT NULL CHECK (
    policy_scope_type IN ('CURRENCY_PAIR_DEFAULT', 'SELLER_ORGANIZATION')
  ),
  policy_seller_organization_id TEXT REFERENCES seller_organizations(id),
  policy_version_no INTEGER NOT NULL CHECK (policy_version_no >= 1),
  policy_effective_from INTEGER NOT NULL CHECK (policy_effective_from >= 0),
  policy_confirmed_at INTEGER NOT NULL CHECK (policy_confirmed_at >= 0),
  markup_rate_value INTEGER NOT NULL CHECK (
    markup_rate_value BETWEEN 0 AND 9007199254740991
  ),
  markup_rate_scale INTEGER NOT NULL CHECK (markup_rate_scale=100000000),
  final_rate_value INTEGER NOT NULL CHECK (
    final_rate_value BETWEEN 1 AND 9007199254740991
  ),
  final_rate_scale INTEGER NOT NULL CHECK (final_rate_scale=100000000),
  rounding_rule TEXT NOT NULL CHECK (rounding_rule='HALF_UP'),
  seller_expected_principal_amount_minor INTEGER NOT NULL CHECK (
    seller_expected_principal_amount_minor BETWEEN 0 AND 9007199254740991
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (
    (policy_scope_type='CURRENCY_PAIR_DEFAULT'
      AND policy_seller_organization_id IS NULL)
    OR (policy_scope_type='SELLER_ORGANIZATION'
      AND policy_seller_organization_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_seller_principal_rate_snapshots_date
ON seller_principal_rate_snapshots (platform_order_date, created_at, formal_order_id);

CREATE TRIGGER trg_seller_principal_rate_snapshot_guard
BEFORE INSERT ON seller_principal_rate_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM formal_orders formal_order
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.amazon_order_date=NEW.platform_order_date
    AND formal_order.final_paid_jpy=NEW.payment_amount_minor
    AND (
      (NEW.policy_scope_type='CURRENCY_PAIR_DEFAULT'
        AND NEW.policy_seller_organization_id IS NULL)
      OR (NEW.policy_scope_type='SELLER_ORGANIZATION'
        AND NEW.policy_seller_organization_id IS formal_order.seller_organization_id)
    )
)
OR NEW.base_rate_business_date<>NEW.platform_order_date
OR NOT EXISTS (
  SELECT 1 FROM buyer_daily_currency_rate_versions rate
  WHERE rate.id=NEW.base_rate_version_id
    AND rate.business_date=NEW.base_rate_business_date
    AND rate.source_currency_code=NEW.payment_currency_code
    AND rate.quote_currency_code='CNY'
    AND rate.status='CONFIRMED'
    AND rate.rate_value=NEW.base_rate_value
    AND rate.rate_scale=NEW.base_rate_scale
    AND rate.confirmed_at=NEW.base_rate_confirmed_at
    AND rate.confirmed_at<=NEW.created_at
)
OR NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_versions policy
  WHERE policy.id=NEW.policy_version_id
    AND policy.scope_type=NEW.policy_scope_type
    AND policy.seller_organization_id IS NEW.policy_seller_organization_id
    AND policy.version_no=NEW.policy_version_no
    AND policy.source_currency_code=NEW.payment_currency_code
    AND policy.quote_currency_code='CNY'
    AND policy.status='CONFIRMED'
    AND policy.markup_rate_value=NEW.markup_rate_value
    AND policy.rate_scale=NEW.markup_rate_scale
    AND policy.effective_from=NEW.policy_effective_from
    AND policy.confirmed_at=NEW.policy_confirmed_at
    AND policy.effective_from<=NEW.created_at
    AND policy.confirmed_at<=NEW.created_at
)
OR NEW.final_rate_value<>NEW.base_rate_value+NEW.markup_rate_value
OR NEW.base_rate_value > 9007199254740991-NEW.markup_rate_value
OR CASE
  /*
   * HALF_UP(payment * final_rate / 1,000,000), without multiplying the two
   * large SQLite INTEGER operands directly.  Split both operands into
   * quotient/remainder parts and reject every intermediate overflow before
   * evaluating the corresponding product.
   */
  WHEN (NEW.payment_amount_minor / 1000000)
      > (9007199254740991 / NEW.final_rate_value) THEN 1
  WHEN (NEW.final_rate_value / 1000000) > 0
    AND (NEW.payment_amount_minor % 1000000)
      > (9007199254740991 / (NEW.final_rate_value / 1000000)) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
      > 9007199254740991
        - ((NEW.payment_amount_minor % 1000000)
          * (NEW.final_rate_value / 1000000)) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
      + ((NEW.payment_amount_minor % 1000000)
        * (NEW.final_rate_value / 1000000))
      > 9007199254740991
        - (((NEW.payment_amount_minor % 1000000)
          * (NEW.final_rate_value % 1000000) + 500000) / 1000000) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
      + ((NEW.payment_amount_minor % 1000000)
        * (NEW.final_rate_value / 1000000))
      + (((NEW.payment_amount_minor % 1000000)
        * (NEW.final_rate_value % 1000000) + 500000) / 1000000)
      <> NEW.seller_expected_principal_amount_minor THEN 1
  ELSE 0
END=1
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshot_source_mismatch');
END;

CREATE TRIGGER trg_seller_principal_rate_snapshots_no_update
BEFORE UPDATE ON seller_principal_rate_snapshots
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshots_are_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_snapshots_no_delete
BEFORE DELETE ON seller_principal_rate_snapshots
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshots_are_immutable');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='seller_principal_rate_policy_versions')
  AND EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='seller_principal_rate_snapshots')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=41,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=40;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
