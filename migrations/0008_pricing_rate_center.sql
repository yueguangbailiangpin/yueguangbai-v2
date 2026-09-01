-- Baseline 0008 pricing_rate_center (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=7 THEN 1 ELSE 0 END;

CREATE TABLE seller_service_fee_versions (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  review_type TEXT NOT NULL
    CHECK (review_type IN ('RATING', 'TEXT', 'IMAGE', 'VIDEO')),
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  status TEXT NOT NULL
    CHECK (status IN ('SUBMITTED', 'CONFIRMED', 'REJECTED')),
  fee_cny_fen INTEGER NOT NULL
    CHECK (fee_cny_fen BETWEEN 0 AND 9007199254740991),
  effective_from INTEGER NOT NULL
    CHECK (effective_from >= 0),
  submitted_by_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  submitted_at INTEGER NOT NULL
    CHECK (submitted_at >= 0),
  decision_version INTEGER NOT NULL DEFAULT 1
    CHECK (decision_version IN (1, 2)),
  confirmed_by_staff_id TEXT
    REFERENCES staff_users(id),
  confirmed_at INTEGER,
  rejected_by_staff_id TEXT
    REFERENCES staff_users(id),
  rejected_at INTEGER,
  rejection_reason TEXT
    CHECK (
      rejection_reason IS NULL
      OR length(rejection_reason) BETWEEN 1 AND 1000
    ),
  UNIQUE (organization_id, review_type, version_no),
  CHECK (
    (
      status='SUBMITTED'
      AND decision_version=1
      AND confirmed_by_staff_id IS NULL
      AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NULL
      AND rejected_at IS NULL
      AND rejection_reason IS NULL
    )
    OR
    (
      status='CONFIRMED'
      AND decision_version=2
      AND confirmed_by_staff_id IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND confirmed_at >= submitted_at
      AND effective_from > confirmed_at
      AND rejected_by_staff_id IS NULL
      AND rejected_at IS NULL
      AND rejection_reason IS NULL
    )
    OR
    (
      status='REJECTED'
      AND decision_version=2
      AND confirmed_by_staff_id IS NULL
      AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NOT NULL
      AND rejected_at IS NOT NULL
      AND rejected_at >= submitted_at
      AND rejection_reason IS NOT NULL
    )
  )
) STRICT;

CREATE TABLE buyer_daily_exchange_rates (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  business_date TEXT NOT NULL
    CHECK (
      business_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(business_date)=business_date
    ),
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  status TEXT NOT NULL
    CHECK (status IN ('SUBMITTED', 'CONFIRMED', 'REJECTED')),
  cny_per_jpy_e8 INTEGER NOT NULL
    CHECK (
      cny_per_jpy_e8 BETWEEN 1 AND 9007199254740991
    ),
  submitted_by_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  submitted_at INTEGER NOT NULL
    CHECK (submitted_at >= 0),
  decision_version INTEGER NOT NULL DEFAULT 1
    CHECK (decision_version IN (1, 2)),
  confirmed_by_staff_id TEXT
    REFERENCES staff_users(id),
  confirmed_at INTEGER,
  rejected_by_staff_id TEXT
    REFERENCES staff_users(id),
  rejected_at INTEGER,
  rejection_reason TEXT
    CHECK (
      rejection_reason IS NULL
      OR length(rejection_reason) BETWEEN 1 AND 1000
    ),
  UNIQUE (business_date, version_no),
  CHECK (
    (
      status='SUBMITTED'
      AND decision_version=1
      AND confirmed_by_staff_id IS NULL
      AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NULL
      AND rejected_at IS NULL
      AND rejection_reason IS NULL
    )
    OR
    (
      status='CONFIRMED'
      AND decision_version=2
      AND confirmed_by_staff_id IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND confirmed_at >= submitted_at
      AND rejected_by_staff_id IS NULL
      AND rejected_at IS NULL
      AND rejection_reason IS NULL
    )
    OR
    (
      status='REJECTED'
      AND decision_version=2
      AND confirmed_by_staff_id IS NULL
      AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NOT NULL
      AND rejected_at IS NOT NULL
      AND rejected_at >= submitted_at
      AND rejection_reason IS NOT NULL
    )
  )
) STRICT;

CREATE TABLE buyer_daily_currency_rate_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  legacy_rate_id TEXT UNIQUE REFERENCES buyer_daily_exchange_rates(id),
  business_date TEXT NOT NULL CHECK (
    business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(business_date)=business_date
  ),
  source_currency_code TEXT NOT NULL REFERENCES currencies(code),
  quote_currency_code TEXT NOT NULL REFERENCES currencies(code)
    CHECK (quote_currency_code='CNY'),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED','CONFIRMED','REJECTED')),
  rate_value INTEGER NOT NULL CHECK (rate_value BETWEEN 1 AND 9007199254740991),
  rate_scale INTEGER NOT NULL CHECK (rate_scale BETWEEN 1 AND 9007199254740991),
  rounding_rule TEXT NOT NULL CHECK (rounding_rule='HALF_UP'),
  submitted_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  submitted_at INTEGER NOT NULL CHECK (submitted_at >= 0),
  decision_version INTEGER NOT NULL CHECK (decision_version IN (1,2)),
  confirmed_by_staff_id TEXT REFERENCES staff_users(id),
  confirmed_at INTEGER,
  rejected_by_staff_id TEXT REFERENCES staff_users(id),
  rejected_at INTEGER,
  rejection_reason TEXT CHECK (
    rejection_reason IS NULL OR length(rejection_reason) BETWEEN 1 AND 1000
  ),
  UNIQUE (business_date, source_currency_code, quote_currency_code, version_no),
  CHECK (source_currency_code<>quote_currency_code),
  CHECK (
    (status='SUBMITTED' AND decision_version=1
      AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NULL AND rejected_at IS NULL
      AND rejection_reason IS NULL)
    OR (status='CONFIRMED' AND decision_version=2
      AND confirmed_by_staff_id IS NOT NULL AND confirmed_at IS NOT NULL
      AND rejected_by_staff_id IS NULL AND rejected_at IS NULL
      AND rejection_reason IS NULL)
    OR (status='REJECTED' AND decision_version=2
      AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NOT NULL AND rejected_at IS NOT NULL
      AND rejection_reason IS NOT NULL)
  )
) STRICT;

