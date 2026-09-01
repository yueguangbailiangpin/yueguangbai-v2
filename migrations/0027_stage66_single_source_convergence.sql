-- Stage 6.6 single-source convergence (D-056): marketplace registry as the only
-- marketplace config source, buyer numbers allocated at profile creation, single
-- immediate-effect rate / markup / service-fee version tables, and one immutable
-- formal-order financial snapshot. Forward-only; no production data exists.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=26 THEN 1 ELSE 0 END;

-- Retire every trigger whose body references objects this migration
-- replaces, so no dangling reference survives any intermediate statement.
DROP TRIGGER IF EXISTS trg_advance_principal_full_payment_amount_guard;
DROP TRIGGER IF EXISTS trg_buyer_customer_marketplace_default;
DROP TRIGGER IF EXISTS trg_buyer_daily_currency_rate_legacy_insert;
DROP TRIGGER IF EXISTS trg_buyer_daily_currency_rate_legacy_update;
DROP TRIGGER IF EXISTS trg_buyer_daily_currency_rate_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_daily_currency_rate_update_guard;
DROP TRIGGER IF EXISTS trg_buyer_daily_rate_after_confirmed_guard;
DROP TRIGGER IF EXISTS trg_buyer_daily_rate_confirmed_conflict;
DROP TRIGGER IF EXISTS trg_buyer_daily_rate_decision_only;
DROP TRIGGER IF EXISTS trg_buyer_daily_rate_initial_state_guard;
DROP TRIGGER IF EXISTS trg_buyer_daily_rate_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_daily_rate_pending_conflict;
DROP TRIGGER IF EXISTS trg_buyer_invitation_consumed_link_acquisition_lead;
DROP VIEW IF EXISTS internal_order_finance_positions;
DROP VIEW IF EXISTS internal_finance_exceptions;
DROP TRIGGER IF EXISTS trg_buyer_marketplace_assignment_fact_guard;
DROP TRIGGER IF EXISTS trg_buyer_number_events_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_number_events_no_update;
DROP TRIGGER IF EXISTS trg_buyer_preorder_numbers_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_preorder_numbers_no_update;
DROP TRIGGER IF EXISTS trg_customer_account_identity_rebind_guard;
DROP TRIGGER IF EXISTS trg_customer_account_identity_rebind_persona_sync;
DROP TRIGGER IF EXISTS trg_customer_account_persona_after_account_buyer;
DROP TRIGGER IF EXISTS trg_customer_account_persona_after_buyer;
DROP TRIGGER IF EXISTS trg_customer_account_persona_source_guard;
DROP TRIGGER IF EXISTS trg_customer_account_personas_no_update;
DROP TRIGGER IF EXISTS trg_formal_order_financial_self_pay_guard;
DROP TRIGGER IF EXISTS trg_formal_order_financial_snapshot_guard;
DROP TRIGGER IF EXISTS trg_formal_order_financial_snapshots_no_delete;
DROP TRIGGER IF EXISTS trg_formal_order_financial_snapshots_no_update;
DROP TRIGGER IF EXISTS trg_formal_order_marketplace_money_no_delete;
DROP TRIGGER IF EXISTS trg_formal_order_marketplace_money_no_update;
DROP TRIGGER IF EXISTS trg_formal_order_marketplace_money_source_guard;
DROP TRIGGER IF EXISTS trg_formal_order_source_guard;
DROP TRIGGER IF EXISTS trg_marketplace_runtime_config_no_delete;
DROP TRIGGER IF EXISTS trg_marketplace_runtime_config_no_update;
DROP TRIGGER IF EXISTS trg_order_evidence_marketplace_money_legacy_insert;
DROP TRIGGER IF EXISTS trg_order_evidence_marketplace_money_no_delete;
DROP TRIGGER IF EXISTS trg_order_evidence_marketplace_money_no_update;
DROP TRIGGER IF EXISTS trg_review_event_identity_guard;
DROP TRIGGER IF EXISTS trg_seller_payable_source_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_policy_decision_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_policy_event_fidelity_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_policy_event_source_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_policy_future_effective_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_policy_initial_state_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_policy_no_delete;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_snapshot_confirmation_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_snapshot_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_snapshots_no_delete;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_snapshots_no_update;
DROP TRIGGER IF EXISTS trg_seller_service_fee_decision_only;
DROP TRIGGER IF EXISTS trg_seller_service_fee_effective_conflict;
DROP TRIGGER IF EXISTS trg_seller_service_fee_initial_state_guard;
DROP TRIGGER IF EXISTS trg_seller_service_fee_no_delete;
DROP TRIGGER IF EXISTS trg_seller_service_fee_pending_conflict;
DROP TRIGGER IF EXISTS trg_seller_service_fee_rule_legacy_insert;
DROP TRIGGER IF EXISTS trg_seller_service_fee_rule_legacy_update;
DROP TRIGGER IF EXISTS trg_seller_service_fee_rule_no_delete;
DROP TRIGGER IF EXISTS trg_seller_service_fee_rule_update_guard;


-- =====================================================================
-- Section A — marketplace_registry is the single marketplace config source
-- =====================================================================

DROP VIEW IF EXISTS formal_order_effective_dates;


