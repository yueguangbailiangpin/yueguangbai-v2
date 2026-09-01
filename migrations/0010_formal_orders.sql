-- Baseline 0010 formal_orders (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=9 THEN 1 ELSE 0 END;

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
, order_instruction_id TEXT REFERENCES order_instructions(id), order_instruction_version_id TEXT REFERENCES order_instruction_versions(id), amazon_order_date TEXT
  CHECK (
    amazon_order_date IS NULL
    OR (
      length(amazon_order_date)=10
      AND amazon_order_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(amazon_order_date) IS NOT NULL
      AND date(amazon_order_date)=amazon_order_date
    )
  ), canonical_marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (canonical_marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','TIKTOK_JP'
  )), marketplace_business_date TEXT CHECK (
  marketplace_business_date IS NULL OR (
    marketplace_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(marketplace_business_date)=marketplace_business_date
  )
)) STRICT;

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
, buyer_self_pay_bps INTEGER
  CHECK (buyer_self_pay_bps IS NULL OR buyer_self_pay_bps BETWEEN 0 AND 10000), buyer_self_pay_jpy INTEGER
  CHECK (
    buyer_self_pay_jpy IS NULL
    OR buyer_self_pay_jpy BETWEEN 0 AND 9007199254740991
  ), buyer_refundable_principal_jpy INTEGER
  CHECK (
    buyer_refundable_principal_jpy IS NULL
    OR buyer_refundable_principal_jpy BETWEEN 0 AND 9007199254740991
  ), buyer_gross_principal_cny_fen INTEGER
  CHECK (
    buyer_gross_principal_cny_fen IS NULL
    OR buyer_gross_principal_cny_fen BETWEEN 0 AND 9007199254740991
  ), buyer_self_pay_contribution_cny_fen INTEGER
  CHECK (
    buyer_self_pay_contribution_cny_fen IS NULL
    OR buyer_self_pay_contribution_cny_fen BETWEEN 0 AND 9007199254740991
  )) STRICT;

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

