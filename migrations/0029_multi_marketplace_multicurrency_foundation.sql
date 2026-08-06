PRAGMA foreign_keys = ON;

-- Migration 0029 deliberately leaves the legacy marketplaces('JP') key and
-- JP/JPY columns in place. They remain a compatibility projection for the
-- existing API while these canonical tables carry all new marketplace and
-- currency facts. No historical financial row is updated or recalculated.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=28
) THEN 1 ELSE 0 END;

CREATE TABLE currencies (
  code TEXT PRIMARY KEY CHECK (
    length(code)=3 AND code NOT GLOB '*[^A-Z]*'
  ),
  exponent INTEGER NOT NULL CHECK (exponent BETWEEN 0 AND 9),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

INSERT INTO currencies (code, exponent, status, created_at, updated_at)
VALUES
  ('JPY',0,'ACTIVE',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('USD',2,'ACTIVE',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('KRW',0,'DISABLED',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('CNY',2,'ACTIVE',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000);

CREATE TABLE marketplace_registry (
  code TEXT PRIMARY KEY CHECK (
    code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR')
  ),
  platform_code TEXT NOT NULL CHECK (
    platform_code IN ('AMAZON','COUPANG')
  ),
  region_code TEXT NOT NULL CHECK (
    region_code IN ('JP','US','KR')
  ),
  transaction_currency_code TEXT NOT NULL REFERENCES currencies(code),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  adapter_status TEXT NOT NULL CHECK (
    adapter_status IN ('AVAILABLE','UNAVAILABLE')
  ),
  display_name_zh TEXT NOT NULL CHECK (
    length(display_name_zh) BETWEEN 1 AND 100
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (platform_code, region_code),
  CHECK (
    (code='AMAZON_JP' AND platform_code='AMAZON'
      AND region_code='JP' AND transaction_currency_code='JPY')
    OR (code='AMAZON_US' AND platform_code='AMAZON'
      AND region_code='US' AND transaction_currency_code='USD')
    OR (code='COUPANG_KR' AND platform_code='COUPANG'
      AND region_code='KR' AND transaction_currency_code='KRW')
  ),
  CHECK (adapter_status='AVAILABLE' OR status='DISABLED')
) STRICT;

INSERT INTO marketplace_registry (
  code, platform_code, region_code, transaction_currency_code,
  status, adapter_status, display_name_zh, created_at, updated_at
) VALUES
  ('AMAZON_JP','AMAZON','JP','JPY','ACTIVE','AVAILABLE','亚马逊日本站',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('AMAZON_US','AMAZON','US','USD','ACTIVE','AVAILABLE','亚马逊美国站',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('COUPANG_KR','COUPANG','KR','KRW','DISABLED','UNAVAILABLE','Coupang 韩国站（未开通）',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000);

CREATE TABLE marketplace_legacy_aliases (
  legacy_code TEXT PRIMARY KEY REFERENCES marketplaces(code),
  marketplace_code TEXT NOT NULL UNIQUE REFERENCES marketplace_registry(code)
) STRICT;

INSERT INTO marketplace_legacy_aliases (legacy_code, marketplace_code)
VALUES ('JP','AMAZON_JP');

CREATE TABLE buyer_marketplace_assignments (
  buyer_customer_id TEXT PRIMARY KEY REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

INSERT INTO buyer_marketplace_assignments (
  buyer_customer_id, marketplace_code, version, created_at, updated_at
)
SELECT buyer.id, alias.marketplace_code, 1, buyer.created_at, buyer.updated_at
FROM buyer_customers buyer
JOIN marketplace_legacy_aliases alias
  ON alias.legacy_code=buyer.marketplace_code;

CREATE INDEX idx_buyer_marketplace_scope
ON buyer_marketplace_assignments (marketplace_code, buyer_customer_id);

CREATE TRIGGER trg_buyer_customer_marketplace_default
AFTER INSERT ON buyer_customers
BEGIN
  INSERT INTO buyer_marketplace_assignments (
    buyer_customer_id, marketplace_code, version, created_at, updated_at
  ) VALUES (NEW.id, 'AMAZON_JP', 1, NEW.created_at, NEW.updated_at);
END;

CREATE TABLE seller_store_marketplaces (
  store_id TEXT PRIMARY KEY REFERENCES seller_stores(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (store_id, seller_organization_id),
  FOREIGN KEY (store_id, seller_organization_id)
    REFERENCES seller_stores(id, organization_id)
) STRICT;

INSERT INTO seller_store_marketplaces (
  store_id, seller_organization_id, marketplace_code, created_at
)
SELECT store.id, store.organization_id, alias.marketplace_code, store.created_at
FROM seller_stores store
JOIN marketplace_legacy_aliases alias
  ON alias.legacy_code=store.marketplace_code;

CREATE INDEX idx_store_marketplace_org
ON seller_store_marketplaces (
  seller_organization_id, marketplace_code, store_id
);

CREATE TRIGGER trg_seller_store_marketplace_default
AFTER INSERT ON seller_stores
BEGIN
  INSERT INTO seller_store_marketplaces (
    store_id, seller_organization_id, marketplace_code, created_at
  ) VALUES (NEW.id, NEW.organization_id, 'AMAZON_JP', NEW.created_at);
END;

CREATE TABLE buyer_marketplace_correction_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  previous_marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  next_marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  previous_version INTEGER NOT NULL CHECK (previous_version >= 1),
  next_version INTEGER NOT NULL CHECK (next_version=previous_version+1),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (previous_marketplace_code<>next_marketplace_code)
) STRICT;

CREATE INDEX idx_buyer_marketplace_correction_events
ON buyer_marketplace_correction_events (
  buyer_customer_id, created_at, id
);

CREATE TRIGGER trg_buyer_marketplace_correction_events_no_update
BEFORE UPDATE ON buyer_marketplace_correction_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_marketplace_correction_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_marketplace_correction_events_no_delete
BEFORE DELETE ON buyer_marketplace_correction_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_marketplace_correction_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_marketplace_assignment_fact_guard
BEFORE UPDATE OF marketplace_code ON buyer_marketplace_assignments
WHEN NEW.marketplace_code<>OLD.marketplace_code AND (
  EXISTS (SELECT 1 FROM product_reservations WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM order_evidence_submissions WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM formal_orders WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM review_cases WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (
    SELECT 1 FROM formal_order_marketplace_money_snapshots
    WHERE buyer_customer_id=OLD.buyer_customer_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_marketplace_has_formal_facts');
END;

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

INSERT INTO buyer_daily_currency_rate_versions (
  id, legacy_rate_id, business_date, source_currency_code,
  quote_currency_code, version_no, status, rate_value, rate_scale,
  rounding_rule, submitted_by_staff_id, submitted_at, decision_version,
  confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
  rejection_reason
)
SELECT
  'currency-' || id, id, business_date, 'JPY', 'CNY', version_no,
  status, cny_per_jpy_e8, 100000000, 'HALF_UP', submitted_by_staff_id,
  submitted_at, decision_version, confirmed_by_staff_id, confirmed_at,
  rejected_by_staff_id, rejected_at, rejection_reason
FROM buyer_daily_exchange_rates;

CREATE UNIQUE INDEX uq_buyer_daily_currency_rate_pending
ON buyer_daily_currency_rate_versions (
  business_date, source_currency_code, quote_currency_code
) WHERE status='SUBMITTED';

CREATE UNIQUE INDEX uq_buyer_daily_currency_rate_confirmed
ON buyer_daily_currency_rate_versions (
  business_date, source_currency_code, quote_currency_code
) WHERE status='CONFIRMED';

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

CREATE TRIGGER trg_buyer_daily_currency_rate_no_delete
BEFORE DELETE ON buyer_daily_currency_rate_versions
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_currency_rate_version_is_immutable');
END;

CREATE TABLE seller_agreement_currency_rate_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  legacy_rate_id TEXT UNIQUE REFERENCES seller_agreement_rate_versions(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  source_currency_code TEXT NOT NULL REFERENCES currencies(code),
  quote_currency_code TEXT NOT NULL REFERENCES currencies(code)
    CHECK (quote_currency_code='CNY'),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED','CONFIRMED','REJECTED')),
  rate_value INTEGER NOT NULL CHECK (rate_value BETWEEN 1 AND 9007199254740991),
  rate_scale INTEGER NOT NULL CHECK (rate_scale BETWEEN 1 AND 9007199254740991),
  rounding_rule TEXT NOT NULL CHECK (rounding_rule='HALF_UP'),
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
    seller_organization_id, source_currency_code,
    quote_currency_code, version_no
  ),
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

INSERT INTO seller_agreement_currency_rate_versions (
  id, legacy_rate_id, seller_organization_id, source_currency_code,
  quote_currency_code, version_no, status, rate_value, rate_scale,
  rounding_rule, effective_from, submitted_by_staff_id, submitted_at,
  decision_version, confirmed_by_staff_id, confirmed_at,
  rejected_by_staff_id, rejected_at, rejection_reason
)
SELECT
  'currency-' || id, id, organization_id, 'JPY', 'CNY', version_no,
  status, cny_per_jpy_e8, 100000000, 'HALF_UP', effective_from,
  submitted_by_staff_id, submitted_at, decision_version,
  confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
  rejection_reason
FROM seller_agreement_rate_versions;

CREATE INDEX idx_seller_agreement_currency_rate_current
ON seller_agreement_currency_rate_versions (
  seller_organization_id, source_currency_code, quote_currency_code,
  status, effective_from DESC, version_no DESC
);

CREATE TRIGGER trg_seller_agreement_currency_rate_legacy_insert
AFTER INSERT ON seller_agreement_rate_versions
BEGIN
  INSERT INTO seller_agreement_currency_rate_versions (
    id, legacy_rate_id, seller_organization_id, source_currency_code,
    quote_currency_code, version_no, status, rate_value, rate_scale,
    rounding_rule, effective_from, submitted_by_staff_id, submitted_at,
    decision_version, confirmed_by_staff_id, confirmed_at,
    rejected_by_staff_id, rejected_at, rejection_reason
  ) VALUES (
    'currency-' || NEW.id, NEW.id, NEW.organization_id, 'JPY', 'CNY',
    NEW.version_no, NEW.status, NEW.cny_per_jpy_e8, 100000000, 'HALF_UP',
    NEW.effective_from, NEW.submitted_by_staff_id, NEW.submitted_at,
    NEW.decision_version, NEW.confirmed_by_staff_id, NEW.confirmed_at,
    NEW.rejected_by_staff_id, NEW.rejected_at, NEW.rejection_reason
  );
END;

CREATE TRIGGER trg_seller_agreement_currency_rate_legacy_update
AFTER UPDATE ON seller_agreement_rate_versions
BEGIN
  UPDATE seller_agreement_currency_rate_versions
  SET status=NEW.status, decision_version=NEW.decision_version,
    confirmed_by_staff_id=NEW.confirmed_by_staff_id,
    confirmed_at=NEW.confirmed_at,
    rejected_by_staff_id=NEW.rejected_by_staff_id,
    rejected_at=NEW.rejected_at,
    rejection_reason=NEW.rejection_reason
  WHERE legacy_rate_id=NEW.id;
END;

CREATE TRIGGER trg_seller_agreement_currency_rate_update_guard
BEFORE UPDATE ON seller_agreement_currency_rate_versions
WHEN OLD.status<>'SUBMITTED'
  OR NEW.id<>OLD.id OR NEW.legacy_rate_id IS NOT OLD.legacy_rate_id
  OR NEW.seller_organization_id<>OLD.seller_organization_id
  OR NEW.source_currency_code<>OLD.source_currency_code
  OR NEW.quote_currency_code<>OLD.quote_currency_code
  OR NEW.version_no<>OLD.version_no OR NEW.rate_value<>OLD.rate_value
  OR NEW.rate_scale<>OLD.rate_scale OR NEW.rounding_rule<>OLD.rounding_rule
  OR NEW.effective_from<>OLD.effective_from
  OR NEW.submitted_by_staff_id<>OLD.submitted_by_staff_id
  OR NEW.submitted_at<>OLD.submitted_at
BEGIN
  SELECT RAISE(ABORT, 'seller_agreement_currency_rate_version_is_immutable');
END;

CREATE TRIGGER trg_seller_agreement_currency_rate_no_delete
BEFORE DELETE ON seller_agreement_currency_rate_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_agreement_currency_rate_version_is_immutable');
END;

CREATE TABLE seller_service_fee_rule_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  legacy_fee_id TEXT UNIQUE REFERENCES seller_service_fee_versions(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
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

INSERT INTO seller_service_fee_rule_versions (
  id, legacy_fee_id, seller_organization_id, marketplace_code,
  review_type, version_no, status, fee_amount_minor, fee_currency_code,
  fee_currency_exponent, effective_from, submitted_by_staff_id,
  submitted_at, decision_version, confirmed_by_staff_id, confirmed_at,
  rejected_by_staff_id, rejected_at, rejection_reason
)
SELECT
  'marketplace-' || fee.id, fee.id, fee.organization_id, 'AMAZON_JP',
  fee.review_type, fee.version_no, fee.status, fee.fee_cny_fen, 'CNY', 2,
  fee.effective_from, fee.submitted_by_staff_id, fee.submitted_at,
  fee.decision_version, fee.confirmed_by_staff_id, fee.confirmed_at,
  fee.rejected_by_staff_id, fee.rejected_at, fee.rejection_reason
FROM seller_service_fee_versions fee;

CREATE INDEX idx_seller_service_fee_rule_current
ON seller_service_fee_rule_versions (
  seller_organization_id, marketplace_code, review_type,
  status, effective_from DESC, version_no DESC
);

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

CREATE TRIGGER trg_seller_service_fee_rule_no_delete
BEFORE DELETE ON seller_service_fee_rule_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_rule_version_is_immutable');
END;

CREATE TABLE order_evidence_marketplace_money (
  order_evidence_version_id TEXT PRIMARY KEY REFERENCES order_evidence_versions(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  platform_order_identifier TEXT NOT NULL CHECK (
    length(platform_order_identifier) BETWEEN 1 AND 200
  ),
  platform_product_identifier TEXT,
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
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

INSERT INTO order_evidence_marketplace_money (
  order_evidence_version_id, marketplace_code, platform_order_identifier,
  platform_product_identifier, platform_order_date, payment_amount_minor,
  payment_currency_code, payment_currency_exponent, created_at
)
SELECT
  evidence.id, 'AMAZON_JP', evidence.amazon_order_number_normalized,
  NULL, evidence.amazon_order_date, evidence.final_paid_jpy, 'JPY', 0,
  evidence.created_at
FROM order_evidence_versions evidence;

CREATE INDEX idx_order_evidence_platform_identifier
ON order_evidence_marketplace_money (
  marketplace_code, platform_order_identifier, created_at,
  order_evidence_version_id
);

CREATE TRIGGER trg_order_evidence_marketplace_money_no_update
BEFORE UPDATE ON order_evidence_marketplace_money
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_marketplace_money_is_immutable');
END;

CREATE TRIGGER trg_order_evidence_marketplace_money_no_delete
BEFORE DELETE ON order_evidence_marketplace_money
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_marketplace_money_is_immutable');
END;

CREATE TRIGGER trg_order_evidence_marketplace_money_legacy_insert
AFTER INSERT ON order_evidence_versions
BEGIN
  INSERT INTO order_evidence_marketplace_money (
    order_evidence_version_id, marketplace_code,
    platform_order_identifier, platform_product_identifier,
    platform_order_date, payment_amount_minor,
    payment_currency_code, payment_currency_exponent, created_at
  ) VALUES (
    NEW.id, 'AMAZON_JP', NEW.amazon_order_number_normalized, NULL,
    NEW.amazon_order_date, NEW.final_paid_jpy, 'JPY', 0, NEW.created_at
  );
END;

CREATE TABLE formal_order_marketplace_money_snapshots (
  formal_order_id TEXT PRIMARY KEY CHECK (length(formal_order_id) BETWEEN 1 AND 120),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL REFERENCES seller_stores(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
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
  seller_rate_version_id TEXT NOT NULL REFERENCES seller_agreement_currency_rate_versions(id),
  seller_rate_version_no INTEGER NOT NULL CHECK (seller_rate_version_no >= 1),
  seller_rate_effective_from INTEGER NOT NULL CHECK (seller_rate_effective_from >= 0),
  seller_rate_confirmed_at INTEGER NOT NULL CHECK (seller_rate_confirmed_at >= 0),
  seller_rate_value INTEGER NOT NULL CHECK (seller_rate_value > 0),
  seller_rate_scale INTEGER NOT NULL CHECK (seller_rate_scale > 0),
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

INSERT INTO formal_order_marketplace_money_snapshots (
  formal_order_id, buyer_customer_id, seller_organization_id, store_id,
  marketplace_code, review_type, platform_order_identifier,
  platform_product_identifier, platform_order_date, payment_amount_minor,
  payment_currency_code, payment_currency_exponent,
  buyer_rate_version_id, buyer_rate_version_no, buyer_rate_confirmed_at,
  buyer_rate_value, buyer_rate_scale,
  seller_rate_version_id, seller_rate_version_no,
  seller_rate_effective_from, seller_rate_confirmed_at,
  seller_rate_value, seller_rate_scale,
  source_currency_code, quote_currency_code, source_currency_exponent,
  quote_currency_exponent, rounding_rule, service_fee_rule_version_id,
  service_fee_rule_version_no, service_fee_effective_from,
  service_fee_confirmed_at,
  service_fee_amount_minor, service_fee_currency_code,
  buyer_expected_principal_amount_minor,
  seller_expected_principal_amount_minor, created_at
)
SELECT
  formal_order.id, formal_order.buyer_customer_id,
  formal_order.seller_organization_id, formal_order.store_id,
  'AMAZON_JP', formal_order.review_type,
  formal_order.amazon_order_number_normalized,
  formal_order.asin_normalized, formal_order.amazon_order_date,
  formal_order.final_paid_jpy, 'JPY', 0,
  'currency-' || snapshot.buyer_rate_version_id,
  snapshot.buyer_rate_version_no, snapshot.buyer_rate_confirmed_at,
  snapshot.buyer_cny_per_jpy_e8, 100000000,
  'currency-' || snapshot.seller_rate_version_id,
  snapshot.seller_rate_version_no, snapshot.seller_rate_effective_from,
  snapshot.seller_rate_confirmed_at,
  snapshot.seller_cny_per_jpy_e8, 100000000,
  'JPY', 'CNY', 0, 2, snapshot.rounding_rule,
  'marketplace-' || snapshot.service_fee_version_id,
  snapshot.service_fee_version_no, snapshot.service_fee_effective_from,
  snapshot.service_fee_confirmed_at,
  snapshot.service_fee_cny_fen, 'CNY',
  snapshot.buyer_expected_principal_cny_fen,
  snapshot.seller_expected_principal_cny_fen, snapshot.created_at
FROM formal_orders formal_order
JOIN formal_order_financial_snapshots snapshot
  ON snapshot.formal_order_id=formal_order.id;

CREATE INDEX idx_formal_order_marketplace_money_buyer
ON formal_order_marketplace_money_snapshots (
  buyer_customer_id, created_at, formal_order_id
);

CREATE INDEX idx_formal_order_marketplace_money_seller
ON formal_order_marketplace_money_snapshots (
  seller_organization_id, store_id, created_at, formal_order_id
);

CREATE TRIGGER trg_formal_order_marketplace_money_source_guard
BEFORE INSERT ON formal_order_marketplace_money_snapshots
WHEN
  NOT EXISTS (
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
    JOIN currencies currency
      ON currency.code=marketplace.transaction_currency_code
    WHERE marketplace.code=NEW.marketplace_code
      AND marketplace.status='ACTIVE'
      AND marketplace.adapter_status='AVAILABLE'
      AND marketplace.transaction_currency_code=NEW.payment_currency_code
      AND currency.exponent=NEW.payment_currency_exponent
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_daily_currency_rate_versions rate
    WHERE rate.id=NEW.buyer_rate_version_id
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
    SELECT 1 FROM seller_agreement_currency_rate_versions rate
    WHERE rate.id=NEW.seller_rate_version_id
      AND rate.seller_organization_id=NEW.seller_organization_id
      AND rate.version_no=NEW.seller_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.source_currency_code=NEW.source_currency_code
      AND rate.quote_currency_code=NEW.quote_currency_code
      AND rate.rate_value=NEW.seller_rate_value
      AND rate.rate_scale=NEW.seller_rate_scale
      AND rate.rounding_rule=NEW.rounding_rule
      AND rate.effective_from=NEW.seller_rate_effective_from
      AND rate.confirmed_at=NEW.seller_rate_confirmed_at
      AND rate.effective_from<=NEW.created_at
      AND rate.confirmed_at<=NEW.created_at
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

CREATE TRIGGER trg_formal_order_marketplace_money_no_update
BEFORE UPDATE ON formal_order_marketplace_money_snapshots
BEGIN
  SELECT RAISE(ABORT, 'formal_order_marketplace_money_is_immutable');
END;

CREATE TRIGGER trg_formal_order_marketplace_money_no_delete
BEFORE DELETE ON formal_order_marketplace_money_snapshots
BEGIN
  SELECT RAISE(ABORT, 'formal_order_marketplace_money_is_immutable');
END;

CREATE TRIGGER trg_formal_order_marketplace_money_legacy_insert
AFTER INSERT ON formal_order_financial_snapshots
BEGIN
  INSERT INTO formal_order_marketplace_money_snapshots (
    formal_order_id, buyer_customer_id, seller_organization_id, store_id,
    marketplace_code, review_type, platform_order_identifier,
    platform_product_identifier, platform_order_date, payment_amount_minor,
    payment_currency_code, payment_currency_exponent,
    buyer_rate_version_id, buyer_rate_version_no, buyer_rate_confirmed_at,
    buyer_rate_value, buyer_rate_scale,
    seller_rate_version_id, seller_rate_version_no,
    seller_rate_effective_from, seller_rate_confirmed_at,
    seller_rate_value, seller_rate_scale,
    source_currency_code, quote_currency_code, source_currency_exponent,
    quote_currency_exponent, rounding_rule, service_fee_rule_version_id,
    service_fee_rule_version_no, service_fee_effective_from,
    service_fee_confirmed_at,
    service_fee_amount_minor, service_fee_currency_code,
    buyer_expected_principal_amount_minor,
    seller_expected_principal_amount_minor, created_at
  )
  SELECT
    formal_order.id, formal_order.buyer_customer_id,
    formal_order.seller_organization_id, formal_order.store_id,
    'AMAZON_JP', formal_order.review_type,
    formal_order.amazon_order_number_normalized,
    formal_order.asin_normalized, formal_order.amazon_order_date,
    formal_order.final_paid_jpy, 'JPY', 0,
    'currency-' || NEW.buyer_rate_version_id,
    NEW.buyer_rate_version_no, NEW.buyer_rate_confirmed_at,
    NEW.buyer_cny_per_jpy_e8, 100000000,
    'currency-' || NEW.seller_rate_version_id,
    NEW.seller_rate_version_no, NEW.seller_rate_effective_from,
    NEW.seller_rate_confirmed_at,
    NEW.seller_cny_per_jpy_e8, 100000000,
    'JPY', 'CNY', 0, 2, NEW.rounding_rule,
    'marketplace-' || NEW.service_fee_version_id,
    NEW.service_fee_version_no, NEW.service_fee_effective_from,
    NEW.service_fee_confirmed_at,
    NEW.service_fee_cny_fen, 'CNY',
    NEW.buyer_expected_principal_cny_fen,
    NEW.seller_expected_principal_cny_fen, NEW.created_at
  FROM formal_orders formal_order
  WHERE formal_order.id=NEW.formal_order_id;
END;

-- Backfill and relationship assertions. These compare exact row counts and
-- exact legacy amounts/rates; no inferred date or recalculation is allowed.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM currencies)=4
  AND (SELECT COUNT(*) FROM marketplace_registry)=3
  AND (SELECT status FROM marketplace_registry WHERE code='COUPANG_KR')='DISABLED'
  AND (SELECT adapter_status FROM marketplace_registry WHERE code='COUPANG_KR')='UNAVAILABLE'
  AND (SELECT COUNT(*) FROM buyer_marketplace_assignments)=
      (SELECT COUNT(*) FROM buyer_customers)
  AND (SELECT COUNT(*) FROM seller_store_marketplaces)=
      (SELECT COUNT(*) FROM seller_stores)
  AND (SELECT COUNT(*) FROM buyer_daily_currency_rate_versions)=
      (SELECT COUNT(*) FROM buyer_daily_exchange_rates)
  AND (SELECT COUNT(*) FROM seller_agreement_currency_rate_versions)=
      (SELECT COUNT(*) FROM seller_agreement_rate_versions)
  AND (SELECT COUNT(*) FROM seller_service_fee_rule_versions)=
      (SELECT COUNT(*) FROM seller_service_fee_versions)
  AND (SELECT COUNT(*) FROM order_evidence_marketplace_money)=
      (SELECT COUNT(*) FROM order_evidence_versions)
  AND (SELECT COUNT(*) FROM formal_order_marketplace_money_snapshots)=
      (SELECT COUNT(*) FROM formal_order_financial_snapshots)
  AND NOT EXISTS (
    SELECT 1
    FROM formal_order_marketplace_money_snapshots generic
    JOIN formal_orders formal_order ON formal_order.id=generic.formal_order_id
    JOIN formal_order_financial_snapshots legacy
      ON legacy.formal_order_id=formal_order.id
    WHERE generic.payment_amount_minor<>formal_order.final_paid_jpy
      OR generic.buyer_rate_value<>legacy.buyer_cny_per_jpy_e8
      OR generic.seller_rate_value<>legacy.seller_cny_per_jpy_e8
      OR generic.service_fee_amount_minor<>legacy.service_fee_cny_fen
      OR generic.buyer_expected_principal_amount_minor<>
        legacy.buyer_expected_principal_cny_fen
      OR generic.seller_expected_principal_amount_minor<>
        legacy.seller_expected_principal_cny_fen
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=29,
  installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=28;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