CREATE TABLE marketplace_registry_stage66_new (
  code TEXT PRIMARY KEY CHECK (code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR')),
  platform_code TEXT NOT NULL CHECK (platform_code IN ('AMAZON','COUPANG')),
  region_code TEXT NOT NULL CHECK (region_code IN ('JP','US','KR')),
  transaction_currency_code TEXT NOT NULL REFERENCES currencies(code),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  adapter_status TEXT NOT NULL CHECK (
    adapter_status IN ('AVAILABLE','UNAVAILABLE')
  ),
  display_name_zh TEXT NOT NULL CHECK (
    length(display_name_zh) BETWEEN 1 AND 100
  ),
  business_timezone TEXT NOT NULL CHECK (
    length(business_timezone) BETWEEN 3 AND 80
  ),
  reporting_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai' CHECK (
    length(reporting_timezone) BETWEEN 3 AND 80
  ),
  seller_portal_status TEXT NOT NULL CHECK (
    seller_portal_status IN ('ACTIVE','PREPARED','DISABLED')
  ),
  buyer_portal_status TEXT NOT NULL CHECK (
    buyer_portal_status IN ('ACTIVE','PREPARED','DISABLED')
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
  CHECK (
    seller_portal_status<>'DISABLED'
    OR (status='DISABLED' AND adapter_status='UNAVAILABLE')
  ),
  CHECK (
    buyer_portal_status<>'DISABLED'
    OR (status='DISABLED' AND adapter_status='UNAVAILABLE')
  )
) STRICT;

INSERT INTO marketplace_registry_stage66_new (
  code, platform_code, region_code, transaction_currency_code,
  status, adapter_status, display_name_zh,
  business_timezone, reporting_timezone,
  seller_portal_status, buyer_portal_status, created_at, updated_at
)
SELECT
  registry.code, registry.platform_code, registry.region_code,
  registry.transaction_currency_code, registry.status,
  registry.adapter_status, registry.display_name_zh,
  COALESCE(runtime.business_timezone, 'Asia/Tokyo'),
  COALESCE(runtime.reporting_timezone, 'Asia/Shanghai'),
  COALESCE(runtime.seller_portal_status,
    CASE WHEN registry.code='AMAZON_JP' THEN 'ACTIVE' ELSE 'PREPARED' END),
  COALESCE(runtime.buyer_portal_status,
    CASE WHEN registry.code='AMAZON_JP' THEN 'ACTIVE' ELSE 'PREPARED' END),
  registry.created_at, registry.updated_at
FROM marketplace_registry registry
LEFT JOIN marketplace_runtime_config runtime
  ON runtime.marketplace_code=registry.code;

DROP TABLE marketplace_runtime_config;
DROP TABLE marketplace_registry;
ALTER TABLE marketplace_registry_stage66_new RENAME TO marketplace_registry;

CREATE VIEW formal_order_effective_dates AS
SELECT formal_order.id AS formal_order_id,
  formal_order.marketplace_code AS canonical_marketplace_code,
  formal_order.confirmed_business_date AS reporting_business_date,
  COALESCE(
    formal_order.marketplace_business_date,
    CASE formal_order.marketplace_code
      WHEN 'AMAZON_JP' THEN date(formal_order.confirmed_at/1000,'unixepoch','+9 hours')
      WHEN 'COUPANG_KR' THEN date(formal_order.confirmed_at/1000,'unixepoch','+9 hours')
      ELSE NULL
    END
  ) AS marketplace_business_date,
  registry.business_timezone,
  registry.reporting_timezone
FROM formal_orders formal_order
JOIN marketplace_registry registry
  ON registry.code=formal_order.marketplace_code;

-- =====================================================================
-- Section B — buyer numbers are allocated when the profile is created
-- =====================================================================

DROP TABLE buyer_preorder_number_allocations;

CREATE TABLE buyer_customers_stage66_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  identity_subject_id TEXT NOT NULL UNIQUE
    REFERENCES customer_identity_subjects(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
  buyer_channel_id TEXT NOT NULL
    REFERENCES buyer_channels(id),
  buyer_customer_no TEXT NOT NULL UNIQUE
    CHECK (length(buyer_customer_no) BETWEEN 13 AND 20
      AND buyer_customer_no GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][BC][0-9]*'),
  buyer_sequence INTEGER NOT NULL
    CHECK (buyer_sequence >= 1),
  display_name TEXT NOT NULL
    CHECK (length(display_name) BETWEEN 1 AND 100),
  access_status TEXT NOT NULL
    CHECK (access_status IN ('DISABLED', 'ACTIVE')),
  identity_review_status TEXT NOT NULL
    CHECK (identity_review_status IN ('CLEAR', 'REVIEW_REQUIRED')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  activated_at INTEGER,
  disabled_at INTEGER,
  refund_account_name TEXT
    CHECK (refund_account_name IS NULL
      OR length(refund_account_name) BETWEEN 1 AND 100),
  refund_account_identifier TEXT
    CHECK (refund_account_identifier IS NULL
      OR length(refund_account_identifier) BETWEEN 3 AND 128),
  CHECK (
    (access_status='ACTIVE'
      AND activated_at IS NOT NULL
      AND disabled_at IS NULL)
    OR
    (access_status='DISABLED')
  )
) STRICT;

INSERT INTO buyer_customers_stage66_new (
  id, identity_subject_id, marketplace_code, buyer_channel_id,
  buyer_customer_no, buyer_sequence, display_name, access_status,
  identity_review_status, version, created_at, updated_at, activated_at,
  disabled_at, refund_account_name, refund_account_identifier
)
SELECT
  id, identity_subject_id, marketplace_code, buyer_channel_id,
  buyer_customer_no, buyer_sequence, display_name, access_status,
  identity_review_status, version, created_at, updated_at, activated_at,
  disabled_at, refund_account_name, refund_account_identifier
FROM buyer_customers;

DROP TABLE buyer_customers;
ALTER TABLE buyer_customers_stage66_new RENAME TO buyer_customers;

CREATE INDEX idx_buyer_customer_status_channel
ON buyer_customers (access_status, buyer_channel_id, created_at, id);
CREATE UNIQUE INDEX uq_buyer_channel_sequence
ON buyer_customers (buyer_channel_id, buyer_sequence);
CREATE UNIQUE INDEX uq_buyer_customers_id_marketplace
ON buyer_customers (id, marketplace_code);

CREATE TABLE buyer_number_allocation_events_stage66_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT NOT NULL UNIQUE
    REFERENCES buyer_customers(id),
  buyer_channel_id TEXT NOT NULL
    REFERENCES buyer_channels(id),
  buyer_customer_no TEXT NOT NULL UNIQUE
    CHECK (length(buyer_customer_no) BETWEEN 13 AND 20),
  buyer_sequence INTEGER NOT NULL
    CHECK (buyer_sequence >= 1),
  allocation_business_date TEXT NOT NULL
    CHECK (
      allocation_business_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  allocation_source TEXT NOT NULL
    CHECK (allocation_source IN ('STAFF_CREATION', 'INVITED_REGISTRATION')),
  actor_staff_id TEXT REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (buyer_channel_id, buyer_sequence)
) STRICT;

INSERT INTO buyer_number_allocation_events_stage66_new (
  id, buyer_customer_id, buyer_channel_id, buyer_customer_no,
  buyer_sequence, allocation_business_date, allocation_source,
  actor_staff_id, idempotency_key, created_at
)
SELECT
  events.id, events.buyer_customer_id, events.buyer_channel_id,
  events.buyer_customer_no, events.buyer_sequence,
  COALESCE(events.first_valid_order_business_date,
    substr(events.buyer_customer_no,1,4) || '-'
    || substr(events.buyer_customer_no,5,2) || '-'
    || substr(events.buyer_customer_no,7,2)),
  'STAFF_CREATION', events.actor_staff_id, events.idempotency_key,
  events.created_at
FROM buyer_number_allocation_events events;

DROP TABLE buyer_number_allocation_events;
ALTER TABLE buyer_number_allocation_events_stage66_new
  RENAME TO buyer_number_allocation_events;

CREATE INDEX idx_buyer_number_allocation_events_channel
ON buyer_number_allocation_events (buyer_channel_id, buyer_sequence);

-- The two operational buyer WeChat channels used by the customer number
-- format. Sequences start at 1 locally; before production numbering the operator
-- must raise next_sequence above the largest historical sequence (see the
-- stage 6.6 handoff). Runtime allocation additionally refuses to go below
-- the maximum sequence already present in buyer_customers.
INSERT INTO buyer_channels (
  id, code, name, status, next_sequence, version, created_at, updated_at
) VALUES
  ('buyer-channel-wechat-b', 'B', '买家微信对接渠道 B', 'ACTIVE', 1, 1,
    1787661496000, 1787661496000),
  ('buyer-channel-wechat-c', 'C', '买家微信对接渠道 C', 'ACTIVE', 1, 1,
    1787661496000, 1787661496000);

-- =====================================================================
-- Section C — rate / markup / service-fee single immediate-effect versions
-- =====================================================================

DROP TABLE buyer_daily_exchange_rates;
DROP TABLE buyer_daily_exchange_rate_events;
DROP TABLE seller_service_fee_versions;
DROP TABLE seller_service_fee_events;

CREATE TABLE buyer_daily_currency_rate_versions_stage66_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  business_date TEXT NOT NULL CHECK (
    business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(business_date)=business_date
  ),
  source_currency_code TEXT NOT NULL REFERENCES currencies(code),
  quote_currency_code TEXT NOT NULL REFERENCES currencies(code)
    CHECK (quote_currency_code='CNY'),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  rate_value INTEGER NOT NULL CHECK (
    rate_value BETWEEN 1 AND 9007199254740991
  ),
  rate_scale INTEGER NOT NULL CHECK (
    rate_scale BETWEEN 1 AND 9007199254740991
  ),
  rounding_rule TEXT NOT NULL CHECK (rounding_rule='HALF_UP'),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (business_date, source_currency_code, quote_currency_code, version_no),
  CHECK (source_currency_code<>quote_currency_code),
  CHECK (effective_from=created_at)
) STRICT;

INSERT INTO buyer_daily_currency_rate_versions_stage66_new (
  id, business_date, source_currency_code, quote_currency_code,
  version_no, rate_value, rate_scale, rounding_rule, effective_from,
  created_by_staff_id, created_at
)
SELECT
  id, business_date, source_currency_code, quote_currency_code,
  version_no, rate_value, rate_scale, rounding_rule,
  COALESCE(confirmed_at, submitted_at),
  COALESCE(confirmed_by_staff_id, submitted_by_staff_id),
  COALESCE(confirmed_at, submitted_at)
FROM buyer_daily_currency_rate_versions
WHERE status='CONFIRMED';

DROP TABLE buyer_daily_currency_rate_versions;
ALTER TABLE buyer_daily_currency_rate_versions_stage66_new
  RENAME TO buyer_daily_currency_rate_versions;

CREATE INDEX idx_buyer_daily_currency_rate_resolution
ON buyer_daily_currency_rate_versions (
  business_date, source_currency_code, quote_currency_code,
  version_no DESC
);

CREATE TRIGGER trg_buyer_daily_currency_rate_no_delete
BEFORE DELETE ON buyer_daily_currency_rate_versions
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_currency_rate_version_is_immutable');
END;

CREATE TRIGGER trg_buyer_daily_currency_rate_no_update
BEFORE UPDATE ON buyer_daily_currency_rate_versions
BEGIN
  SELECT RAISE(ABORT, 'buyer_daily_currency_rate_version_is_immutable');
END;

CREATE TABLE seller_service_fee_rule_versions_stage66_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code)
    CHECK (marketplace_code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR')),
  review_type TEXT NOT NULL CHECK (
    review_type IN ('RATING','TEXT','IMAGE','VIDEO')
  ),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  fee_amount_minor INTEGER NOT NULL CHECK (
    fee_amount_minor BETWEEN 0 AND 9007199254740991
  ),
  fee_currency_code TEXT NOT NULL REFERENCES currencies(code)
    CHECK (fee_currency_code='CNY'),
  fee_currency_exponent INTEGER NOT NULL CHECK (fee_currency_exponent=2),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (
    seller_organization_id, marketplace_code, review_type, version_no
  )
) STRICT;

