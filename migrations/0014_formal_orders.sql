PRAGMA foreign_keys = ON;

-- Formal migration 0014: only advances schema_version from 13 to 14.
-- Any other preceding schema version must fail before any DDL is applied.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM app_schema_state
  WHERE singleton_id=1
    AND schema_version=13
) THEN 1 ELSE 0 END;

CREATE TABLE formal_orders (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  order_evidence_submission_id TEXT NOT NULL UNIQUE
    REFERENCES order_evidence_submissions(id),
  order_evidence_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  reservation_id TEXT NOT NULL UNIQUE
    REFERENCES product_reservations(id),
  demand_batch_id TEXT NOT NULL
    REFERENCES demand_batches(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  buyer_customer_no TEXT NOT NULL
    CHECK (length(buyer_customer_no) BETWEEN 3 AND 120),
  seller_organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL
    REFERENCES seller_stores(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code)
    CHECK (marketplace_code='JP'),
  product_id TEXT NOT NULL
    REFERENCES products(id),
  product_version_id TEXT NOT NULL
    REFERENCES product_versions(id),
  product_version_no INTEGER NOT NULL
    CHECK (product_version_no >= 1),
  asin_display TEXT NOT NULL
    CHECK (length(asin_display)=10),
  asin_normalized TEXT NOT NULL
    CHECK (
      length(asin_normalized)=10
      AND asin_normalized NOT GLOB '*[^A-Z0-9]*'
    ),
  product_name_snapshot TEXT NOT NULL
    CHECK (length(product_name_snapshot) BETWEEN 1 AND 200),
  review_type TEXT NOT NULL
    CHECK (review_type IN ('RATING', 'TEXT', 'IMAGE', 'VIDEO')),
  amazon_order_number_raw TEXT NOT NULL
    CHECK (length(amazon_order_number_raw) BETWEEN 1 AND 100),
  amazon_order_number_normalized TEXT NOT NULL
    CHECK (
      length(amazon_order_number_normalized)=19
      AND substr(amazon_order_number_normalized, 4, 1)='-'
      AND substr(amazon_order_number_normalized, 12, 1)='-'
      AND length(replace(amazon_order_number_normalized, '-', ''))=17
      AND replace(amazon_order_number_normalized, '-', '')
        NOT GLOB '*[^0-9]*'
    ),
  final_paid_jpy INTEGER NOT NULL
    CHECK (final_paid_jpy BETWEEN 0 AND 9007199254740991),
  status TEXT NOT NULL
    CHECK (status='CONFIRMED'),
  version INTEGER NOT NULL
    CHECK (version=1),
  confirmed_by_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  confirmed_at INTEGER NOT NULL
    CHECK (confirmed_at >= 0),
  confirmed_business_date TEXT NOT NULL
    CHECK (
      confirmed_business_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(confirmed_business_date)=confirmed_business_date
    ),
  created_at INTEGER NOT NULL
    CHECK (created_at=confirmed_at)
) STRICT;

CREATE INDEX idx_formal_orders_buyer_confirmed
ON formal_orders (
  buyer_customer_id,
  confirmed_at,
  id
);

CREATE INDEX idx_formal_orders_seller_confirmed
ON formal_orders (
  seller_organization_id,
  confirmed_at,
  id
);

CREATE INDEX idx_formal_orders_store_confirmed
ON formal_orders (
  store_id,
  confirmed_at,
  id
);

-- Amazon order numbers deliberately remain non-unique. Phase 3D duplicate
-- signals are preserved as review evidence; Phase 3F never merges orders.
CREATE INDEX idx_formal_orders_amazon_order_signal
ON formal_orders (
  marketplace_code,
  amazon_order_number_normalized,
  confirmed_at,
  id
);

CREATE TRIGGER trg_formal_order_source_guard
BEFORE INSERT ON formal_orders
WHEN
  NOT EXISTS (
    SELECT 1
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.id=NEW.order_evidence_version_id
      AND evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    WHERE submission.id=NEW.order_evidence_submission_id
      AND submission.reservation_id=NEW.reservation_id
      AND submission.buyer_customer_id=NEW.buyer_customer_id
      AND submission.marketplace_code=NEW.marketplace_code
      AND submission.status='VERIFIED'
      AND evidence.reservation_id=NEW.reservation_id
      AND evidence.buyer_customer_id=NEW.buyer_customer_id
      AND evidence.marketplace_code=NEW.marketplace_code
      AND evidence.amazon_order_number_raw=NEW.amazon_order_number_raw
      AND evidence.amazon_order_number_normalized=
        NEW.amazon_order_number_normalized
      AND evidence.final_paid_jpy=NEW.final_paid_jpy
  )
  OR NOT EXISTS (
    SELECT 1
    FROM product_reservations reservation
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    WHERE reservation.id=NEW.reservation_id
      AND reservation.status='APPROVED'
      AND reservation.demand_batch_id=NEW.demand_batch_id
      AND reservation.buyer_customer_id=NEW.buyer_customer_id
      AND reservation.organization_id=NEW.seller_organization_id
      AND reservation.store_id=NEW.store_id
      AND reservation.product_id=NEW.product_id
      AND reservation.product_version_no=NEW.product_version_no
      AND reservation.marketplace_code=NEW.marketplace_code
      AND demand.organization_id=NEW.seller_organization_id
      AND demand.store_id=NEW.store_id
      AND demand.product_id=NEW.product_id
      AND demand.product_version_no=NEW.product_version_no
      AND demand.marketplace_code=NEW.marketplace_code
      AND demand.task_type=NEW.review_type
  )
  OR NOT EXISTS (
    SELECT 1
    FROM products product
    JOIN product_versions product_version
      ON product_version.id=NEW.product_version_id
      AND product_version.product_id=product.id
      AND product_version.version_no=NEW.product_version_no
    WHERE product.id=NEW.product_id
      AND product.organization_id=NEW.seller_organization_id
      AND product.store_id=NEW.store_id
      AND product.marketplace_code=NEW.marketplace_code
      AND product.asin_display=NEW.asin_display
      AND product.asin_normalized=NEW.asin_normalized
      AND product_version.product_name=NEW.product_name_snapshot
  )
  OR NOT EXISTS (
    SELECT 1
    FROM buyer_customers buyer
    WHERE buyer.id=NEW.buyer_customer_id
      AND buyer.marketplace_code=NEW.marketplace_code
      AND buyer.buyer_customer_no=NEW.buyer_customer_no
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_source_mismatch');
END;

CREATE TRIGGER trg_formal_orders_no_update
BEFORE UPDATE ON formal_orders
BEGIN
  SELECT RAISE(ABORT, 'formal_orders_are_immutable');
END;

CREATE TRIGGER trg_formal_orders_no_delete
BEFORE DELETE ON formal_orders
BEGIN
  SELECT RAISE(ABORT, 'formal_orders_are_immutable');
END;

CREATE TABLE formal_order_financial_snapshots (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  formal_order_id TEXT NOT NULL UNIQUE
    REFERENCES formal_orders(id),
  snapshot_version INTEGER NOT NULL
    CHECK (snapshot_version=1),
  buyer_rate_version_id TEXT NOT NULL
    REFERENCES buyer_daily_exchange_rates(id),
  buyer_rate_version_no INTEGER NOT NULL
    CHECK (buyer_rate_version_no >= 1),
  buyer_rate_business_date TEXT NOT NULL,
  buyer_rate_confirmed_at INTEGER NOT NULL
    CHECK (buyer_rate_confirmed_at >= 0),
  buyer_cny_per_jpy_e8 INTEGER NOT NULL
    CHECK (buyer_cny_per_jpy_e8 BETWEEN 1 AND 9007199254740991),
  seller_rate_version_id TEXT NOT NULL
    REFERENCES seller_agreement_rate_versions(id),
  seller_rate_version_no INTEGER NOT NULL
    CHECK (seller_rate_version_no >= 1),
  seller_rate_effective_from INTEGER NOT NULL
    CHECK (seller_rate_effective_from >= 0),
  seller_rate_confirmed_at INTEGER NOT NULL
    CHECK (seller_rate_confirmed_at >= 0),
  seller_cny_per_jpy_e8 INTEGER NOT NULL
    CHECK (seller_cny_per_jpy_e8 BETWEEN 1 AND 9007199254740991),
  service_fee_version_id TEXT NOT NULL
    REFERENCES seller_service_fee_versions(id),
  service_fee_version_no INTEGER NOT NULL
    CHECK (service_fee_version_no >= 1),
  service_fee_effective_from INTEGER NOT NULL
    CHECK (service_fee_effective_from >= 0),
  service_fee_confirmed_at INTEGER NOT NULL
    CHECK (service_fee_confirmed_at >= 0),
  service_fee_cny_fen INTEGER NOT NULL
    CHECK (service_fee_cny_fen BETWEEN 0 AND 9007199254740991),
  buyer_expected_principal_cny_fen INTEGER NOT NULL
    CHECK (
      buyer_expected_principal_cny_fen
        BETWEEN 0 AND 9007199254740991
    ),
  seller_expected_principal_cny_fen INTEGER NOT NULL
    CHECK (
      seller_expected_principal_cny_fen
        BETWEEN 0 AND 9007199254740991
    ),
  rounding_rule TEXT NOT NULL
    CHECK (rounding_rule='HALF_UP'),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE TRIGGER trg_formal_order_financial_snapshot_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN
  NOT EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.confirmed_business_date=
        NEW.buyer_rate_business_date
      AND formal_order.confirmed_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1
    FROM buyer_daily_exchange_rates rate
    WHERE rate.id=NEW.buyer_rate_version_id
      AND rate.business_date=NEW.buyer_rate_business_date
      AND rate.version_no=NEW.buyer_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.cny_per_jpy_e8=NEW.buyer_cny_per_jpy_e8
      AND rate.confirmed_at=NEW.buyer_rate_confirmed_at
      AND rate.confirmed_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    JOIN seller_agreement_rate_versions rate
      ON rate.organization_id=formal_order.seller_organization_id
    WHERE formal_order.id=NEW.formal_order_id
      AND rate.id=NEW.seller_rate_version_id
      AND rate.version_no=NEW.seller_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.cny_per_jpy_e8=NEW.seller_cny_per_jpy_e8
      AND rate.effective_from=NEW.seller_rate_effective_from
      AND rate.confirmed_at=NEW.seller_rate_confirmed_at
      AND rate.effective_from<=NEW.created_at
      AND rate.confirmed_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    JOIN seller_service_fee_versions fee
      ON fee.organization_id=formal_order.seller_organization_id
      AND fee.review_type=formal_order.review_type
    WHERE formal_order.id=NEW.formal_order_id
      AND fee.id=NEW.service_fee_version_id
      AND fee.version_no=NEW.service_fee_version_no
      AND fee.status='CONFIRMED'
      AND fee.fee_cny_fen=NEW.service_fee_cny_fen
      AND fee.effective_from=NEW.service_fee_effective_from
      AND fee.confirmed_at=NEW.service_fee_confirmed_at
      AND fee.effective_from<=NEW.created_at
      AND fee.confirmed_at<=NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_financial_snapshot_source_mismatch');
END;

CREATE TRIGGER trg_formal_order_financial_snapshots_no_update
BEFORE UPDATE ON formal_order_financial_snapshots
BEGIN
  SELECT RAISE(ABORT, 'formal_order_financial_snapshots_are_immutable');
END;

CREATE TRIGGER trg_formal_order_financial_snapshots_no_delete
BEFORE DELETE ON formal_order_financial_snapshots
BEGIN
  SELECT RAISE(ABORT, 'formal_order_financial_snapshots_are_immutable');
END;

CREATE TABLE formal_order_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  formal_order_id TEXT NOT NULL
    REFERENCES formal_orders(id),
  order_evidence_submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL
    REFERENCES product_reservations(id),
  event_type TEXT NOT NULL
    CHECK (event_type='FORMAL_ORDER_CONFIRMED'),
  actor_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  previous_status TEXT,
  next_status TEXT NOT NULL
    CHECK (next_status='CONFIRMED'),
  order_version INTEGER NOT NULL
    CHECK (order_version=1),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_formal_order_events_order
ON formal_order_events (
  formal_order_id,
  created_at,
  id
);

CREATE TRIGGER trg_formal_order_event_identity_guard
BEFORE INSERT ON formal_order_events
WHEN NOT EXISTS (
  SELECT 1
  FROM formal_orders formal_order
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.order_evidence_submission_id=
      NEW.order_evidence_submission_id
    AND formal_order.reservation_id=NEW.reservation_id
    AND NEW.previous_status IS NULL
    AND NEW.next_status=formal_order.status
    AND NEW.order_version=formal_order.version
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_event_identity_mismatch');
END;

CREATE TRIGGER trg_formal_order_events_no_update
BEFORE UPDATE ON formal_order_events
BEGIN
  SELECT RAISE(ABORT, 'formal_order_events_are_immutable');
END;

CREATE TRIGGER trg_formal_order_events_no_delete
BEFORE DELETE ON formal_order_events
BEGIN
  SELECT RAISE(ABORT, 'formal_order_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=14,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=13;
