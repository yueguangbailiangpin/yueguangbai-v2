PRAGMA foreign_keys=OFF;

-- Owner ruling 2026-09-01 (schema 42): expand the runtime marketplace set to
-- the five approved platforms. RAKUTEN_JP, YAHOO_JP, TEMU_JP and TIKTOK_JP
-- join AMAZON_JP and the already-registered AMAZON_US as ACTIVE/AVAILABLE
-- registries; COUPANG_KR stays DISABLED fail-closed. Reservation eligibility
-- auto-opens with registry enablement per the same ruling.
--
-- The five marketplace CHECK allowlists (marketplace_registry,
-- formal_orders, seller_service_fee_rule_versions,
-- formal_order_financial_snapshots, staff_work_items) are rebuilt with the
-- seven-code list; every index is recreated verbatim. Views and triggers
-- in the transitive reference closure of the rebuilt tables are dropped
-- up-front and recreated at the end. historical_orders stays frozen to
-- AMAZON_JP by design.

DROP VIEW IF EXISTS "formal_order_effective_operational_state";

DROP VIEW IF EXISTS "internal_finance_cash_movements";

DROP VIEW IF EXISTS "internal_finance_exceptions";

DROP VIEW IF EXISTS "internal_order_finance_positions";

DROP TRIGGER IF EXISTS trg_formal_order_non_jp_local_date_required;

DROP TRIGGER IF EXISTS trg_formal_orders_no_delete;

DROP TRIGGER IF EXISTS trg_formal_orders_no_update;

DROP TRIGGER IF EXISTS trg_buyer_refund_obligation_source_guard;

DROP TRIGGER IF EXISTS trg_formal_order_event_identity_guard;

DROP TRIGGER IF EXISTS trg_review_case_source_guard;

DROP TRIGGER IF EXISTS trg_buyer_refund_obligation_requires_normal_order;

DROP TRIGGER IF EXISTS trg_review_approval_requires_normal_order;

DROP TRIGGER IF EXISTS trg_review_service_fee_requires_normal_order;

DROP TRIGGER IF EXISTS trg_seller_service_fee_rule_no_delete;

DROP TRIGGER IF EXISTS trg_seller_service_fee_rule_no_update;

DROP TRIGGER IF EXISTS trg_formal_order_financial_snapshots_no_delete;

DROP TRIGGER IF EXISTS trg_formal_order_financial_snapshots_no_update;

DROP TRIGGER IF EXISTS trg_formal_order_financial_snapshot_guard;

DROP TRIGGER IF EXISTS trg_seller_principal_rate_snapshot_confirmation_guard;

DROP TRIGGER IF EXISTS trg_seller_principal_rate_snapshot_guard;

DROP TRIGGER IF EXISTS trg_buyer_marketplace_assignment_fact_guard;

DROP TRIGGER IF EXISTS trg_review_event_identity_guard;

DROP TRIGGER IF EXISTS trg_advance_principal_full_payment_amount_guard;

DROP TRIGGER IF EXISTS trg_seller_payable_source_guard;

DROP TRIGGER IF EXISTS trg_formal_order_financial_self_pay_guard;

DROP TRIGGER IF EXISTS trg_formal_order_instruction_guard;

DROP TRIGGER IF EXISTS trg_formal_order_source_guard;

DROP TRIGGER IF EXISTS trg_order_archive_closure_insert_guard;

DROP TRIGGER IF EXISTS trg_order_archive_closure_reclose_source_guard;

DROP TRIGGER IF EXISTS trg_order_instruction_historical_marker_guard;

DROP TRIGGER IF EXISTS trg_staff_work_item_marketplace_after_insert;

DROP TRIGGER IF EXISTS trg_staff_work_items_assignment_guard;

DROP TRIGGER IF EXISTS trg_staff_work_items_no_delete;

DROP TRIGGER IF EXISTS trg_staff_work_items_update_guard;

-- 重建 marketplace_registry：code/platform 清单扩容 + 四平台新种子（Owner 2026-09-01 五平台裁决）