CREATE TABLE buyer_daily_exchange_rate_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  version_id TEXT NOT NULL
    REFERENCES buyer_daily_exchange_rates(id),
  organization_id TEXT,
  business_date TEXT NOT NULL,
  review_type TEXT,
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'BUYER_DAILY_EXCHANGE_RATE_SUBMITTED',
      'BUYER_DAILY_EXCHANGE_RATE_CONFIRMED',
      'BUYER_DAILY_EXCHANGE_RATE_REJECTED'
    )),
  actor_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  previous_status TEXT,
  next_status TEXT NOT NULL
    CHECK (next_status IN ('SUBMITTED', 'CONFIRMED', 'REJECTED')),
  cny_per_jpy_e8 INTEGER NOT NULL
    CHECK (
      cny_per_jpy_e8 BETWEEN 1 AND 9007199254740991
    ),
  fee_cny_fen INTEGER,
  effective_from INTEGER,
  reason TEXT
    CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  CHECK (
    organization_id IS NULL
    AND review_type IS NULL
    AND fee_cny_fen IS NULL
    AND effective_from IS NULL
    AND business_date GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(business_date)=business_date
  ),
  CHECK (
    (event_type='BUYER_DAILY_EXCHANGE_RATE_SUBMITTED'
      AND previous_status IS NULL
      AND next_status='SUBMITTED'
      AND reason IS NULL)
    OR
    (event_type='BUYER_DAILY_EXCHANGE_RATE_CONFIRMED'
      AND previous_status='SUBMITTED'
      AND next_status='CONFIRMED'
      AND reason IS NULL)
    OR
    (event_type='BUYER_DAILY_EXCHANGE_RATE_REJECTED'
      AND previous_status='SUBMITTED'
      AND next_status='REJECTED'
      AND reason IS NOT NULL)
  )
) STRICT;