INSERT INTO seller_service_fee_rule_versions_stage66_new (
  id, seller_organization_id, marketplace_code, review_type, version_no,
  fee_amount_minor, fee_currency_code, fee_currency_exponent,
  effective_from, created_by_staff_id, created_at
)
SELECT
  id, seller_organization_id, marketplace_code, review_type, version_no,
  fee_amount_minor, fee_currency_code, fee_currency_exponent,
  effective_from,
  COALESCE(confirmed_by_staff_id, submitted_by_staff_id),
  COALESCE(confirmed_at, submitted_at)
FROM seller_service_fee_rule_versions
WHERE status='CONFIRMED';

DROP TABLE seller_service_fee_rule_versions;
ALTER TABLE seller_service_fee_rule_versions_stage66_new
  RENAME TO seller_service_fee_rule_versions;

CREATE INDEX idx_seller_service_fee_rule_resolution
ON seller_service_fee_rule_versions (
  seller_organization_id, marketplace_code, review_type,
  effective_from DESC, version_no DESC
);

CREATE TRIGGER trg_seller_service_fee_rule_no_delete
BEFORE DELETE ON seller_service_fee_rule_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_rule_version_is_immutable');
END;

CREATE TRIGGER trg_seller_service_fee_rule_no_update
BEFORE UPDATE ON seller_service_fee_rule_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_service_fee_rule_version_is_immutable');
END;

DROP TABLE seller_principal_rate_policy_events;

CREATE TABLE seller_principal_rate_policy_versions_stage66_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('CURRENCY_PAIR_DEFAULT', 'SELLER_ORGANIZATION')
  ),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  source_currency_code TEXT NOT NULL REFERENCES currencies(code),
  quote_currency_code TEXT NOT NULL REFERENCES currencies(code)
    CHECK (quote_currency_code='CNY'),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  markup_rate_value INTEGER NOT NULL CHECK (
    markup_rate_value BETWEEN 0 AND 9007199254740991
  ),
  rate_scale INTEGER NOT NULL CHECK (rate_scale=100000000),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (
    (scope_type='CURRENCY_PAIR_DEFAULT' AND seller_organization_id IS NULL)
    OR (scope_type='SELLER_ORGANIZATION' AND seller_organization_id IS NOT NULL)
  )
) STRICT;

INSERT INTO seller_principal_rate_policy_versions_stage66_new (
  id, scope_type, seller_organization_id, source_currency_code,
  quote_currency_code, version_no, markup_rate_value, rate_scale,
  effective_from, created_by_staff_id, created_at
)
SELECT
  id, scope_type, seller_organization_id, source_currency_code,
  quote_currency_code, version_no, markup_rate_value, rate_scale,
  effective_from,
  COALESCE(confirmed_by_staff_id, submitted_by_staff_id),
  COALESCE(confirmed_at, submitted_at)
FROM seller_principal_rate_policy_versions
WHERE status='CONFIRMED';

DROP TABLE seller_principal_rate_policy_versions;
ALTER TABLE seller_principal_rate_policy_versions_stage66_new
  RENAME TO seller_principal_rate_policy_versions;

CREATE INDEX idx_seller_principal_rate_policy_resolution
ON seller_principal_rate_policy_versions (
  scope_type, seller_organization_id, source_currency_code,
  quote_currency_code, effective_from DESC, version_no DESC
);

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_effective
ON seller_principal_rate_policy_versions (
  scope_type, COALESCE(seller_organization_id, ''),
  source_currency_code, quote_currency_code, effective_from
);

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_version
ON seller_principal_rate_policy_versions (
  scope_type, COALESCE(seller_organization_id, ''),
  source_currency_code, quote_currency_code, version_no
);

CREATE TRIGGER trg_seller_principal_rate_policy_no_delete
BEFORE DELETE ON seller_principal_rate_policy_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_is_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_policy_no_update
BEFORE UPDATE ON seller_principal_rate_policy_versions
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_is_immutable');
END;