CREATE TABLE formal_order_marketplace_money_snapshots (
  formal_order_id TEXT PRIMARY KEY CHECK (length(formal_order_id) BETWEEN 1 AND 120),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL REFERENCES seller_stores(id),
  marketplace_code TEXT NOT NULL,
  review_type TEXT NOT NULL CHECK (
    review_type IN ('RATING','TEXT','IMAGE','VIDEO')
  ),
  platform_order_identifier TEXT NOT NULL CHECK (
    length(platform_order_identifier) BETWEEN 1 AND 200
  ),
  platform_product_identifier TEXT NOT NULL CHECK (
    length(platform_product_identifier) BETWEEN 1 AND 200
  ),
  platform_order_date TEXT CHECK (
    platform_order_date IS NULL OR (
      platform_order_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(platform_order_date)=platform_order_date
    )
  ),
  payment_amount_minor INTEGER NOT NULL CHECK (
    payment_amount_minor BETWEEN 0 AND 9007199254740991
  ),
  payment_currency_code TEXT NOT NULL REFERENCES currencies(code),
  payment_currency_exponent INTEGER NOT NULL CHECK (
    payment_currency_exponent BETWEEN 0 AND 9
  ),
  buyer_rate_version_id TEXT NOT NULL REFERENCES buyer_daily_currency_rate_versions(id),
  buyer_rate_version_no INTEGER NOT NULL CHECK (buyer_rate_version_no >= 1),
  buyer_rate_confirmed_at INTEGER NOT NULL CHECK (buyer_rate_confirmed_at >= 0),
  buyer_rate_value INTEGER NOT NULL CHECK (buyer_rate_value > 0),
  buyer_rate_scale INTEGER NOT NULL CHECK (buyer_rate_scale > 0),
  source_currency_code TEXT NOT NULL REFERENCES currencies(code),
  quote_currency_code TEXT NOT NULL REFERENCES currencies(code)
    CHECK (quote_currency_code='CNY'),
  source_currency_exponent INTEGER NOT NULL CHECK (
    source_currency_exponent BETWEEN 0 AND 9
  ),
  quote_currency_exponent INTEGER NOT NULL CHECK (quote_currency_exponent=2),
  rounding_rule TEXT NOT NULL CHECK (rounding_rule='HALF_UP'),
  service_fee_rule_version_id TEXT NOT NULL REFERENCES seller_service_fee_rule_versions(id),
  service_fee_rule_version_no INTEGER NOT NULL CHECK (service_fee_rule_version_no >= 1),
  service_fee_effective_from INTEGER NOT NULL CHECK (service_fee_effective_from >= 0),
  service_fee_confirmed_at INTEGER NOT NULL CHECK (service_fee_confirmed_at >= 0),
  service_fee_amount_minor INTEGER NOT NULL CHECK (service_fee_amount_minor >= 0),
  service_fee_currency_code TEXT NOT NULL CHECK (service_fee_currency_code='CNY'),
  buyer_expected_principal_amount_minor INTEGER NOT NULL CHECK (
    buyer_expected_principal_amount_minor >= 0
  ),
  seller_expected_principal_amount_minor INTEGER NOT NULL CHECK (
    seller_expected_principal_amount_minor >= 0
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (payment_currency_code=source_currency_code),
  CHECK (payment_currency_exponent=source_currency_exponent)
) STRICT;

CREATE TABLE formal_order_number_claims (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplaces(code),
  amazon_order_number_normalized TEXT NOT NULL CHECK (
    length(amazon_order_number_normalized)=19
  ),
  evidence_submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  current_evidence_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  formal_order_id TEXT UNIQUE
    REFERENCES formal_orders(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL CHECK (status IN ('PROVISIONAL','FINAL','RELEASED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  claimed_at INTEGER NOT NULL CHECK (claimed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= claimed_at),
  finalized_at INTEGER CHECK (finalized_at IS NULL OR finalized_at >= claimed_at),
  released_at INTEGER CHECK (released_at IS NULL OR released_at >= claimed_at),
  CHECK (
    (status='PROVISIONAL' AND formal_order_id IS NULL
      AND finalized_at IS NULL AND released_at IS NULL)
    OR (status='FINAL' AND formal_order_id IS NOT NULL
      AND finalized_at IS NOT NULL AND released_at IS NULL)
    OR (status='RELEASED' AND formal_order_id IS NULL
      AND finalized_at IS NULL AND released_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE formal_order_number_conflicts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplaces(code),
  amazon_order_number_normalized TEXT NOT NULL CHECK (
    length(amazon_order_number_normalized)=19
  ),
  formal_order_ids_json TEXT NOT NULL CHECK (
    json_valid(formal_order_ids_json)
    AND json_type(formal_order_ids_json)='array'
    AND json_array_length(formal_order_ids_json)>=2
  ),
  detected_at INTEGER NOT NULL CHECK (detected_at >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution_note TEXT CHECK (
    resolution_note IS NULL OR length(resolution_note) BETWEEN 1 AND 4000
  ),
  UNIQUE (marketplace_code, amazon_order_number_normalized),
  CHECK (
    (status='OPEN' AND resolution_note IS NULL)
    OR (status='RESOLVED' AND resolution_note IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_formal_order_events_order
ON formal_order_events (
  formal_order_id,
  created_at,
  id
);

CREATE INDEX idx_formal_order_financial_adjustments_order
ON formal_order_financial_adjustments(formal_order_id,adjustment_scope,created_at,id);

CREATE INDEX idx_formal_order_marketplace_money_buyer
ON formal_order_marketplace_money_snapshots (
  buyer_customer_id, created_at, formal_order_id
);

CREATE INDEX idx_formal_order_marketplace_money_seller
ON formal_order_marketplace_money_snapshots (
  seller_organization_id, store_id, created_at, formal_order_id
);

CREATE INDEX idx_formal_order_number_claims_status
ON formal_order_number_claims (status, updated_at, id);

CREATE INDEX idx_formal_order_operational_events_order
ON formal_order_operational_events(formal_order_id,created_at DESC,id DESC);

CREATE INDEX idx_formal_orders_amazon_order_signal
ON formal_orders (
  marketplace_code,
  amazon_order_number_normalized,
  confirmed_at,
  id
);

CREATE INDEX idx_formal_orders_buyer_confirmed
ON formal_orders (
  buyer_customer_id,
  confirmed_at,
  id
);

CREATE INDEX idx_formal_orders_canonical_market_date
ON formal_orders(canonical_marketplace_code,confirmed_business_date,id);

CREATE INDEX idx_formal_orders_confirmed_business_date
ON formal_orders (confirmed_business_date, id);

CREATE INDEX idx_formal_orders_instruction
ON formal_orders (order_instruction_id, order_instruction_version_id, id);

CREATE INDEX idx_formal_orders_marketplace_business_date
ON formal_orders(canonical_marketplace_code,marketplace_business_date,id);

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

CREATE UNIQUE INDEX uq_formal_order_number_claims_active
ON formal_order_number_claims (
  marketplace_code, amazon_order_number_normalized
)
WHERE status IN ('PROVISIONAL','FINAL');

CREATE UNIQUE INDEX uq_formal_order_number_claims_submission_active
ON formal_order_number_claims (evidence_submission_id)
WHERE status IN ('PROVISIONAL','FINAL');

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

CREATE TRIGGER trg_formal_order_events_no_delete
BEFORE DELETE ON formal_order_events
BEGIN
  SELECT RAISE(ABORT, 'formal_order_events_are_immutable');
END;

CREATE TRIGGER trg_formal_order_events_no_update
BEFORE UPDATE ON formal_order_events
BEGIN
  SELECT RAISE(ABORT, 'formal_order_events_are_immutable');
END;

CREATE TRIGGER trg_formal_order_financial_adjustment_event_guard
BEFORE INSERT ON formal_order_financial_adjustments
WHEN NEW.source_operational_event_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM formal_order_operational_events event
  WHERE event.id=NEW.source_operational_event_id
    AND event.formal_order_id=NEW.formal_order_id
)
BEGIN
  SELECT RAISE(ABORT,'formal_order_financial_adjustment_event_mismatch');
END;

CREATE TRIGGER trg_formal_order_financial_adjustment_profit_only
BEFORE INSERT ON formal_order_financial_adjustments
WHEN NEW.adjustment_scope NOT IN ('PROJECTED_GROSS_PROFIT','COMPLETED_GROSS_PROFIT')
BEGIN
  SELECT RAISE(ABORT,'formal_order_financial_adjustment_scope_requires_ledger_flow');
END;

CREATE TRIGGER trg_formal_order_financial_adjustments_no_delete
BEFORE DELETE ON formal_order_financial_adjustments
BEGIN SELECT RAISE(ABORT,'formal_order_financial_adjustments_are_immutable'); END;

CREATE TRIGGER trg_formal_order_financial_adjustments_no_update
BEFORE UPDATE ON formal_order_financial_adjustments
BEGIN SELECT RAISE(ABORT,'formal_order_financial_adjustments_are_immutable'); END;

CREATE TRIGGER trg_formal_order_financial_snapshot_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND NEW.buyer_rate_business_date<=formal_order.amazon_order_date
      AND formal_order.confirmed_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_daily_exchange_rates rate
    WHERE rate.id=NEW.buyer_rate_version_id
      AND rate.business_date=NEW.buyer_rate_business_date
      AND rate.version_no=NEW.buyer_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.cny_per_jpy_e8=NEW.buyer_cny_per_jpy_e8
      AND rate.confirmed_at=NEW.buyer_rate_confirmed_at
      AND rate.confirmed_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
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

CREATE TRIGGER trg_formal_order_financial_snapshots_no_delete
BEFORE DELETE ON formal_order_financial_snapshots
BEGIN
  SELECT RAISE(ABORT, 'formal_order_financial_snapshots_are_immutable');
END;

CREATE TRIGGER trg_formal_order_financial_snapshots_no_update
BEFORE UPDATE ON formal_order_financial_snapshots
BEGIN
  SELECT RAISE(ABORT, 'formal_order_financial_snapshots_are_immutable');
END;

CREATE TRIGGER trg_formal_order_marketplace_money_no_delete
BEFORE DELETE ON formal_order_marketplace_money_snapshots
BEGIN
  SELECT RAISE(ABORT, 'formal_order_marketplace_money_is_immutable');
END;

CREATE TRIGGER trg_formal_order_marketplace_money_no_update
BEFORE UPDATE ON formal_order_marketplace_money_snapshots
BEGIN
  SELECT RAISE(ABORT, 'formal_order_marketplace_money_is_immutable');
END;

CREATE TRIGGER trg_formal_order_marketplace_money_source_guard
BEFORE INSERT ON formal_order_marketplace_money_snapshots
WHEN
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.buyer_customer_id=NEW.buyer_customer_id
      AND formal_order.seller_organization_id=NEW.seller_organization_id
      AND formal_order.store_id=NEW.store_id
      AND formal_order.review_type=NEW.review_type
      AND formal_order.amazon_order_number_normalized=NEW.platform_order_identifier
      AND formal_order.asin_normalized=NEW.platform_product_identifier
      AND formal_order.amazon_order_date=NEW.platform_order_date
      AND formal_order.final_paid_jpy=NEW.payment_amount_minor
      AND formal_order.confirmed_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_marketplace_assignments buyer
    WHERE buyer.buyer_customer_id=NEW.buyer_customer_id
      AND buyer.marketplace_code=NEW.marketplace_code
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_store_marketplaces store
    WHERE store.store_id=NEW.store_id
      AND store.seller_organization_id=NEW.seller_organization_id
      AND store.marketplace_code=NEW.marketplace_code
  )
  OR NOT EXISTS (
    SELECT 1 FROM marketplace_registry marketplace
    JOIN currencies currency ON currency.code=marketplace.transaction_currency_code
    WHERE marketplace.code=NEW.marketplace_code
      AND marketplace.status='ACTIVE'
      AND marketplace.adapter_status='AVAILABLE'
      AND marketplace.transaction_currency_code=NEW.payment_currency_code
      AND currency.exponent=NEW.payment_currency_exponent
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_daily_currency_rate_versions rate
    WHERE rate.id=NEW.buyer_rate_version_id
      AND rate.business_date<=NEW.platform_order_date
      AND rate.version_no=NEW.buyer_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.source_currency_code=NEW.source_currency_code
      AND rate.quote_currency_code=NEW.quote_currency_code
      AND rate.rate_value=NEW.buyer_rate_value
      AND rate.rate_scale=NEW.buyer_rate_scale
      AND rate.rounding_rule=NEW.rounding_rule
      AND rate.confirmed_at=NEW.buyer_rate_confirmed_at
      AND rate.confirmed_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_principal_rate_snapshots principal
    WHERE principal.formal_order_id=NEW.formal_order_id
      AND principal.platform_order_date=NEW.platform_order_date
      AND principal.payment_amount_minor=NEW.payment_amount_minor
      AND principal.payment_currency_code=NEW.payment_currency_code
      AND principal.rounding_rule=NEW.rounding_rule
      AND principal.seller_expected_principal_amount_minor=NEW.seller_expected_principal_amount_minor
      AND principal.created_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_service_fee_rule_versions fee
    WHERE fee.id=NEW.service_fee_rule_version_id
      AND fee.seller_organization_id=NEW.seller_organization_id
      AND fee.marketplace_code=NEW.marketplace_code
      AND fee.review_type=NEW.review_type
      AND fee.version_no=NEW.service_fee_rule_version_no
      AND fee.status='CONFIRMED'
      AND fee.fee_amount_minor=NEW.service_fee_amount_minor
      AND fee.fee_currency_code=NEW.service_fee_currency_code
      AND fee.effective_from=NEW.service_fee_effective_from
      AND fee.confirmed_at=NEW.service_fee_confirmed_at
      AND fee.effective_from<=NEW.created_at
      AND fee.confirmed_at<=NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_marketplace_money_source_mismatch');
END;

CREATE TRIGGER trg_formal_order_non_jp_local_date_required
BEFORE INSERT ON formal_orders
WHEN COALESCE(NEW.canonical_marketplace_code,'AMAZON_JP')<>'AMAZON_JP'
  AND NEW.marketplace_business_date IS NULL
BEGIN
  SELECT RAISE(ABORT,'formal_order_marketplace_business_date_required');
END;

CREATE TRIGGER trg_formal_order_number_claim_source_guard
BEFORE INSERT ON formal_order_number_claims
WHEN NOT EXISTS (
  SELECT 1 FROM order_evidence_versions evidence
  WHERE evidence.id=NEW.current_evidence_version_id
    AND evidence.submission_id=NEW.evidence_submission_id
    AND evidence.marketplace_code=NEW.marketplace_code
    AND evidence.amazon_order_number_normalized=
      NEW.amazon_order_number_normalized
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claim_source_mismatch');
END;

CREATE TRIGGER trg_formal_order_number_claim_transition_guard
BEFORE UPDATE ON formal_order_number_claims
WHEN NOT (
  NEW.id=OLD.id
  AND NEW.marketplace_code=OLD.marketplace_code
  AND NEW.amazon_order_number_normalized=OLD.amazon_order_number_normalized
  AND NEW.evidence_submission_id=OLD.evidence_submission_id
  AND NEW.claimed_at=OLD.claimed_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND OLD.status='PROVISIONAL'
  AND (
    (NEW.status='PROVISIONAL'
      AND NEW.formal_order_id IS NULL
      AND NEW.finalized_at IS NULL AND NEW.released_at IS NULL)
    OR (NEW.status='FINAL'
      AND NEW.formal_order_id IS NOT NULL
      AND NEW.finalized_at IS NOT NULL AND NEW.released_at IS NULL)
    OR (NEW.status='RELEASED'
      AND NEW.formal_order_id IS NULL
      AND NEW.finalized_at IS NULL AND NEW.released_at IS NOT NULL)
  )
  AND EXISTS (
    SELECT 1 FROM order_evidence_versions evidence
    WHERE evidence.id=NEW.current_evidence_version_id
      AND evidence.submission_id=NEW.evidence_submission_id
      AND evidence.marketplace_code=NEW.marketplace_code
      AND evidence.amazon_order_number_normalized=
        NEW.amazon_order_number_normalized
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claim_invalid_transition');
END;

CREATE TRIGGER trg_formal_order_number_claims_no_delete
BEFORE DELETE ON formal_order_number_claims
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claims_are_immutable');
END;

CREATE TRIGGER trg_formal_order_number_conflicts_no_delete
BEFORE DELETE ON formal_order_number_conflicts
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_conflicts_are_immutable');
END;

CREATE TRIGGER trg_formal_order_operational_events_no_delete
BEFORE DELETE ON formal_order_operational_events
BEGIN SELECT RAISE(ABORT,'formal_order_operational_events_are_immutable'); END;

CREATE TRIGGER trg_formal_order_operational_events_no_update
BEFORE UPDATE ON formal_order_operational_events
BEGIN SELECT RAISE(ABORT,'formal_order_operational_events_are_immutable'); END;

CREATE TRIGGER trg_formal_order_source_guard
BEFORE INSERT ON formal_orders
WHEN
  NEW.amazon_order_date IS NULL
  OR NOT EXISTS (
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
      AND evidence.amazon_order_date=NEW.amazon_order_date
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

CREATE TRIGGER trg_formal_orders_no_delete
BEFORE DELETE ON formal_orders
BEGIN
  SELECT RAISE(ABORT, 'formal_orders_are_immutable');
END;

CREATE TRIGGER trg_formal_orders_no_update
BEFORE UPDATE ON formal_orders
BEGIN
  SELECT RAISE(ABORT, 'formal_orders_are_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_snapshot_confirmation_guard
BEFORE INSERT ON seller_principal_rate_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM formal_orders formal_order
  JOIN formal_order_financial_snapshots financial_snapshot
    ON financial_snapshot.formal_order_id=formal_order.id
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.confirmed_at=NEW.created_at
    AND financial_snapshot.seller_expected_principal_cny_fen=
      NEW.seller_expected_principal_amount_minor
)
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshot_source_mismatch');
END;

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
OR NEW.base_rate_business_date>NEW.platform_order_date
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

UPDATE app_schema_state
SET
  schema_version=10,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