CREATE TABLE seller_service_fee_rule_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  legacy_fee_id TEXT UNIQUE REFERENCES seller_service_fee_versions(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL,
  review_type TEXT NOT NULL CHECK (
    review_type IN ('RATING','TEXT','IMAGE','VIDEO')
  ),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED','CONFIRMED','REJECTED')),
  fee_amount_minor INTEGER NOT NULL CHECK (
    fee_amount_minor BETWEEN 0 AND 9007199254740991
  ),
  fee_currency_code TEXT NOT NULL REFERENCES currencies(code)
    CHECK (fee_currency_code='CNY'),
  fee_currency_exponent INTEGER NOT NULL CHECK (fee_currency_exponent=2),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  submitted_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  submitted_at INTEGER NOT NULL CHECK (submitted_at >= 0),
  decision_version INTEGER NOT NULL CHECK (decision_version IN (1,2)),
  confirmed_by_staff_id TEXT REFERENCES staff_users(id),
  confirmed_at INTEGER,
  rejected_by_staff_id TEXT REFERENCES staff_users(id),
  rejected_at INTEGER,
  rejection_reason TEXT CHECK (
    rejection_reason IS NULL OR length(rejection_reason) BETWEEN 1 AND 1000
  ),
  UNIQUE (
    seller_organization_id, marketplace_code, review_type, version_no
  ),
  CHECK (
    (status='SUBMITTED' AND decision_version=1
      AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NULL AND rejected_at IS NULL
      AND rejection_reason IS NULL)
    OR (status='CONFIRMED' AND decision_version=2
      AND confirmed_by_staff_id IS NOT NULL AND confirmed_at IS NOT NULL
      AND rejected_by_staff_id IS NULL AND rejected_at IS NULL
      AND rejection_reason IS NULL)
    OR (status='REJECTED' AND decision_version=2
      AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL
      AND rejected_by_staff_id IS NOT NULL AND rejected_at IS NOT NULL
      AND rejection_reason IS NOT NULL)
  )
) STRICT;

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