CREATE TABLE seller_principal_rate_policy_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  version_id TEXT NOT NULL REFERENCES seller_principal_rate_policy_versions(id),
  scope_type TEXT NOT NULL,
  seller_organization_id TEXT,
  source_currency_code TEXT NOT NULL,
  quote_currency_code TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  event_type TEXT NOT NULL CHECK (
    event_type='SELLER_PRINCIPAL_RATE_POLICY_SAVED'
  ),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  markup_rate_value INTEGER NOT NULL CHECK (markup_rate_value >= 0),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  reason TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (
    (scope_type='CURRENCY_PAIR_DEFAULT' AND seller_organization_id IS NULL)
    OR (scope_type='SELLER_ORGANIZATION' AND seller_organization_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_seller_principal_rate_policy_events_version
ON seller_principal_rate_policy_events (version_id, created_at, id);

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_event_type
ON seller_principal_rate_policy_events (version_id, event_type);

CREATE TRIGGER trg_seller_principal_rate_policy_events_no_delete
BEFORE DELETE ON seller_principal_rate_policy_events
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_event_is_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_policy_events_no_update
BEFORE UPDATE ON seller_principal_rate_policy_events
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_policy_event_is_immutable');
END;

-- Seller principal rate snapshots: the recorded-at columns now carry the
-- source version's created_at (no confirmation state exists any more).
DROP INDEX IF EXISTS idx_seller_principal_rate_snapshots_date;

CREATE TABLE seller_principal_rate_snapshots_stage66_new (
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
  base_rate_created_at INTEGER NOT NULL CHECK (base_rate_created_at >= 0),
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
  policy_created_at INTEGER NOT NULL CHECK (policy_created_at >= 0),
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
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

INSERT INTO seller_principal_rate_snapshots_stage66_new (
  formal_order_id, platform_order_date, payment_amount_minor,
  payment_currency_code, base_rate_version_id, base_rate_business_date,
  base_rate_created_at, base_rate_value, base_rate_scale,
  policy_version_id, policy_scope_type, policy_seller_organization_id,
  policy_version_no, policy_effective_from, policy_created_at,
  markup_rate_value, markup_rate_scale, final_rate_value,
  final_rate_scale, rounding_rule,
  seller_expected_principal_amount_minor, created_at
)
SELECT
  formal_order_id, platform_order_date, payment_amount_minor,
  payment_currency_code, base_rate_version_id, base_rate_business_date,
  base_rate_confirmed_at, base_rate_value, base_rate_scale,
  policy_version_id, policy_scope_type, policy_seller_organization_id,
  policy_version_no, policy_effective_from, policy_confirmed_at,
  markup_rate_value, markup_rate_scale, final_rate_value,
  final_rate_scale, rounding_rule,
  seller_expected_principal_amount_minor, created_at
FROM seller_principal_rate_snapshots;

DROP TABLE seller_principal_rate_snapshots;
ALTER TABLE seller_principal_rate_snapshots_stage66_new
  RENAME TO seller_principal_rate_snapshots;

CREATE INDEX idx_seller_principal_rate_snapshots_date
ON seller_principal_rate_snapshots (platform_order_date, created_at, formal_order_id);

CREATE TRIGGER trg_seller_principal_rate_snapshots_no_delete
BEFORE DELETE ON seller_principal_rate_snapshots
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshot_is_immutable');
END;

CREATE TRIGGER trg_seller_principal_rate_snapshots_no_update
BEFORE UPDATE ON seller_principal_rate_snapshots
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshot_is_immutable');
END;

-- =====================================================================
-- Section D — one immutable formal-order financial snapshot
-- =====================================================================


DROP TABLE formal_order_marketplace_money_snapshots;
DROP TABLE order_evidence_marketplace_money;

CREATE TABLE formal_order_financial_snapshots_stage66_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  formal_order_id TEXT NOT NULL UNIQUE
    REFERENCES formal_orders(id),
  snapshot_version INTEGER NOT NULL
    CHECK (snapshot_version=1),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL REFERENCES seller_stores(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code)
    CHECK (marketplace_code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR')),
  review_type TEXT NOT NULL CHECK (
    review_type IN ('RATING','TEXT','IMAGE','VIDEO')
  ),
  platform_order_identifier TEXT NOT NULL CHECK (
    length(platform_order_identifier) BETWEEN 1 AND 200
  ),
  platform_product_identifier TEXT NOT NULL CHECK (
    length(platform_product_identifier) BETWEEN 1 AND 200
  ),
  platform_order_date TEXT NOT NULL CHECK (
    platform_order_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(platform_order_date)=platform_order_date
  ),
  payment_amount_minor INTEGER NOT NULL CHECK (
    payment_amount_minor BETWEEN 0 AND 9007199254740991
  ),
  payment_currency_code TEXT NOT NULL REFERENCES currencies(code),
  payment_currency_exponent INTEGER NOT NULL CHECK (
    payment_currency_exponent BETWEEN 0 AND 9
  ),
  buyer_rate_version_id TEXT NOT NULL
    REFERENCES buyer_daily_currency_rate_versions(id),
  buyer_rate_version_no INTEGER NOT NULL
    CHECK (buyer_rate_version_no >= 1),
  buyer_rate_business_date TEXT NOT NULL,
  buyer_rate_confirmed_at INTEGER NOT NULL
    CHECK (buyer_rate_confirmed_at >= 0),
  buyer_rate_value INTEGER NOT NULL CHECK (buyer_rate_value > 0),
  buyer_rate_scale INTEGER NOT NULL CHECK (buyer_rate_scale > 0),
  source_currency_code TEXT NOT NULL REFERENCES currencies(code),
  quote_currency_code TEXT NOT NULL REFERENCES currencies(code)
    CHECK (quote_currency_code='CNY'),
  source_currency_exponent INTEGER NOT NULL CHECK (
    source_currency_exponent BETWEEN 0 AND 9
  ),
  quote_currency_exponent INTEGER NOT NULL CHECK (quote_currency_exponent=2),
  service_fee_rule_version_id TEXT NOT NULL
    REFERENCES seller_service_fee_rule_versions(id),
  service_fee_version_no INTEGER NOT NULL
    CHECK (service_fee_version_no >= 1),
  service_fee_effective_from INTEGER NOT NULL
    CHECK (service_fee_effective_from >= 0),
  service_fee_confirmed_at INTEGER NOT NULL
    CHECK (service_fee_confirmed_at >= 0),
  service_fee_cny_fen INTEGER NOT NULL
    CHECK (service_fee_cny_fen BETWEEN 0 AND 9007199254740991),
  service_fee_currency_code TEXT NOT NULL
    CHECK (service_fee_currency_code='CNY'),
  buyer_expected_principal_cny_fen INTEGER NOT NULL
    CHECK (
      buyer_expected_principal_cny_fen BETWEEN 0 AND 9007199254740991
    ),
  seller_expected_principal_cny_fen INTEGER NOT NULL
    CHECK (
      seller_expected_principal_cny_fen BETWEEN 0 AND 9007199254740991
    ),
  buyer_self_pay_bps INTEGER
    CHECK (buyer_self_pay_bps IS NULL OR buyer_self_pay_bps BETWEEN 0 AND 10000),
  buyer_self_pay_jpy INTEGER
    CHECK (
      buyer_self_pay_jpy IS NULL
      OR buyer_self_pay_jpy BETWEEN 0 AND 9007199254740991
    ),
  buyer_refundable_principal_jpy INTEGER
    CHECK (
      buyer_refundable_principal_jpy IS NULL
      OR buyer_refundable_principal_jpy BETWEEN 0 AND 9007199254740991
    ),
  buyer_gross_principal_cny_fen INTEGER
    CHECK (
      buyer_gross_principal_cny_fen IS NULL
      OR buyer_gross_principal_cny_fen BETWEEN 0 AND 9007199254740991
    ),
  buyer_self_pay_contribution_cny_fen INTEGER
    CHECK (
      buyer_self_pay_contribution_cny_fen IS NULL
      OR buyer_self_pay_contribution_cny_fen BETWEEN 0 AND 9007199254740991
    ),
  rounding_rule TEXT NOT NULL
    CHECK (rounding_rule='HALF_UP'),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  CHECK (payment_currency_code=source_currency_code),
  CHECK (payment_currency_exponent=source_currency_exponent)
) STRICT;

INSERT INTO formal_order_financial_snapshots_stage66_new (
  id, formal_order_id, snapshot_version,
  buyer_customer_id, seller_organization_id, store_id, marketplace_code,
  review_type, platform_order_identifier, platform_product_identifier,
  platform_order_date, payment_amount_minor, payment_currency_code,
  payment_currency_exponent,
  buyer_rate_version_id, buyer_rate_version_no, buyer_rate_business_date,
  buyer_rate_confirmed_at, buyer_rate_value, buyer_rate_scale,
  source_currency_code, quote_currency_code, source_currency_exponent,
  quote_currency_exponent,
  service_fee_rule_version_id, service_fee_version_no,
  service_fee_effective_from, service_fee_confirmed_at, service_fee_cny_fen,
  service_fee_currency_code,
  buyer_expected_principal_cny_fen, seller_expected_principal_cny_fen,
  buyer_self_pay_bps, buyer_self_pay_jpy, buyer_refundable_principal_jpy,
  buyer_gross_principal_cny_fen, buyer_self_pay_contribution_cny_fen,
  rounding_rule, created_at
)
SELECT
  snapshot.id, snapshot.formal_order_id, snapshot.snapshot_version,
  formal_order.buyer_customer_id, formal_order.seller_organization_id,
  formal_order.store_id, formal_order.marketplace_code,
  formal_order.review_type,
  formal_order.amazon_order_number_normalized,
  formal_order.asin_normalized,
  formal_order.amazon_order_date,
  formal_order.final_paid_jpy, 'JPY', 0,
  snapshot.buyer_rate_version_id, snapshot.buyer_rate_version_no,
  snapshot.buyer_rate_business_date, snapshot.buyer_rate_confirmed_at,
  snapshot.buyer_cny_per_jpy_e8, 100000000,
  'JPY', 'CNY', 0, 2,
  snapshot.service_fee_version_id, snapshot.service_fee_version_no,
  snapshot.service_fee_effective_from, snapshot.service_fee_confirmed_at,
  snapshot.service_fee_cny_fen, 'CNY',
  snapshot.buyer_expected_principal_cny_fen,
  snapshot.seller_expected_principal_cny_fen,
  snapshot.buyer_self_pay_bps, snapshot.buyer_self_pay_jpy,
  snapshot.buyer_refundable_principal_jpy,
  snapshot.buyer_gross_principal_cny_fen,
  snapshot.buyer_self_pay_contribution_cny_fen,
  snapshot.rounding_rule, snapshot.created_at
FROM formal_order_financial_snapshots snapshot
JOIN formal_orders formal_order ON formal_order.id=snapshot.formal_order_id;

DROP TABLE formal_order_financial_snapshots;
ALTER TABLE formal_order_financial_snapshots_stage66_new
  RENAME TO formal_order_financial_snapshots;

CREATE INDEX idx_formal_order_financial_snapshots_order
ON formal_order_financial_snapshots (
  buyer_customer_id, created_at, formal_order_id
);

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

CREATE TRIGGER trg_formal_order_financial_self_pay_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    JOIN order_evidence_versions evidence
      ON evidence.id=formal_order.order_evidence_version_id
    WHERE formal_order.id=NEW.formal_order_id
      AND NEW.buyer_self_pay_bps=evidence.buyer_self_pay_bps_snapshot
      AND NEW.buyer_self_pay_jpy=evidence.buyer_self_pay_jpy
      AND NEW.buyer_refundable_principal_jpy=
        evidence.buyer_refundable_principal_jpy
      AND NEW.buyer_gross_principal_cny_fen>=
        NEW.buyer_expected_principal_cny_fen
      AND NEW.buyer_self_pay_contribution_cny_fen=
        NEW.buyer_gross_principal_cny_fen-
        NEW.buyer_expected_principal_cny_fen
  )
  OR (
    NEW.buyer_self_pay_bps IS NULL
    AND NEW.buyer_self_pay_jpy IS NULL
    AND NEW.buyer_refundable_principal_jpy IS NULL
    AND NEW.buyer_gross_principal_cny_fen IS NULL
    AND NEW.buyer_self_pay_contribution_cny_fen IS NULL
    AND EXISTS (
      SELECT 1
      FROM formal_orders formal_order
      JOIN order_instruction_reconciliation_markers marker
        ON marker.reservation_id=formal_order.reservation_id
        AND marker.disposition='HISTORICAL_EVIDENCE_CONTEXT'
      WHERE formal_order.id=NEW.formal_order_id
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_self_pay_snapshot_mismatch');
END;

CREATE TRIGGER trg_formal_order_financial_snapshot_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.buyer_customer_id=NEW.buyer_customer_id
      AND formal_order.seller_organization_id=NEW.seller_organization_id
      AND formal_order.store_id=NEW.store_id
      AND formal_order.marketplace_code=NEW.marketplace_code
      AND formal_order.review_type=NEW.review_type
      AND formal_order.amazon_order_number_normalized=NEW.platform_order_identifier
      AND formal_order.asin_normalized=NEW.platform_product_identifier
      AND formal_order.amazon_order_date=NEW.platform_order_date
      AND formal_order.final_paid_jpy=NEW.payment_amount_minor
      AND formal_order.confirmed_at=NEW.created_at
      AND NEW.buyer_rate_business_date<=formal_order.amazon_order_date
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
      AND rate.business_date=NEW.buyer_rate_business_date
      AND rate.version_no=NEW.buyer_rate_version_no
      AND rate.source_currency_code=NEW.source_currency_code
      AND rate.quote_currency_code=NEW.quote_currency_code
      AND rate.rate_value=NEW.buyer_rate_value
      AND rate.rate_scale=NEW.buyer_rate_scale
      AND rate.rounding_rule=NEW.rounding_rule
      AND rate.created_at=NEW.buyer_rate_confirmed_at
      AND rate.created_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_service_fee_rule_versions fee
    WHERE fee.id=NEW.service_fee_rule_version_id
      AND fee.seller_organization_id=NEW.seller_organization_id
      AND fee.marketplace_code=NEW.marketplace_code
      AND fee.review_type=NEW.review_type
      AND fee.version_no=NEW.service_fee_version_no
      AND fee.fee_amount_minor=NEW.service_fee_cny_fen
      AND fee.fee_currency_code=NEW.service_fee_currency_code
      AND fee.effective_from=NEW.service_fee_effective_from
      AND fee.created_at=NEW.service_fee_confirmed_at
      AND fee.effective_from<=NEW.created_at
      AND fee.created_at<=NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_financial_snapshot_source_mismatch');
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
    AND rate.rate_value=NEW.base_rate_value
    AND rate.rate_scale=NEW.base_rate_scale
    AND rate.created_at=NEW.base_rate_created_at
    AND rate.created_at<=NEW.created_at
)
OR NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_versions policy
  WHERE policy.id=NEW.policy_version_id
    AND policy.scope_type=NEW.policy_scope_type
    AND policy.seller_organization_id IS NEW.policy_seller_organization_id
    AND policy.version_no=NEW.policy_version_no
    AND policy.source_currency_code=NEW.payment_currency_code
    AND policy.quote_currency_code='CNY'
    AND policy.markup_rate_value=NEW.markup_rate_value
    AND policy.rate_scale=NEW.markup_rate_scale
    AND policy.effective_from=NEW.policy_effective_from
    AND policy.created_at=NEW.policy_created_at
    AND policy.effective_from<=NEW.created_at
    AND policy.created_at<=NEW.created_at
)
OR NEW.final_rate_value<>NEW.base_rate_value+NEW.markup_rate_value
OR NEW.base_rate_value > 9007199254740991-NEW.markup_rate_value
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshot_source_mismatch');
END;

CREATE TRIGGER trg_buyer_marketplace_assignment_fact_guard
BEFORE UPDATE OF marketplace_code ON buyer_marketplace_assignments
WHEN NEW.marketplace_code<>OLD.marketplace_code AND (
  EXISTS (SELECT 1 FROM product_reservations WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM order_evidence_submissions WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM formal_orders WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM review_cases WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (
    SELECT 1 FROM formal_order_financial_snapshots
    WHERE buyer_customer_id=OLD.buyer_customer_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_marketplace_has_formal_facts');
END;

-- ===== recreated views (subject tables rebuilt) =====
CREATE VIEW internal_finance_exceptions AS
SELECT
  formal_order_id,
  seller_organization_id,
  store_id,
  finance_status,
  CASE finance_status
    WHEN 'MISSING_FINANCIAL_SNAPSHOT' THEN 'MISSING_FINANCIAL_SNAPSHOT'
    WHEN 'MULTIPLE_FINANCIAL_SNAPSHOTS' THEN 'MULTIPLE_FINANCIAL_SNAPSHOTS'
    WHEN 'MISSING_PRINCIPAL_PAYABLE' THEN 'MISSING_PRINCIPAL_PAYABLE'
    WHEN 'MISSING_SERVICE_FEE_PAYABLE' THEN 'MISSING_SERVICE_FEE_PAYABLE'
    WHEN 'MISSING_BUYER_REFUND_OBLIGATION' THEN 'MISSING_BUYER_REFUND_OBLIGATION'
    WHEN 'REVIEW_APPROVAL_CONFLICT' THEN 'REVIEW_APPROVAL_CONFLICT'
    WHEN 'SELLER_ORGANIZATION_MISMATCH' THEN 'SELLER_ORGANIZATION_MISMATCH'
    WHEN 'AMOUNT_MISMATCH' THEN 'AMOUNT_MISMATCH'
    ELSE 'LEDGER_CONFLICT'
  END AS exception_code,
  CASE finance_status
    WHEN 'MISSING_FINANCIAL_SNAPSHOT' THEN 'REVIEW_FORMAL_ORDER_SNAPSHOT'
    WHEN 'MULTIPLE_FINANCIAL_SNAPSHOTS' THEN 'REVIEW_FORMAL_ORDER_SNAPSHOT'
    WHEN 'MISSING_PRINCIPAL_PAYABLE' THEN 'RUN_SELLER_PAYABLE_RECONCILIATION'
    WHEN 'MISSING_SERVICE_FEE_PAYABLE' THEN 'RUN_SELLER_PAYABLE_RECONCILIATION'
    WHEN 'MISSING_BUYER_REFUND_OBLIGATION' THEN 'REVIEW_BUYER_REFUND_OBLIGATION'
    ELSE 'MANUAL_INTERNAL_INVESTIGATION'
  END AS suggested_action
FROM internal_order_finance_positions
WHERE finance_status NOT IN ('PROJECTED_ONLY','COMPLETED');

CREATE VIEW internal_order_finance_positions AS
WITH
snapshot_facts AS (
  SELECT
    formal_order_id,
    COUNT(*) AS snapshot_count,
    MIN(id) AS snapshot_id,
    MIN(buyer_self_pay_bps) AS buyer_self_pay_bps,
    MIN(buyer_self_pay_jpy) AS buyer_self_pay_jpy,
    MIN(buyer_expected_principal_cny_fen) AS buyer_expected_principal_cny_fen,
    MIN(seller_expected_principal_cny_fen) AS seller_expected_principal_cny_fen,
    MIN(service_fee_cny_fen) AS service_fee_cny_fen
  FROM formal_order_financial_snapshots
  GROUP BY formal_order_id
),
review_facts AS (
  SELECT
    formal_order.id AS formal_order_id,
    COUNT(review_case.id) AS review_case_count,
    MIN(review_case.id) AS review_case_id,
    COALESCE(SUM(CASE WHEN review_case.status='APPROVED' THEN 1 ELSE 0 END),0)
      AS approved_case_count,
    COALESCE(SUM(CASE
      WHEN review_case.seller_organization_id<>formal_order.seller_organization_id
        THEN 1 ELSE 0 END),0) AS organization_mismatch_count
  FROM formal_orders formal_order
  LEFT JOIN review_cases review_case
    ON review_case.formal_order_id=formal_order.id
  GROUP BY formal_order.id
),
approval_facts AS (
  SELECT
    formal_order_id,
    SUM(CASE WHEN event_type='REVIEW_APPROVED' THEN 1 ELSE 0 END)
      AS approval_event_count,
    MIN(CASE WHEN event_type='REVIEW_APPROVED' THEN id END)
      AS approval_event_id,
    MIN(CASE WHEN event_type='REVIEW_APPROVED' THEN review_case_id END)
      AS approval_review_case_id,
    MIN(CASE WHEN event_type='REVIEW_APPROVED' THEN created_at END)
      AS approved_at,
    MIN(CASE WHEN event_type='REVIEW_APPROVED'
      THEN date(created_at / 1000, 'unixepoch', '+8 hours') END)
      AS approved_business_date,
    SUM(CASE WHEN event_type='BUYER_REFUND_BECAME_DUE' THEN 1 ELSE 0 END)
      AS buyer_due_event_count,
    MIN(CASE WHEN event_type='BUYER_REFUND_BECAME_DUE' THEN id END)
      AS buyer_due_event_id,
    MIN(CASE WHEN event_type='BUYER_REFUND_BECAME_DUE' THEN review_case_id END)
      AS buyer_due_review_case_id,
    MIN(CASE WHEN event_type='BUYER_REFUND_BECAME_DUE'
      THEN formal_order_financial_snapshot_id END) AS buyer_due_snapshot_id,
    SUM(CASE WHEN event_type='SELLER_SERVICE_FEE_ACCRUED' THEN 1 ELSE 0 END)
      AS service_fee_event_count,
    MIN(CASE WHEN event_type='SELLER_SERVICE_FEE_ACCRUED' THEN id END)
      AS service_fee_event_id,
    MIN(CASE WHEN event_type='SELLER_SERVICE_FEE_ACCRUED' THEN review_case_id END)
      AS service_fee_review_case_id,
    MIN(CASE WHEN event_type='SELLER_SERVICE_FEE_ACCRUED'
      THEN formal_order_financial_snapshot_id END) AS service_fee_snapshot_id
  FROM review_events
  WHERE event_type IN (
    'REVIEW_APPROVED',
    'BUYER_REFUND_BECAME_DUE',
    'SELLER_SERVICE_FEE_ACCRUED'
  )
  GROUP BY formal_order_id
),
payable_facts AS (
  SELECT
    balance.formal_order_id,
    SUM(CASE WHEN balance.payable_type='SELLER_PRINCIPAL' THEN 1 ELSE 0 END)
      AS principal_count,
    SUM(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE' THEN 1 ELSE 0 END)
      AS service_fee_count,
    MIN(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.seller_organization_id END) AS principal_organization_id,
    MIN(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.financial_snapshot_id END) AS principal_snapshot_id,
    MIN(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.source_type END) AS principal_source_type,
    MIN(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.source_id END) AS principal_source_id,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.seller_organization_id END) AS service_fee_organization_id,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.financial_snapshot_id END) AS service_fee_payable_snapshot_id,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.source_type END) AS service_fee_source_type,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.source_id END) AS service_fee_source_id,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.due_at END) AS service_fee_due_at,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.amount_cny_fen ELSE 0 END),0) AS principal_due,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.paid_amount_cny_fen ELSE 0 END),0) AS principal_collected,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.outstanding_amount_cny_fen ELSE 0 END),0) AS principal_outstanding,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.amount_cny_fen ELSE 0 END),0) AS service_fee_due,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.paid_amount_cny_fen ELSE 0 END),0) AS service_fee_collected,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.outstanding_amount_cny_fen ELSE 0 END),0) AS service_fee_outstanding
  FROM seller_payable_balances balance
  GROUP BY balance.formal_order_id
),
refund_facts AS (
  SELECT
    balance.formal_order_id,
    COUNT(*) AS refund_count,
    MIN(balance.source_review_event_id) AS refund_source_event_id,
    MIN(balance.review_case_id) AS refund_review_case_id,
    COALESCE(SUM(balance.due_amount_cny_fen),0) AS refund_due,
    COALESCE(SUM(balance.net_paid_cny_fen),0) AS refund_net_paid
  FROM buyer_refund_ledger_balances balance
  GROUP BY balance.formal_order_id
),
allocation_facts AS (
  SELECT
    payable.formal_order_id,
    COALESCE(SUM(net.net_amount_cny_fen),0) AS seller_attributed_cash
  FROM seller_payables payable
  JOIN seller_allocation_net_amounts net ON net.payable_id=payable.id
  JOIN seller_payments payment ON payment.id=net.payment_id
  LEFT JOIN seller_payment_reversals payment_reversal
    ON payment_reversal.payment_id=payment.id
  WHERE payment_reversal.id IS NULL
  GROUP BY payable.formal_order_id
),
cash_dates AS (
  SELECT formal_order_id, MAX(cash_business_date) AS last_cash_business_date
  FROM (
    SELECT
      payable.formal_order_id,
      date(payment.paid_at / 1000, 'unixepoch', '+8 hours') AS cash_business_date
    FROM seller_allocation_net_amounts net
    JOIN seller_payables payable ON payable.id=net.payable_id
    JOIN seller_payments payment ON payment.id=net.payment_id
    WHERE net.net_amount_cny_fen>0
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_reversals reversal
        WHERE reversal.payment_id=payment.id
      )
    UNION ALL
    SELECT
      obligation.formal_order_id,
      entry.china_business_date
    FROM buyer_refund_payment_entries entry
    JOIN buyer_refund_obligations obligation
      ON obligation.id=entry.obligation_id
  ) movements
  GROUP BY formal_order_id
),
base AS (
  SELECT
    formal_order.id AS formal_order_id,
    formal_order.amazon_order_number_normalized AS amazon_order_number,
    formal_order.seller_organization_id,
    formal_order.store_id,
    formal_order.product_id,
    formal_order.asin_normalized AS asin,
    formal_order.product_name_snapshot AS product_name,
    formal_order.review_type,
    formal_order.confirmed_at,
    formal_order.confirmed_business_date,
    approval.approved_at AS review_approved_at,
    approval.approved_business_date AS review_approved_business_date,
    cash_dates.last_cash_business_date,
    formal_order.final_paid_jpy,
    COALESCE(snapshot.snapshot_count,0) AS snapshot_count,
    snapshot.snapshot_id,
    snapshot.buyer_self_pay_bps,
    snapshot.buyer_self_pay_jpy,
    snapshot.buyer_expected_principal_cny_fen,
    snapshot.seller_expected_principal_cny_fen,
    snapshot.service_fee_cny_fen,
    COALESCE(review.review_case_count,0) AS review_case_count,
    review.review_case_id,
    COALESCE(review.approved_case_count,0) AS approved_case_count,
    COALESCE(review.organization_mismatch_count,0)
      AS review_organization_mismatch_count,
    COALESCE(approval.approval_event_count,0) AS approval_event_count,
    approval.approval_event_id,
    approval.approval_review_case_id,
    COALESCE(approval.buyer_due_event_count,0) AS buyer_due_event_count,
    approval.buyer_due_event_id,
    approval.buyer_due_review_case_id,
    approval.buyer_due_snapshot_id,
    COALESCE(approval.service_fee_event_count,0) AS service_fee_event_count,
    approval.service_fee_event_id,
    approval.service_fee_review_case_id,
    approval.service_fee_snapshot_id,
    COALESCE(payable.principal_count,0) AS principal_count,
    COALESCE(payable.service_fee_count,0) AS service_fee_count,
    payable.principal_organization_id,
    payable.principal_snapshot_id,
    payable.principal_source_type,
    payable.principal_source_id,
    payable.service_fee_organization_id,
    payable.service_fee_payable_snapshot_id,
    payable.service_fee_source_type,
    payable.service_fee_source_id,
    payable.service_fee_due_at,
    COALESCE(payable.principal_due,0) AS seller_principal_due_cny_fen,
    COALESCE(payable.principal_collected,0) AS seller_principal_collected_cny_fen,
    COALESCE(payable.principal_outstanding,0) AS seller_principal_outstanding_cny_fen,
    COALESCE(payable.service_fee_due,0) AS seller_service_fee_due_cny_fen,
    COALESCE(payable.service_fee_collected,0) AS seller_service_fee_collected_cny_fen,
    COALESCE(payable.service_fee_outstanding,0) AS seller_service_fee_outstanding_cny_fen,
    COALESCE(refund.refund_count,0) AS refund_count,
    refund.refund_source_event_id,
    refund.refund_review_case_id,
    COALESCE(refund.refund_due,0) AS buyer_refund_due_cny_fen,
    COALESCE(refund.refund_net_paid,0) AS buyer_refund_net_paid_cny_fen,
    COALESCE(allocation.seller_attributed_cash,0) AS seller_attributed_cash_cny_fen
  FROM formal_orders formal_order
  LEFT JOIN snapshot_facts snapshot ON snapshot.formal_order_id=formal_order.id
  LEFT JOIN review_facts review ON review.formal_order_id=formal_order.id
  LEFT JOIN approval_facts approval ON approval.formal_order_id=formal_order.id
  LEFT JOIN payable_facts payable ON payable.formal_order_id=formal_order.id
  LEFT JOIN refund_facts refund ON refund.formal_order_id=formal_order.id
  LEFT JOIN allocation_facts allocation ON allocation.formal_order_id=formal_order.id
  LEFT JOIN cash_dates ON cash_dates.formal_order_id=formal_order.id
),
classified AS (
  SELECT
    base.*,
    CASE WHEN snapshot_count=1 THEN
      seller_expected_principal_cny_fen + service_fee_cny_fen
        - buyer_expected_principal_cny_fen
      ELSE NULL END AS projected_gross_profit_cny_fen,
    CASE
      WHEN snapshot_count=0 THEN 'MISSING_FINANCIAL_SNAPSHOT'
      WHEN snapshot_count>1 THEN 'MULTIPLE_FINANCIAL_SNAPSHOTS'
      WHEN principal_count>1 OR service_fee_count>1 OR refund_count>1
        OR review_case_count>1 THEN 'LEDGER_CONFLICT'
      WHEN approved_case_count=0 AND approval_event_count=0 THEN 'PROJECTED_ONLY'
      WHEN approved_case_count<>1 OR approval_event_count<>1
        OR buyer_due_event_count<>1 OR service_fee_event_count<>1
        OR review_case_id<>approval_review_case_id
        OR review_case_id<>buyer_due_review_case_id
        OR review_case_id<>service_fee_review_case_id
        THEN 'REVIEW_APPROVAL_CONFLICT'
      WHEN principal_count=0 THEN 'MISSING_PRINCIPAL_PAYABLE'
      WHEN service_fee_count=0 THEN 'MISSING_SERVICE_FEE_PAYABLE'
      WHEN refund_count=0 THEN 'MISSING_BUYER_REFUND_OBLIGATION'
      WHEN review_organization_mismatch_count>0
        OR principal_organization_id<>seller_organization_id
        OR service_fee_organization_id<>seller_organization_id
        THEN 'SELLER_ORGANIZATION_MISMATCH'
      WHEN principal_snapshot_id<>snapshot_id
        OR principal_source_type<>'FORMAL_ORDER'
        OR principal_source_id<>formal_order_id
        OR service_fee_payable_snapshot_id<>snapshot_id
        OR service_fee_source_type<>'REVIEW_APPROVAL'
        OR service_fee_source_id<>review_case_id
        OR service_fee_due_at<>review_approved_at
        OR refund_source_event_id<>buyer_due_event_id
        OR refund_review_case_id<>review_case_id
        OR buyer_due_snapshot_id<>snapshot_id
        OR service_fee_snapshot_id<>snapshot_id
        THEN 'REVIEW_APPROVAL_CONFLICT'
      WHEN seller_principal_due_cny_fen<>seller_expected_principal_cny_fen
        OR seller_service_fee_due_cny_fen<>service_fee_cny_fen
        OR buyer_refund_due_cny_fen<>buyer_expected_principal_cny_fen
        THEN 'AMOUNT_MISMATCH'
      ELSE 'COMPLETED'
    END AS finance_status
  FROM base
)
SELECT
  formal_order_id, amazon_order_number, seller_organization_id,
  store_id, product_id, asin, product_name, review_type,
  confirmed_at, confirmed_business_date,
  review_approved_at, review_approved_business_date,
  last_cash_business_date, CAST(final_paid_jpy AS TEXT) AS final_paid_jpy,
  snapshot_id AS financial_snapshot_id,
  buyer_self_pay_bps,
  CASE WHEN buyer_self_pay_jpy IS NULL THEN NULL
    ELSE CAST(buyer_self_pay_jpy AS TEXT) END AS buyer_self_pay_jpy,
  CASE WHEN buyer_expected_principal_cny_fen IS NULL THEN NULL
    ELSE CAST(buyer_expected_principal_cny_fen AS TEXT)
    END AS buyer_expected_principal_cny_fen,
  CASE WHEN seller_expected_principal_cny_fen IS NULL THEN NULL
    ELSE CAST(seller_expected_principal_cny_fen AS TEXT)
    END AS seller_expected_principal_cny_fen,
  CASE WHEN service_fee_cny_fen IS NULL THEN NULL
    ELSE CAST(service_fee_cny_fen AS TEXT)
    END AS service_fee_snapshot_cny_fen,
  CASE WHEN projected_gross_profit_cny_fen IS NULL THEN NULL
    ELSE CAST(projected_gross_profit_cny_fen AS TEXT)
    END AS projected_gross_profit_cny_fen,
  CASE WHEN finance_status='COMPLETED' THEN CAST(
    seller_principal_due_cny_fen + seller_service_fee_due_cny_fen
      - buyer_refund_due_cny_fen AS TEXT)
    ELSE NULL END AS completed_gross_profit_cny_fen,
  CAST(seller_principal_due_cny_fen AS TEXT)
    AS seller_principal_due_cny_fen,
  CAST(seller_principal_collected_cny_fen AS TEXT)
    AS seller_principal_collected_cny_fen,
  CAST(seller_principal_outstanding_cny_fen AS TEXT)
    AS seller_principal_outstanding_cny_fen,
  CAST(seller_service_fee_due_cny_fen AS TEXT)
    AS seller_service_fee_due_cny_fen,
  CAST(seller_service_fee_collected_cny_fen AS TEXT)
    AS seller_service_fee_collected_cny_fen,
  CAST(seller_service_fee_outstanding_cny_fen AS TEXT)
    AS seller_service_fee_outstanding_cny_fen,
  CAST(buyer_refund_due_cny_fen AS TEXT) AS buyer_refund_due_cny_fen,
  CAST(buyer_refund_net_paid_cny_fen AS TEXT)
    AS buyer_refund_net_paid_cny_fen,
  CAST(CASE WHEN buyer_refund_due_cny_fen>buyer_refund_net_paid_cny_fen
    THEN buyer_refund_due_cny_fen-buyer_refund_net_paid_cny_fen
    ELSE 0 END AS TEXT) AS buyer_refund_outstanding_cny_fen,
  CAST(CASE WHEN buyer_refund_net_paid_cny_fen>buyer_refund_due_cny_fen
    THEN buyer_refund_net_paid_cny_fen-buyer_refund_due_cny_fen
    ELSE 0 END AS TEXT) AS buyer_refund_overpaid_cny_fen,
  CAST(seller_attributed_cash_cny_fen-buyer_refund_net_paid_cny_fen AS TEXT)
    AS attributed_cash_net_cny_fen,
  finance_status