CREATE TABLE "marketplace_registry__0042_new" (
  code TEXT PRIMARY KEY CHECK (code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','YAHOO_JP','TEMU_JP','TIKTOK_JP')),
  platform_code TEXT NOT NULL CHECK (platform_code IN ('AMAZON','COUPANG','RAKUTEN','YAHOO','TEMU','TIKTOK')),
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
    OR (code='RAKUTEN_JP' AND platform_code='RAKUTEN'
      AND region_code='JP' AND transaction_currency_code='JPY')
    OR (code='YAHOO_JP' AND platform_code='YAHOO'
      AND region_code='JP' AND transaction_currency_code='JPY')
    OR (code='TEMU_JP' AND platform_code='TEMU'
      AND region_code='JP' AND transaction_currency_code='JPY')
    OR (code='TIKTOK_JP' AND platform_code='TIKTOK'
      AND region_code='JP' AND transaction_currency_code='JPY')
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

INSERT INTO "marketplace_registry__0042_new" ("code","platform_code","region_code","transaction_currency_code","status","adapter_status","display_name_zh","business_timezone","reporting_timezone","seller_portal_status","buyer_portal_status","created_at","updated_at") SELECT "code","platform_code","region_code","transaction_currency_code","status","adapter_status","display_name_zh","business_timezone","reporting_timezone","seller_portal_status","buyer_portal_status","created_at","updated_at" FROM marketplace_registry;

DROP TABLE marketplace_registry;

ALTER TABLE "marketplace_registry__0042_new" RENAME TO marketplace_registry;

INSERT INTO marketplace_registry (code,platform_code,region_code,transaction_currency_code,status,adapter_status,display_name_zh,business_timezone,reporting_timezone,seller_portal_status,buyer_portal_status,created_at,updated_at) VALUES

  ('RAKUTEN_JP','RAKUTEN','JP','JPY','ACTIVE','AVAILABLE','乐天日本站','Asia/Tokyo','Asia/Shanghai','ACTIVE','ACTIVE',1787661495000,1787661495000),

  ('YAHOO_JP','YAHOO','JP','JPY','ACTIVE','AVAILABLE','雅虎日本站','Asia/Tokyo','Asia/Shanghai','ACTIVE','ACTIVE',1787661495000,1787661495000),

  ('TEMU_JP','TEMU','JP','JPY','ACTIVE','AVAILABLE','TEMU 日本站','Asia/Tokyo','Asia/Shanghai','ACTIVE','ACTIVE',1787661495000,1787661495000),

  ('TIKTOK_JP','TIKTOK','JP','JPY','ACTIVE','AVAILABLE','TikTok 日本站','Asia/Tokyo','Asia/Shanghai','ACTIVE','ACTIVE',1787661495000,1787661495000);

-- 重建 formal_orders：marketplace CHECK 扩容为七码（索引 12 原样重建；触发器统一在尾部重建）
CREATE TABLE "formal_orders__0042_new" (
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
    REFERENCES seller_stores(id), product_id TEXT NOT NULL
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
  ), marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP'
  REFERENCES marketplace_registry(code)
  CHECK (marketplace_code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','YAHOO_JP','TEMU_JP','TIKTOK_JP')), marketplace_business_date TEXT CHECK (
  marketplace_business_date IS NULL OR (
    marketplace_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(marketplace_business_date)=marketplace_business_date
  )
)) STRICT;
INSERT INTO "formal_orders__0042_new" ("id","order_evidence_submission_id","order_evidence_version_id","reservation_id","demand_batch_id","buyer_customer_id","buyer_customer_no","seller_organization_id","store_id","product_id","product_version_id","product_version_no","asin_display","asin_normalized","product_name_snapshot","review_type","amazon_order_number_raw","amazon_order_number_normalized","final_paid_jpy","status","version","confirmed_by_staff_id","confirmed_at","confirmed_business_date","created_at","order_instruction_id","order_instruction_version_id","amazon_order_date","marketplace_code","marketplace_business_date") SELECT "id","order_evidence_submission_id","order_evidence_version_id","reservation_id","demand_batch_id","buyer_customer_id","buyer_customer_no","seller_organization_id","store_id","product_id","product_version_id","product_version_no","asin_display","asin_normalized","product_name_snapshot","review_type","amazon_order_number_raw","amazon_order_number_normalized","final_paid_jpy","status","version","confirmed_by_staff_id","confirmed_at","confirmed_business_date","created_at","order_instruction_id","order_instruction_version_id","amazon_order_date","marketplace_code","marketplace_business_date" FROM "formal_orders";
DROP TABLE "formal_orders";
ALTER TABLE "formal_orders__0042_new" RENAME TO "formal_orders";
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
ON formal_orders(marketplace_code,confirmed_business_date,id);
CREATE INDEX idx_formal_orders_confirmed_business_date
ON formal_orders (confirmed_business_date, id);
CREATE INDEX idx_formal_orders_instruction
ON formal_orders (order_instruction_id, order_instruction_version_id, id);
CREATE INDEX idx_formal_orders_marketplace_business_date
ON formal_orders(marketplace_code,marketplace_business_date,id);
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
CREATE INDEX idx_formal_orders_confirmed_id
ON formal_orders (confirmed_at, id);
CREATE INDEX idx_formal_orders_buyer_no
ON formal_orders (buyer_customer_no);
CREATE INDEX idx_formal_orders_amazon_prefix
ON formal_orders (amazon_order_number_normalized, confirmed_at, id);
CREATE INDEX idx_formal_orders_market_confirmed_id
ON formal_orders (marketplace_code, confirmed_at DESC, id DESC);

-- 重建 seller_service_fee_rule_versions：marketplace CHECK 扩容为七码（索引 1 原样重建；触发器统一在尾部重建）
CREATE TABLE "seller_service_fee_rule_versions__0042_new" (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code)
    CHECK (marketplace_code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','YAHOO_JP','TEMU_JP','TIKTOK_JP')),
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
INSERT INTO "seller_service_fee_rule_versions__0042_new" ("id","seller_organization_id","marketplace_code","review_type","version_no","fee_amount_minor","fee_currency_code","fee_currency_exponent","effective_from","created_by_staff_id","created_at") SELECT "id","seller_organization_id","marketplace_code","review_type","version_no","fee_amount_minor","fee_currency_code","fee_currency_exponent","effective_from","created_by_staff_id","created_at" FROM "seller_service_fee_rule_versions";
DROP TABLE "seller_service_fee_rule_versions";
ALTER TABLE "seller_service_fee_rule_versions__0042_new" RENAME TO "seller_service_fee_rule_versions";
CREATE INDEX idx_seller_service_fee_rule_resolution
ON seller_service_fee_rule_versions (
  seller_organization_id, marketplace_code, review_type,
  effective_from DESC, version_no DESC
);

-- 重建 formal_order_financial_snapshots：marketplace CHECK 扩容为七码（索引 1 原样重建；触发器统一在尾部重建）
CREATE TABLE "formal_order_financial_snapshots__0042_new" (
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
    CHECK (marketplace_code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','YAHOO_JP','TEMU_JP','TIKTOK_JP')),
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
INSERT INTO "formal_order_financial_snapshots__0042_new" ("id","formal_order_id","snapshot_version","buyer_customer_id","seller_organization_id","store_id","marketplace_code","review_type","platform_order_identifier","platform_product_identifier","platform_order_date","payment_amount_minor","payment_currency_code","payment_currency_exponent","buyer_rate_version_id","buyer_rate_version_no","buyer_rate_business_date","buyer_rate_confirmed_at","buyer_rate_value","buyer_rate_scale","source_currency_code","quote_currency_code","source_currency_exponent","quote_currency_exponent","service_fee_rule_version_id","service_fee_version_no","service_fee_effective_from","service_fee_confirmed_at","service_fee_cny_fen","service_fee_currency_code","buyer_expected_principal_cny_fen","seller_expected_principal_cny_fen","buyer_self_pay_bps","buyer_self_pay_jpy","buyer_refundable_principal_jpy","buyer_gross_principal_cny_fen","buyer_self_pay_contribution_cny_fen","rounding_rule","created_at") SELECT "id","formal_order_id","snapshot_version","buyer_customer_id","seller_organization_id","store_id","marketplace_code","review_type","platform_order_identifier","platform_product_identifier","platform_order_date","payment_amount_minor","payment_currency_code","payment_currency_exponent","buyer_rate_version_id","buyer_rate_version_no","buyer_rate_business_date","buyer_rate_confirmed_at","buyer_rate_value","buyer_rate_scale","source_currency_code","quote_currency_code","source_currency_exponent","quote_currency_exponent","service_fee_rule_version_id","service_fee_version_no","service_fee_effective_from","service_fee_confirmed_at","service_fee_cny_fen","service_fee_currency_code","buyer_expected_principal_cny_fen","seller_expected_principal_cny_fen","buyer_self_pay_bps","buyer_self_pay_jpy","buyer_refundable_principal_jpy","buyer_gross_principal_cny_fen","buyer_self_pay_contribution_cny_fen","rounding_rule","created_at" FROM "formal_order_financial_snapshots";
DROP TABLE "formal_order_financial_snapshots";
ALTER TABLE "formal_order_financial_snapshots__0042_new" RENAME TO "formal_order_financial_snapshots";
CREATE INDEX idx_formal_order_financial_snapshots_order
ON formal_order_financial_snapshots (
  buyer_customer_id, created_at, formal_order_id
);

-- 重建 staff_work_items：marketplace CHECK 扩容为七码（索引 6 原样重建；触发器统一在尾部重建）
CREATE TABLE "staff_work_items__0042_new" (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  work_type TEXT NOT NULL CHECK (work_type IN (
    'PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW','RESERVATION_DECISION',
    'ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW','REVIEW_DECISION',
    'BUYER_REFUND_PROCESSING'
  )),
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN (
    'PRODUCT_APPLICATION','DEMAND_BATCH','RESERVATION','ORDER_INSTRUCTION',
    'ORDER_EVIDENCE','REVIEW_CASE','BUYER_REFUND_OBLIGATION'
  )),
  source_entity_id TEXT NOT NULL CHECK (length(source_entity_id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT REFERENCES buyer_customers(id),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  store_id TEXT REFERENCES seller_stores(id),
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'SELLER_ACCOUNT_MANAGER','BUYER_PRE_SALES_OWNER','BUYER_REFUND_OWNER'
  )),
  fixed_assignment_type TEXT NOT NULL CHECK (
    fixed_assignment_type IN ('BUYER','SELLER')
  ),
  fixed_assignment_id TEXT NOT NULL CHECK (length(fixed_assignment_id) BETWEEN 1 AND 200),
  assigned_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER,
  cancelled_at INTEGER, marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','YAHOO_JP','TEMU_JP','TIKTOK_JP'
  )),
  CHECK (
    (work_type IN ('PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW')
      AND source_entity_type IN ('PRODUCT_APPLICATION','DEMAND_BATCH')
      AND duty_code='SELLER_ACCOUNT_MANAGER'
      AND fixed_assignment_type='SELLER'
      AND seller_organization_id IS NOT NULL)
    OR
    (work_type IN (
        'RESERVATION_DECISION','ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW'
      )
      AND source_entity_type IN (
        'RESERVATION','ORDER_INSTRUCTION','ORDER_EVIDENCE'
      )
      AND duty_code='BUYER_PRE_SALES_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
    OR
    (work_type='REVIEW_DECISION'
      AND source_entity_type='REVIEW_CASE'
      AND duty_code='BUYER_REFUND_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
    OR
    (work_type='BUYER_REFUND_PROCESSING'
      AND source_entity_type='BUYER_REFUND_OBLIGATION'
      AND duty_code='BUYER_REFUND_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
  ),
  CHECK (
    (status='OPEN' AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (status='COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='CANCELLED' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  )
) STRICT;
INSERT INTO "staff_work_items__0042_new" ("id","work_type","source_entity_type","source_entity_id","buyer_customer_id","seller_organization_id","store_id","duty_code","fixed_assignment_type","fixed_assignment_id","assigned_staff_id","status","version","created_at","updated_at","completed_at","cancelled_at","marketplace_code") SELECT "id","work_type","source_entity_type","source_entity_id","buyer_customer_id","seller_organization_id","store_id","duty_code","fixed_assignment_type","fixed_assignment_id","assigned_staff_id","status","version","created_at","updated_at","completed_at","cancelled_at","marketplace_code" FROM "staff_work_items";
DROP TABLE "staff_work_items";
ALTER TABLE "staff_work_items__0042_new" RENAME TO "staff_work_items";
CREATE INDEX idx_staff_work_items_assignee_status
ON staff_work_items (assigned_staff_id,status,created_at,id);
CREATE INDEX idx_staff_work_items_buyer_status
ON staff_work_items (buyer_customer_id,status,duty_code,id)
WHERE buyer_customer_id IS NOT NULL;
CREATE INDEX idx_staff_work_items_marketplace_status
ON staff_work_items(marketplace_code,status,work_type,created_at,id);
CREATE INDEX idx_staff_work_items_seller_status
ON staff_work_items (seller_organization_id,status,duty_code,id)
WHERE seller_organization_id IS NOT NULL;
CREATE INDEX idx_staff_work_items_status_created
ON staff_work_items (status, created_at, id);
CREATE UNIQUE INDEX uq_staff_work_item_open_source
ON staff_work_items (source_entity_type,source_entity_id,work_type)
WHERE status='OPEN';

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

CREATE VIEW internal_finance_cash_movements AS
SELECT
  payment.id AS movement_id,
  'SELLER_PAYMENT' AS movement_type,
  payment.seller_organization_id,
  NULL AS formal_order_id,
  payment.paid_at AS occurred_at,
  date(payment.paid_at / 1000, 'unixepoch', '+8 hours') AS cash_business_date,
  payment.amount_cny_fen AS amount_cny_fen
FROM seller_payments payment
UNION ALL
SELECT
  reversal.id,
  'SELLER_PAYMENT_REVERSAL',
  reversal.seller_organization_id,
  NULL,
  reversal.reversed_at,
  date(reversal.reversed_at / 1000, 'unixepoch', '+8 hours'),
  reversal.amount_cny_fen
FROM seller_payment_reversals reversal
UNION ALL
SELECT
  entry.id,
  CASE WHEN entry.entry_type='PAYMENT'
    THEN 'BUYER_REFUND_PAYMENT' ELSE 'BUYER_REFUND_REVERSAL' END,
  formal_order.seller_organization_id,
  obligation.formal_order_id,
  CASE WHEN entry.entry_type='PAYMENT' THEN entry.paid_at ELSE entry.reversed_at END,
  entry.china_business_date,
  entry.amount_cny_fen
FROM buyer_refund_payment_entries entry
JOIN buyer_refund_obligations obligation ON obligation.id=entry.obligation_id
JOIN formal_orders formal_order ON formal_order.id=obligation.formal_order_id
WHERE NOT EXISTS(
  SELECT 1
  FROM buyer_advance_principal_settlements settlement
  WHERE settlement.buyer_refund_payment_entry_id=CASE
    WHEN entry.entry_type='PAYMENT' THEN entry.id
    ELSE entry.original_payment_entry_id
  END
)
UNION ALL
SELECT
  entry.id,
  CASE WHEN entry.entry_type='PAYMENT'
    THEN 'BUYER_ADVANCE_PAYMENT' ELSE 'BUYER_ADVANCE_REVERSAL' END,
  formal_order.seller_organization_id,
  entry.formal_order_id,
  CASE WHEN entry.entry_type='PAYMENT' THEN entry.paid_at ELSE entry.reversed_at END,
  entry.china_business_date,
  entry.amount_cny_fen
FROM buyer_advance_principal_entries entry
JOIN formal_orders formal_order ON formal_order.id=entry.formal_order_id;

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

CREATE TRIGGER trg_formal_order_non_jp_local_date_required
BEFORE INSERT ON formal_orders
WHEN COALESCE(NEW.marketplace_code,'AMAZON_JP')<>'AMAZON_JP'
  AND NEW.marketplace_business_date IS NULL
BEGIN
  SELECT RAISE(ABORT,'formal_order_marketplace_business_date_required');
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

CREATE TRIGGER trg_review_case_source_guard
BEFORE INSERT ON review_cases
WHEN NOT EXISTS (
  SELECT 1
  FROM formal_orders formal_order
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.status='CONFIRMED'
    AND formal_order.buyer_customer_id=NEW.buyer_customer_id
    AND formal_order.seller_organization_id=NEW.seller_organization_id
    AND formal_order.review_type=NEW.review_type
    AND NEW.status='PENDING_REVIEW'
    AND NEW.current_evidence_version_no=1
    AND NEW.version=1
)
BEGIN
  SELECT RAISE(ABORT, 'review_case_source_mismatch');
END;

CREATE TRIGGER trg_buyer_refund_obligation_requires_normal_order
BEFORE INSERT ON buyer_refund_obligations
WHEN COALESCE((
  SELECT state.operational_state
  FROM formal_order_effective_operational_state state
  WHERE state.formal_order_id=NEW.formal_order_id
),'NORMAL')<>'NORMAL'
BEGIN
  SELECT RAISE(ABORT,'buyer_refund_obligation_blocked_by_order_operational_state');
END;

CREATE TRIGGER trg_review_approval_requires_normal_order
BEFORE UPDATE OF status ON review_cases
WHEN NEW.status='APPROVED' AND OLD.status<>'APPROVED'
  AND COALESCE((
    SELECT state.operational_state
    FROM formal_order_effective_operational_state state
    WHERE state.formal_order_id=NEW.formal_order_id
  ),'NORMAL')<>'NORMAL'
BEGIN
  SELECT RAISE(ABORT,'review_approval_blocked_by_order_operational_state');
END;

CREATE TRIGGER trg_review_service_fee_requires_normal_order
BEFORE INSERT ON seller_payables
WHEN NEW.source_type='REVIEW_APPROVAL'
  AND COALESCE((
    SELECT state.operational_state
    FROM formal_order_effective_operational_state state
    WHERE state.formal_order_id=NEW.formal_order_id
  ),'NORMAL')<>'NORMAL'
BEGIN
  SELECT RAISE(ABORT,'seller_service_fee_blocked_by_order_operational_state');
END;

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

CREATE TRIGGER trg_formal_order_instruction_guard
BEFORE INSERT ON formal_orders
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM order_instructions instruction
    JOIN order_instruction_versions instruction_version
      ON instruction_version.id=NEW.order_instruction_version_id
      AND instruction_version.instruction_id=instruction.id
    JOIN order_evidence_versions evidence
      ON evidence.id=NEW.order_evidence_version_id
      AND evidence.order_instruction_id=instruction.id
      AND evidence.order_instruction_version_id=instruction_version.id
    WHERE instruction.id=NEW.order_instruction_id
      AND instruction.reservation_id=NEW.reservation_id
      AND instruction.status='ACTIVE'
      AND instruction.current_version_no=instruction_version.version_no
  )
  OR (
    NEW.order_instruction_id IS NULL
    AND NEW.order_instruction_version_id IS NULL
    AND EXISTS (
      SELECT 1 FROM order_instruction_reconciliation_markers marker
      WHERE marker.reservation_id=NEW.reservation_id
        AND marker.disposition='HISTORICAL_EVIDENCE_CONTEXT'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_instruction_mismatch');
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

CREATE TRIGGER trg_order_archive_closure_insert_guard
BEFORE INSERT ON order_archive_closures
WHEN NEW.status<>'CLOSED' OR NEW.version<>1 OR NEW.created_at<>NEW.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.confirmed_at<=NEW.business_closed_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.closed_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  )
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED'
      AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id
          AND entry.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund
    WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;

CREATE TRIGGER trg_order_archive_closure_reclose_source_guard
BEFORE UPDATE ON order_archive_closures
WHEN OLD.status='REOPENED' AND NEW.status='CLOSED' AND (
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.confirmed_at<=NEW.business_closed_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.closed_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  )
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED'
      AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id
          AND entry.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund
    WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
)
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;

CREATE TRIGGER trg_order_instruction_historical_marker_guard
BEFORE INSERT ON order_instruction_reconciliation_markers
WHEN NEW.disposition='HISTORICAL_EVIDENCE_CONTEXT' AND NOT (
  EXISTS (
    SELECT 1 FROM order_evidence_versions evidence
    WHERE evidence.reservation_id=NEW.reservation_id
      AND evidence.order_instruction_id IS NULL
      AND evidence.order_instruction_version_id IS NULL
      AND evidence.instruction_deadline_snapshot IS NULL
      AND evidence.reference_order_amount_jpy_snapshot IS NULL
      AND evidence.buyer_self_pay_bps_snapshot IS NULL
      AND evidence.buyer_self_pay_jpy IS NULL
      AND evidence.buyer_refundable_principal_jpy IS NULL
      AND evidence.price_mismatch IS NULL
      AND evidence.price_difference_jpy IS NULL
      AND evidence.submitted_before_deadline IS NULL
  )
  OR (
    NEW.instruction_id IS NULL
    AND json_extract(NEW.metadata_json,'$.controlled_reconciliation')=1
    AND json_extract(NEW.metadata_json,'$.schema_version')=21
    AND EXISTS (
      SELECT 1
      FROM product_reservations reservation
      JOIN app_schema_state schema_state ON schema_state.singleton_id=1
      WHERE reservation.id=NEW.reservation_id
        AND reservation.status='APPROVED'
        AND reservation.submitted_at<schema_state.installed_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_instructions instruction
      WHERE instruction.reservation_id=NEW.reservation_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_evidence_versions evidence
      WHERE evidence.reservation_id=NEW.reservation_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM formal_orders formal_order
      WHERE formal_order.reservation_id=NEW.reservation_id
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'historical_evidence_marker_requires_existing_context');
END;

CREATE TRIGGER trg_staff_work_item_marketplace_after_insert
AFTER INSERT ON staff_work_items
BEGIN
  UPDATE staff_work_items
  SET marketplace_code = COALESCE(
    (
      SELECT mapping.marketplace_code
      FROM seller_store_marketplaces mapping
      WHERE mapping.store_id=NEW.store_id
      ORDER BY mapping.marketplace_code
      LIMIT 1
    ),
    (
      SELECT assignment.marketplace_code
      FROM buyer_marketplace_assignments assignment
      WHERE assignment.buyer_customer_id=NEW.buyer_customer_id
      ORDER BY assignment.marketplace_code
      LIMIT 1
    ),
    NEW.marketplace_code
  )
  WHERE id=NEW.id;
END;

CREATE TRIGGER trg_staff_work_items_assignment_guard
BEFORE INSERT ON staff_work_items
WHEN NOT (
  (NEW.fixed_assignment_type='BUYER' AND EXISTS (
    SELECT 1 FROM buyer_staff_assignments assignment
    WHERE assignment.id=NEW.fixed_assignment_id
      AND assignment.buyer_customer_id=NEW.buyer_customer_id
      AND assignment.duty_code=NEW.duty_code
      AND assignment.staff_id=NEW.assigned_staff_id
      AND assignment.status='ACTIVE'
  ))
  OR
  (NEW.fixed_assignment_type='SELLER' AND EXISTS (
    SELECT 1 FROM seller_staff_assignments assignment
    WHERE assignment.id=NEW.fixed_assignment_id
      AND assignment.seller_organization_id=NEW.seller_organization_id
      AND assignment.duty_code=NEW.duty_code
      AND assignment.staff_id=NEW.assigned_staff_id
      AND assignment.status='ACTIVE'
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'staff_work_item_assignment_mismatch');
END;

CREATE TRIGGER trg_staff_work_items_no_delete
BEFORE DELETE ON staff_work_items
BEGIN
  SELECT RAISE(ABORT, 'staff_work_items_are_immutable');
END;

CREATE TRIGGER trg_staff_work_items_update_guard
BEFORE UPDATE ON staff_work_items
WHEN NOT (
  (
    OLD.status='OPEN'
    AND NEW.status IN ('OPEN','COMPLETED','CANCELLED')
    AND NEW.version=OLD.version+1
    AND NEW.updated_at>=OLD.updated_at
    AND NEW.id IS OLD.id
    AND NEW.work_type IS OLD.work_type
    AND NEW.source_entity_type IS OLD.source_entity_type
    AND NEW.source_entity_id IS OLD.source_entity_id
    AND NEW.buyer_customer_id IS OLD.buyer_customer_id
    AND NEW.seller_organization_id IS OLD.seller_organization_id
    AND NEW.store_id IS OLD.store_id
    AND NEW.duty_code IS OLD.duty_code
    AND NEW.fixed_assignment_type IS OLD.fixed_assignment_type
    AND NEW.marketplace_code IS OLD.marketplace_code
    AND NEW.created_at IS OLD.created_at
  )
  OR
  (
    NEW.id IS OLD.id
    AND NEW.work_type IS OLD.work_type
    AND NEW.source_entity_type IS OLD.source_entity_type
    AND NEW.source_entity_id IS OLD.source_entity_id
    AND NEW.buyer_customer_id IS OLD.buyer_customer_id
    AND NEW.seller_organization_id IS OLD.seller_organization_id
    AND NEW.store_id IS OLD.store_id
    AND NEW.duty_code IS OLD.duty_code
    AND NEW.fixed_assignment_type IS OLD.fixed_assignment_type
    AND NEW.fixed_assignment_id IS OLD.fixed_assignment_id
    AND NEW.assigned_staff_id IS OLD.assigned_staff_id
    AND NEW.status IS OLD.status
    AND NEW.version=OLD.version
    AND NEW.created_at IS OLD.created_at
    AND NEW.updated_at IS OLD.updated_at
    AND NEW.completed_at IS OLD.completed_at
    AND NEW.cancelled_at IS OLD.cancelled_at
    AND NEW.marketplace_code IS COALESCE(
      (
        SELECT mapping.marketplace_code
        FROM seller_store_marketplaces mapping
        WHERE mapping.store_id=NEW.store_id
        ORDER BY mapping.marketplace_code
        LIMIT 1
      ),
      (
        SELECT assignment.marketplace_code
        FROM buyer_marketplace_assignments assignment
        WHERE assignment.buyer_customer_id=NEW.buyer_customer_id
        ORDER BY assignment.marketplace_code
        LIMIT 1
      ),
      OLD.marketplace_code
    )
  )
)
BEGIN
  SELECT RAISE(ABORT,'staff_work_item_invalid_transition');
END;

UPDATE app_schema_state SET schema_version=42, installed_at=CAST(unixepoch('now') AS INTEGER) * 1000 WHERE singleton_id=1 AND schema_version=41;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=42
  AND (SELECT COUNT(*) FROM marketplace_registry)=7
  AND (SELECT COUNT(*) FROM marketplace_registry WHERE status='ACTIVE')=6
  AND (SELECT COUNT(*) FROM marketplace_registry WHERE code='COUPANG_KR' AND status='DISABLED')=1
  AND (SELECT COUNT(*) FROM marketplace_registry WHERE code IN ('RAKUTEN_JP','YAHOO_JP','TEMU_JP','TIKTOK_JP') AND status='ACTIVE' AND adapter_status='AVAILABLE')=4
  AND (SELECT COUNT(*) FROM marketplace_registry WHERE platform_code IN ('AMAZON','COUPANG','RAKUTEN','YAHOO','TEMU','TIKTOK'))=7
THEN 1 ELSE 0 END;