CREATE TABLE seller_service_fee_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  version_id TEXT NOT NULL
    REFERENCES seller_service_fee_versions(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  business_date TEXT,
  review_type TEXT NOT NULL
    CHECK (review_type IN ('RATING', 'TEXT', 'IMAGE', 'VIDEO')),
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'SELLER_SERVICE_FEE_SUBMITTED',
      'SELLER_SERVICE_FEE_CONFIRMED',
      'SELLER_SERVICE_FEE_REJECTED'
    )),
  actor_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  previous_status TEXT,
  next_status TEXT NOT NULL
    CHECK (next_status IN ('SUBMITTED', 'CONFIRMED', 'REJECTED')),
  cny_per_jpy_e8 INTEGER,
  fee_cny_fen INTEGER NOT NULL
    CHECK (fee_cny_fen BETWEEN 0 AND 9007199254740991),
  effective_from INTEGER NOT NULL
    CHECK (effective_from >= 0),
  reason TEXT
    CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  CHECK (
    business_date IS NULL
    AND cny_per_jpy_e8 IS NULL
  ),
  CHECK (
    (event_type='SELLER_SERVICE_FEE_SUBMITTED'
      AND previous_status IS NULL
      AND next_status='SUBMITTED'
      AND reason IS NULL)
    OR
    (event_type='SELLER_SERVICE_FEE_CONFIRMED'
      AND previous_status='SUBMITTED'
      AND next_status='CONFIRMED'
      AND reason IS NULL)
    OR
    (event_type='SELLER_SERVICE_FEE_REJECTED'
      AND previous_status='SUBMITTED'
      AND next_status='REJECTED'
      AND reason IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_buyer_daily_rate_events_version
ON buyer_daily_exchange_rate_events (
  version_id,
  created_at,
  id
);

CREATE INDEX idx_buyer_daily_rate_exact_resolution
ON buyer_daily_exchange_rates (
  business_date,
  status,
  confirmed_at,
  id
);

CREATE INDEX idx_seller_principal_rate_policy_events_version
ON seller_principal_rate_policy_events (version_id, created_at, id);

CREATE INDEX idx_seller_principal_rate_policy_resolve
ON seller_principal_rate_policy_versions (
  scope_type, seller_organization_id, source_currency_code,
  quote_currency_code, status, effective_from, confirmed_at, version_no
);

CREATE INDEX idx_seller_principal_rate_snapshots_date
ON seller_principal_rate_snapshots (platform_order_date, created_at, formal_order_id);

CREATE INDEX idx_seller_service_fee_events_version
ON seller_service_fee_events (
  version_id,
  created_at,
  id
);

CREATE INDEX idx_seller_service_fee_resolution
ON seller_service_fee_versions (
  organization_id,
  review_type,
  status,
  effective_from DESC,
  confirmed_at,
  version_no DESC
);

CREATE INDEX idx_seller_service_fee_rule_current
ON seller_service_fee_rule_versions (
  seller_organization_id, marketplace_code, review_type,
  status, effective_from DESC, version_no DESC
);

CREATE UNIQUE INDEX uq_buyer_daily_currency_rate_confirmed
ON buyer_daily_currency_rate_versions (
  business_date, source_currency_code, quote_currency_code
) WHERE status='CONFIRMED';

CREATE UNIQUE INDEX uq_buyer_daily_currency_rate_pending
ON buyer_daily_currency_rate_versions (
  business_date, source_currency_code, quote_currency_code
) WHERE status='SUBMITTED';

CREATE UNIQUE INDEX uq_buyer_daily_rate_confirmed_date
ON buyer_daily_exchange_rates (business_date)
WHERE status='CONFIRMED';

CREATE UNIQUE INDEX uq_buyer_daily_rate_pending_date
ON buyer_daily_exchange_rates (business_date)
WHERE status='SUBMITTED';

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_confirmed_effective
ON seller_principal_rate_policy_versions (
  scope_type, COALESCE(seller_organization_id, ''),
  source_currency_code, quote_currency_code, effective_from
)
WHERE status='CONFIRMED';

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_event_type
ON seller_principal_rate_policy_events (version_id, event_type);

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_pending
ON seller_principal_rate_policy_versions (
  scope_type, COALESCE(seller_organization_id, ''),
  source_currency_code, quote_currency_code
)
WHERE status='SUBMITTED';

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_version
ON seller_principal_rate_policy_versions (
  scope_type, COALESCE(seller_organization_id, ''),
  source_currency_code, quote_currency_code, version_no
);

CREATE UNIQUE INDEX uq_seller_service_fee_effective
ON seller_service_fee_versions (
  organization_id,
  review_type,
  effective_from
)
WHERE status='CONFIRMED';

CREATE UNIQUE INDEX uq_seller_service_fee_pending
ON seller_service_fee_versions (
  organization_id,
  review_type
)
WHERE status='SUBMITTED';

CREATE TRIGGER trg_buyer_daily_currency_rate_legacy_insert
AFTER INSERT ON buyer_daily_exchange_rates
BEGIN
  INSERT INTO buyer_daily_currency_rate_versions (
    id, legacy_rate_id, business_date, source_currency_code,
    quote_currency_code, version_no, status, rate_value, rate_scale,
    rounding_rule, submitted_by_staff_id, submitted_at, decision_version,
    confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
    rejection_reason
  ) VALUES (
    'currency-' || NEW.id, NEW.id, NEW.business_date, 'JPY', 'CNY',
    NEW.version_no, NEW.status, NEW.cny_per_jpy_e8, 100000000, 'HALF_UP',
    NEW.submitted_by_staff_id, NEW.submitted_at, NEW.decision_version,
    NEW.confirmed_by_staff_id, NEW.confirmed_at, NEW.rejected_by_staff_id,
    NEW.rejected_at, NEW.rejection_reason
  );
END;

CREATE TRIGGER trg_buyer_daily_currency_rate_legacy_update
AFTER UPDATE ON buyer_daily_exchange_rates
BEGIN
  UPDATE buyer_daily_currency_rate_versions
  SET status=NEW.status, decision_version=NEW.decision_version,
    confirmed_by_staff_id=NEW.confirmed_by_staff_id,
    confirmed_at=NEW.confirmed_at,
    rejected_by_staff_id=NEW.rejected_by_staff_id,
    rejected_at=NEW.rejected_at,
    rejection_reason=NEW.rejection_reason
  WHERE legacy_rate_id=NEW.id;
END;

CREATE TRIGGER trg_buyer_daily_currency_rate_no_delete
BEFORE DELETE ON buyer_daily_currency_rate_versions
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_currency_rate_version_is_immutable');
END;

CREATE TRIGGER trg_buyer_daily_currency_rate_update_guard
BEFORE UPDATE ON buyer_daily_currency_rate_versions
WHEN OLD.status<>'SUBMITTED'
  OR NEW.id<>OLD.id OR NEW.legacy_rate_id IS NOT OLD.legacy_rate_id
  OR NEW.business_date<>OLD.business_date
  OR NEW.source_currency_code<>OLD.source_currency_code
  OR NEW.quote_currency_code<>OLD.quote_currency_code
  OR NEW.version_no<>OLD.version_no OR NEW.rate_value<>OLD.rate_value
  OR NEW.rate_scale<>OLD.rate_scale OR NEW.rounding_rule<>OLD.rounding_rule
  OR NEW.submitted_by_staff_id<>OLD.submitted_by_staff_id
  OR NEW.submitted_at<>OLD.submitted_at
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_currency_rate_version_is_immutable');
END;

CREATE TRIGGER trg_buyer_daily_rate_after_confirmed_guard
BEFORE INSERT ON buyer_daily_exchange_rates
WHEN EXISTS (
  SELECT 1
  FROM buyer_daily_exchange_rates
  WHERE business_date=NEW.business_date
    AND status='CONFIRMED'
)
BEGIN
  SELECT RAISE(ABORT, 'pricing_confirmed_conflict');
END;

CREATE TRIGGER trg_buyer_daily_rate_confirmed_conflict
BEFORE UPDATE OF status ON buyer_daily_exchange_rates
WHEN NEW.status='CONFIRMED' AND EXISTS (
  SELECT 1
  FROM buyer_daily_exchange_rates existing
  WHERE existing.business_date=NEW.business_date
    AND existing.status='CONFIRMED'
    AND existing.id<>NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'pricing_confirmed_conflict');
END;

CREATE TRIGGER trg_buyer_daily_rate_decision_only
BEFORE UPDATE ON buyer_daily_exchange_rates
WHEN NOT (
  OLD.status='SUBMITTED'
  AND NEW.status IN ('CONFIRMED', 'REJECTED')
  AND NEW.id=OLD.id
  AND NEW.business_date=OLD.business_date
  AND NEW.version_no=OLD.version_no
  AND NEW.cny_per_jpy_e8=OLD.cny_per_jpy_e8
  AND NEW.submitted_by_staff_id=OLD.submitted_by_staff_id
  AND NEW.submitted_at=OLD.submitted_at
  AND NEW.decision_version=OLD.decision_version+1
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_exchange_rate_is_immutable');
END;

CREATE TRIGGER trg_buyer_daily_rate_events_no_delete
BEFORE DELETE ON buyer_daily_exchange_rate_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_exchange_rate_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_daily_rate_events_no_update
BEFORE UPDATE ON buyer_daily_exchange_rate_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_exchange_rate_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_daily_rate_initial_state_guard
BEFORE INSERT ON buyer_daily_exchange_rates
WHEN NEW.status<>'SUBMITTED'
BEGIN
  SELECT RAISE(ABORT, 'pricing_initial_state_must_be_submitted');
END;

CREATE TRIGGER trg_buyer_daily_rate_no_delete
BEFORE DELETE ON buyer_daily_exchange_rates
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_exchange_rate_is_immutable');
END;

CREATE TRIGGER trg_buyer_daily_rate_pending_conflict
BEFORE INSERT ON buyer_daily_exchange_rates
WHEN NEW.status='SUBMITTED' AND EXISTS (
  SELECT 1
  FROM buyer_daily_exchange_rates
  WHERE business_date=NEW.business_date
    AND status='SUBMITTED'
)
BEGIN
  SELECT RAISE(ABORT, 'pricing_pending_conflict');
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

CREATE TRIGGER trg_seller_principal_rate_policy_event_fidelity_guard
BEFORE INSERT ON seller_principal_rate_policy_events
WHEN NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_versions policy
  WHERE policy.id=NEW.version_id
    AND policy.scope_type=NEW.scope_type
    AND policy.seller_organization_id IS NEW.seller_organization_id
    AND policy.source_currency_code=NEW.source_currency_code
    AND policy.quote_currency_code=NEW.quote_currency_code
    AND policy.version_no=NEW.version_no
    AND policy.markup_rate_value=NEW.markup_rate_value
    AND policy.effective_from=NEW.effective_from
    AND (
      (NEW.event_type='SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED'
        AND NEW.actor_staff_id=policy.submitted_by_staff_id
        AND NEW.created_at=policy.submitted_at
        AND NEW.reason IS NULL)
      OR (NEW.event_type='SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED'
        AND policy.status='CONFIRMED'
        AND NEW.actor_staff_id=policy.confirmed_by_staff_id
        AND NEW.created_at=policy.confirmed_at
        AND NEW.reason IS NULL)
      OR (NEW.event_type='SELLER_PRINCIPAL_RATE_POLICY_REJECTED'
        AND policy.status='REJECTED'
        AND NEW.actor_staff_id=policy.rejected_by_staff_id
        AND NEW.created_at=policy.rejected_at
        AND NEW.reason=policy.rejection_reason)
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'seller_principal_rate_policy_event_source_mismatch'
  );
END;

CREATE TRIGGER trg_seller_principal_rate_policy_event_no_delete
BEFORE DELETE ON seller_principal_rate_policy_events
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_events_are_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_policy_event_no_update
BEFORE UPDATE ON seller_principal_rate_policy_events
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_events_are_immutable');
END;

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

CREATE TRIGGER trg_seller_principal_rate_policy_future_effective_guard
BEFORE UPDATE ON seller_principal_rate_policy_versions
WHEN NEW.status='CONFIRMED'
  AND (NEW.confirmed_at IS NULL OR NEW.effective_from<=NEW.confirmed_at)
BEGIN
  SELECT RAISE(
    ABORT,
    'seller_principal_rate_policy_effective_time_conflict'
  );
END;

CREATE TRIGGER trg_seller_principal_rate_policy_initial_state_guard
BEFORE INSERT ON seller_principal_rate_policy_versions
WHEN NEW.status<>'SUBMITTED' OR NEW.decision_version<>1
  OR NEW.confirmed_by_staff_id IS NOT NULL OR NEW.confirmed_at IS NOT NULL
  OR NEW.rejected_by_staff_id IS NOT NULL OR NEW.rejected_at IS NOT NULL
  OR NEW.rejection_reason IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_initial_state_must_be_submitted');
END;

CREATE TRIGGER trg_seller_principal_rate_policy_no_delete
BEFORE DELETE ON seller_principal_rate_policy_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_versions_are_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_snapshots_no_delete
BEFORE DELETE ON seller_principal_rate_snapshots
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshots_are_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_snapshots_no_update
BEFORE UPDATE ON seller_principal_rate_snapshots
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshots_are_immutable');
END;

CREATE TRIGGER trg_seller_service_fee_decision_only
BEFORE UPDATE ON seller_service_fee_versions
WHEN NOT (
  OLD.status='SUBMITTED'
  AND NEW.status IN ('CONFIRMED', 'REJECTED')
  AND NEW.id=OLD.id
  AND NEW.organization_id=OLD.organization_id
  AND NEW.review_type=OLD.review_type
  AND NEW.version_no=OLD.version_no
  AND NEW.fee_cny_fen=OLD.fee_cny_fen
  AND NEW.effective_from=OLD.effective_from
  AND NEW.submitted_by_staff_id=OLD.submitted_by_staff_id
  AND NEW.submitted_at=OLD.submitted_at
  AND NEW.decision_version=OLD.decision_version+1
)
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_version_is_immutable');
END;

CREATE TRIGGER trg_seller_service_fee_effective_conflict
BEFORE UPDATE OF status ON seller_service_fee_versions
WHEN NEW.status='CONFIRMED' AND EXISTS (
  SELECT 1
  FROM seller_service_fee_versions existing
  WHERE existing.organization_id=NEW.organization_id
    AND existing.review_type=NEW.review_type
    AND existing.effective_from=NEW.effective_from
    AND existing.status='CONFIRMED'
    AND existing.id<>NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'pricing_effective_conflict');
END;

CREATE TRIGGER trg_seller_service_fee_events_no_delete
BEFORE DELETE ON seller_service_fee_events
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_events_are_immutable');
END;

CREATE TRIGGER trg_seller_service_fee_events_no_update
BEFORE UPDATE ON seller_service_fee_events
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_events_are_immutable');
END;

CREATE TRIGGER trg_seller_service_fee_initial_state_guard
BEFORE INSERT ON seller_service_fee_versions
WHEN NEW.status<>'SUBMITTED'
BEGIN
  SELECT RAISE(ABORT, 'pricing_initial_state_must_be_submitted');
END;

CREATE TRIGGER trg_seller_service_fee_no_delete
BEFORE DELETE ON seller_service_fee_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_version_is_immutable');
END;

CREATE TRIGGER trg_seller_service_fee_pending_conflict
BEFORE INSERT ON seller_service_fee_versions
WHEN NEW.status='SUBMITTED' AND EXISTS (
  SELECT 1
  FROM seller_service_fee_versions
  WHERE organization_id=NEW.organization_id
    AND review_type=NEW.review_type
    AND status='SUBMITTED'
)
BEGIN
  SELECT RAISE(ABORT, 'pricing_pending_conflict');
END;

CREATE TRIGGER trg_seller_service_fee_rule_legacy_insert
AFTER INSERT ON seller_service_fee_versions
BEGIN
  INSERT INTO seller_service_fee_rule_versions (
    id, legacy_fee_id, seller_organization_id, marketplace_code,
    review_type, version_no, status, fee_amount_minor, fee_currency_code,
    fee_currency_exponent, effective_from, submitted_by_staff_id,
    submitted_at, decision_version, confirmed_by_staff_id, confirmed_at,
    rejected_by_staff_id, rejected_at, rejection_reason
  ) VALUES (
    'marketplace-' || NEW.id, NEW.id, NEW.organization_id, 'AMAZON_JP',
    NEW.review_type, NEW.version_no, NEW.status, NEW.fee_cny_fen, 'CNY', 2,
    NEW.effective_from, NEW.submitted_by_staff_id, NEW.submitted_at,
    NEW.decision_version, NEW.confirmed_by_staff_id, NEW.confirmed_at,
    NEW.rejected_by_staff_id, NEW.rejected_at, NEW.rejection_reason
  );
END;

CREATE TRIGGER trg_seller_service_fee_rule_legacy_update
AFTER UPDATE ON seller_service_fee_versions
BEGIN
  UPDATE seller_service_fee_rule_versions
  SET status=NEW.status, decision_version=NEW.decision_version,
    confirmed_by_staff_id=NEW.confirmed_by_staff_id,
    confirmed_at=NEW.confirmed_at,
    rejected_by_staff_id=NEW.rejected_by_staff_id,
    rejected_at=NEW.rejected_at,
    rejection_reason=NEW.rejection_reason
  WHERE legacy_fee_id=NEW.id;
END;

CREATE TRIGGER trg_seller_service_fee_rule_no_delete
BEFORE DELETE ON seller_service_fee_rule_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_rule_version_is_immutable');
END;

CREATE TRIGGER trg_seller_service_fee_rule_update_guard
BEFORE UPDATE ON seller_service_fee_rule_versions
WHEN OLD.status<>'SUBMITTED'
  OR NEW.id<>OLD.id OR NEW.legacy_fee_id IS NOT OLD.legacy_fee_id
  OR NEW.seller_organization_id<>OLD.seller_organization_id
  OR NEW.marketplace_code<>OLD.marketplace_code
  OR NEW.review_type<>OLD.review_type OR NEW.version_no<>OLD.version_no
  OR NEW.fee_amount_minor<>OLD.fee_amount_minor
  OR NEW.fee_currency_code<>OLD.fee_currency_code
  OR NEW.fee_currency_exponent<>OLD.fee_currency_exponent
  OR NEW.effective_from<>OLD.effective_from
  OR NEW.submitted_by_staff_id<>OLD.submitted_by_staff_id
  OR NEW.submitted_at<>OLD.submitted_at
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_rule_version_is_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=8,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