FROM classified;


-- ===== recreated unchanged (their subject tables were rebuilt) =====
CREATE TRIGGER trg_buyer_customer_marketplace_default
AFTER INSERT ON buyer_customers
BEGIN
  INSERT INTO buyer_marketplace_assignments (
    buyer_customer_id, marketplace_code, version, created_at, updated_at
  ) VALUES (NEW.id, 'AMAZON_JP', 1, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER trg_customer_account_persona_after_buyer
AFTER INSERT ON buyer_customers
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT account.id, NEW.identity_subject_id, 'BUYER', NEW.id, NULL, NEW.created_at
  FROM customer_login_accounts account
  WHERE account.identity_subject_id=NEW.identity_subject_id;
END;

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

CREATE TRIGGER trg_customer_account_identity_rebind_guard
BEFORE UPDATE OF identity_subject_id ON customer_login_accounts
WHEN OLD.identity_subject_id<>NEW.identity_subject_id AND NOT (
  (SELECT COUNT(*) FROM customer_account_personas
    WHERE account_id=OLD.id)=1
  AND EXISTS (
    SELECT 1 FROM customer_account_personas
    WHERE account_id=OLD.id AND persona_type='BUYER'
  )
  AND EXISTS (
    SELECT 1 FROM buyer_customers
    WHERE identity_subject_id=NEW.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_rebind_requires_owner_conflict_workflow');
END;

CREATE TRIGGER trg_customer_account_identity_rebind_persona_sync
AFTER UPDATE OF identity_subject_id ON customer_login_accounts
WHEN OLD.identity_subject_id<>NEW.identity_subject_id
BEGIN
  UPDATE customer_account_personas
  SET identity_subject_id=NEW.identity_subject_id,
    buyer_customer_id=(
      SELECT id FROM buyer_customers
      WHERE identity_subject_id=NEW.identity_subject_id
    )
  WHERE account_id=NEW.id AND persona_type='BUYER';
END;

CREATE TRIGGER trg_customer_account_persona_after_account_buyer
AFTER INSERT ON customer_login_accounts
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT NEW.id, NEW.identity_subject_id, 'BUYER', buyer.id, NULL, NEW.created_at
  FROM buyer_customers buyer
  WHERE buyer.identity_subject_id=NEW.identity_subject_id;
END;

CREATE TRIGGER trg_customer_account_persona_source_guard
BEFORE INSERT ON customer_account_personas
WHEN NOT EXISTS (
  SELECT 1 FROM customer_login_accounts account
  WHERE account.id=NEW.account_id
    AND account.identity_subject_id=NEW.identity_subject_id
)
OR (
  NEW.persona_type='BUYER' AND NOT EXISTS (
    SELECT 1 FROM buyer_customers buyer
    WHERE buyer.id=NEW.buyer_customer_id
      AND buyer.identity_subject_id=NEW.identity_subject_id
  )
)
OR (
  NEW.persona_type='SELLER_MEMBER' AND NOT EXISTS (
    SELECT 1 FROM seller_organization_members member
    WHERE member.id=NEW.seller_member_id
      AND member.identity_subject_id=NEW.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_persona_source_mismatch');
END;

CREATE TRIGGER trg_customer_account_personas_no_update
BEFORE UPDATE ON customer_account_personas
WHEN NOT (
  OLD.persona_type='BUYER'
  AND NEW.account_id=OLD.account_id
  AND NEW.persona_type=OLD.persona_type
  AND NEW.seller_member_id IS NULL
  AND NEW.created_at=OLD.created_at
  AND EXISTS (
    SELECT 1 FROM customer_login_accounts account
    JOIN buyer_customers buyer
      ON buyer.identity_subject_id=account.identity_subject_id
    WHERE account.id=NEW.account_id
      AND buyer.id=NEW.buyer_customer_id
      AND NEW.identity_subject_id=account.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_personas_are_immutable');
END;

CREATE TRIGGER trg_buyer_invitation_consumed_link_acquisition_lead
AFTER UPDATE OF status ON customer_buyer_invitations
WHEN NEW.status='CONSUMED' AND OLD.status='ACTIVE'
BEGIN
  INSERT OR IGNORE INTO acquisition_lead_links(
    id,lead_id,link_type,target_id,linked_at
  )
  SELECT 'm50-buyer-link-' || lower(hex(randomblob(16))),
    mapping.acquisition_lead_id,
    'BUYER_CUSTOMER',
    buyer.id,
    COALESCE(NEW.consumed_at,CAST(unixepoch('now') AS INTEGER)*1000)
  FROM customer_buyer_invitation_lead_links mapping
  JOIN customer_login_accounts account ON account.id=NEW.consumed_by_account_id
  JOIN buyer_customers buyer ON buyer.identity_subject_id=account.identity_subject_id
  JOIN acquisition_leads lead ON lead.id=mapping.acquisition_lead_id
  WHERE mapping.invitation_id=NEW.id
    AND lead.lead_type='BUYER'
    AND lead.status='ACTIVE';
END;

CREATE TRIGGER trg_review_event_identity_guard
BEFORE INSERT ON review_events
WHEN
  NOT EXISTS (
    SELECT 1
    FROM review_cases review_case
    JOIN review_evidence_versions evidence
      ON evidence.id=NEW.evidence_version_id
      AND evidence.review_case_id=review_case.id
      AND evidence.formal_order_id=review_case.formal_order_id
    WHERE review_case.id=NEW.review_case_id
      AND review_case.formal_order_id=NEW.formal_order_id
      AND review_case.status=NEW.next_status
      AND review_case.version=NEW.case_version
      AND evidence.version_no=review_case.current_evidence_version_no
  )
  OR (
    NEW.event_type='BUYER_REFUND_BECAME_DUE'
    AND NOT EXISTS (
      SELECT 1
      FROM formal_order_financial_snapshots snapshot
      WHERE snapshot.id=NEW.formal_order_financial_snapshot_id
        AND snapshot.formal_order_id=NEW.formal_order_id
        AND snapshot.buyer_expected_principal_cny_fen=NEW.amount_cny_fen
    )
  )
  OR (
    NEW.event_type='SELLER_SERVICE_FEE_ACCRUED'
    AND NOT EXISTS (
      SELECT 1
      FROM formal_order_financial_snapshots snapshot
      WHERE snapshot.id=NEW.formal_order_financial_snapshot_id
        AND snapshot.formal_order_id=NEW.formal_order_id
        AND snapshot.service_fee_cny_fen=NEW.amount_cny_fen
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'review_event_identity_mismatch');
END;

CREATE TRIGGER trg_advance_principal_full_payment_amount_guard
BEFORE INSERT ON buyer_advance_principal_entries
WHEN NEW.entry_type='PAYMENT' AND NOT EXISTS(
  SELECT 1
  FROM formal_order_financial_snapshots snapshot
  WHERE snapshot.formal_order_id=NEW.formal_order_id
    AND snapshot.buyer_expected_principal_cny_fen=NEW.amount_cny_fen
    AND snapshot.buyer_expected_principal_cny_fen>0
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_payment_must_equal_snapshot');
END;

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

CREATE TRIGGER trg_buyer_number_events_no_delete
BEFORE DELETE ON buyer_number_allocation_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_number_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_number_events_no_update
BEFORE UPDATE ON buyer_number_allocation_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_number_events_are_immutable');
END;


UPDATE app_schema_state
SET
  schema_version=27,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
