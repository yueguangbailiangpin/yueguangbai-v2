PRAGMA foreign_keys = ON;

-- Formal migration 0011: only advances schema_version from 10 to 11.
-- Any other preceding schema version must fail before any DDL is applied.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM app_schema_state
  WHERE singleton_id=1
    AND schema_version=10
) THEN 1 ELSE 0 END;

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

CREATE UNIQUE INDEX uq_buyer_daily_rate_pending_date
ON buyer_daily_exchange_rates (business_date)
WHERE status='SUBMITTED';

CREATE UNIQUE INDEX uq_buyer_daily_rate_confirmed_date
ON buyer_daily_exchange_rates (business_date)
WHERE status='CONFIRMED';

CREATE INDEX idx_buyer_daily_rate_exact_resolution
ON buyer_daily_exchange_rates (
  business_date,
  status,
  confirmed_at,
  id
);

CREATE TRIGGER trg_buyer_daily_rate_initial_state_guard
BEFORE INSERT ON buyer_daily_exchange_rates
WHEN NEW.status<>'SUBMITTED'
BEGIN
  SELECT RAISE(ABORT, 'pricing_initial_state_must_be_submitted');
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

CREATE TRIGGER trg_buyer_daily_rate_no_delete
BEFORE DELETE ON buyer_daily_exchange_rates
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_exchange_rate_is_immutable');
END;

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

CREATE INDEX idx_buyer_daily_rate_events_version
ON buyer_daily_exchange_rate_events (
  version_id,
  created_at,
  id
);

CREATE TRIGGER trg_buyer_daily_rate_events_no_update
BEFORE UPDATE ON buyer_daily_exchange_rate_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_exchange_rate_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_daily_rate_events_no_delete
BEFORE DELETE ON buyer_daily_exchange_rate_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_exchange_rate_events_are_immutable');
END;

CREATE TABLE seller_agreement_rate_versions (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  review_type TEXT,
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  status TEXT NOT NULL
    CHECK (status IN ('SUBMITTED', 'CONFIRMED', 'REJECTED')),
  cny_per_jpy_e8 INTEGER NOT NULL
    CHECK (
      cny_per_jpy_e8 BETWEEN 1 AND 9007199254740991
    ),
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
  UNIQUE (organization_id, version_no),
  CHECK (review_type IS NULL),
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

CREATE UNIQUE INDEX uq_seller_agreement_rate_pending
ON seller_agreement_rate_versions (organization_id)
WHERE status='SUBMITTED';

CREATE UNIQUE INDEX uq_seller_agreement_rate_effective
ON seller_agreement_rate_versions (
  organization_id,
  effective_from
)
WHERE status='CONFIRMED';

CREATE INDEX idx_seller_agreement_rate_resolution
ON seller_agreement_rate_versions (
  organization_id,
  status,
  effective_from DESC,
  confirmed_at,
  version_no DESC
);

CREATE TRIGGER trg_seller_agreement_rate_initial_state_guard
BEFORE INSERT ON seller_agreement_rate_versions
WHEN NEW.status<>'SUBMITTED'
BEGIN
  SELECT RAISE(ABORT, 'pricing_initial_state_must_be_submitted');
END;

CREATE TRIGGER trg_seller_agreement_rate_pending_conflict
BEFORE INSERT ON seller_agreement_rate_versions
WHEN NEW.status='SUBMITTED' AND EXISTS (
  SELECT 1
  FROM seller_agreement_rate_versions
  WHERE organization_id=NEW.organization_id
    AND status='SUBMITTED'
)
BEGIN
  SELECT RAISE(ABORT, 'pricing_pending_conflict');
END;

CREATE TRIGGER trg_seller_agreement_rate_effective_conflict
BEFORE UPDATE OF status ON seller_agreement_rate_versions
WHEN NEW.status='CONFIRMED' AND EXISTS (
  SELECT 1
  FROM seller_agreement_rate_versions existing
  WHERE existing.organization_id=NEW.organization_id
    AND existing.effective_from=NEW.effective_from
    AND existing.status='CONFIRMED'
    AND existing.id<>NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'pricing_effective_conflict');
END;

CREATE TRIGGER trg_seller_agreement_rate_decision_only
BEFORE UPDATE ON seller_agreement_rate_versions
WHEN NOT (
  OLD.status='SUBMITTED'
  AND NEW.status IN ('CONFIRMED', 'REJECTED')
  AND NEW.id=OLD.id
  AND NEW.organization_id=OLD.organization_id
  AND NEW.review_type IS OLD.review_type
  AND NEW.version_no=OLD.version_no
  AND NEW.cny_per_jpy_e8=OLD.cny_per_jpy_e8
  AND NEW.effective_from=OLD.effective_from
  AND NEW.submitted_by_staff_id=OLD.submitted_by_staff_id
  AND NEW.submitted_at=OLD.submitted_at
  AND NEW.decision_version=OLD.decision_version+1
)
BEGIN
  SELECT RAISE(ABORT, 'seller_agreement_rate_version_is_immutable');
END;

CREATE TRIGGER trg_seller_agreement_rate_no_delete
BEFORE DELETE ON seller_agreement_rate_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_agreement_rate_version_is_immutable');
END;

CREATE TABLE seller_agreement_rate_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  version_id TEXT NOT NULL
    REFERENCES seller_agreement_rate_versions(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  business_date TEXT,
  review_type TEXT,
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'SELLER_AGREEMENT_RATE_SUBMITTED',
      'SELLER_AGREEMENT_RATE_CONFIRMED',
      'SELLER_AGREEMENT_RATE_REJECTED'
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
    AND review_type IS NULL
    AND fee_cny_fen IS NULL
  ),
  CHECK (
    (event_type='SELLER_AGREEMENT_RATE_SUBMITTED'
      AND previous_status IS NULL
      AND next_status='SUBMITTED'
      AND reason IS NULL)
    OR
    (event_type='SELLER_AGREEMENT_RATE_CONFIRMED'
      AND previous_status='SUBMITTED'
      AND next_status='CONFIRMED'
      AND reason IS NULL)
    OR
    (event_type='SELLER_AGREEMENT_RATE_REJECTED'
      AND previous_status='SUBMITTED'
      AND next_status='REJECTED'
      AND reason IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_seller_agreement_rate_events_version
ON seller_agreement_rate_events (
  version_id,
  created_at,
  id
);

CREATE TRIGGER trg_seller_agreement_rate_events_no_update
BEFORE UPDATE ON seller_agreement_rate_events
BEGIN
  SELECT RAISE(ABORT, 'seller_agreement_rate_events_are_immutable');
END;

CREATE TRIGGER trg_seller_agreement_rate_events_no_delete
BEFORE DELETE ON seller_agreement_rate_events
BEGIN
  SELECT RAISE(ABORT, 'seller_agreement_rate_events_are_immutable');
END;

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

CREATE UNIQUE INDEX uq_seller_service_fee_pending
ON seller_service_fee_versions (
  organization_id,
  review_type
)
WHERE status='SUBMITTED';

CREATE UNIQUE INDEX uq_seller_service_fee_effective
ON seller_service_fee_versions (
  organization_id,
  review_type,
  effective_from
)
WHERE status='CONFIRMED';

CREATE INDEX idx_seller_service_fee_resolution
ON seller_service_fee_versions (
  organization_id,
  review_type,
  status,
  effective_from DESC,
  confirmed_at,
  version_no DESC
);

CREATE TRIGGER trg_seller_service_fee_initial_state_guard
BEFORE INSERT ON seller_service_fee_versions
WHEN NEW.status<>'SUBMITTED'
BEGIN
  SELECT RAISE(ABORT, 'pricing_initial_state_must_be_submitted');
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

CREATE TRIGGER trg_seller_service_fee_no_delete
BEFORE DELETE ON seller_service_fee_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_version_is_immutable');
END;

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

CREATE INDEX idx_seller_service_fee_events_version
ON seller_service_fee_events (
  version_id,
  created_at,
  id
);

CREATE TRIGGER trg_seller_service_fee_events_no_update
BEFORE UPDATE ON seller_service_fee_events
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_events_are_immutable');
END;

CREATE TRIGGER trg_seller_service_fee_events_no_delete
BEFORE DELETE ON seller_service_fee_events
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=11,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=10;
