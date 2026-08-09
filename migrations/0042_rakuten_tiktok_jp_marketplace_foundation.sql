PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- 0042 is a local, forward-only foundation migration. The existing registry
-- is referenced by immutable 0029/0030 facts, so its old parent is retained
-- under a compatibility name while the canonical registry is rebuilt. No
-- business seller/store/order/product rows are created here.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=41
) THEN 1 ELSE 0 END;

ALTER TABLE marketplace_registry RENAME TO marketplace_registry_legacy_0029;

CREATE TABLE marketplace_registry (
  code TEXT PRIMARY KEY CHECK (
    code IN (
      'AMAZON_JP','AMAZON_US','COUPANG_KR',
      'RAKUTEN_JP','TIKTOK_JP'
    )
  ),
  platform_code TEXT NOT NULL CHECK (
    platform_code IN ('AMAZON','COUPANG','RAKUTEN','TIKTOK')
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
    OR (code='RAKUTEN_JP' AND platform_code='RAKUTEN'
      AND region_code='JP' AND transaction_currency_code='JPY')
    OR (code='TIKTOK_JP' AND platform_code='TIKTOK'
      AND region_code='JP' AND transaction_currency_code='JPY')
  ),
  CHECK (
    (code IN ('RAKUTEN_JP','TIKTOK_JP')
      AND status='ACTIVE' AND adapter_status='UNAVAILABLE')
    OR adapter_status='AVAILABLE'
    OR status='DISABLED'
  )
) STRICT;

INSERT INTO marketplace_registry (
  code, platform_code, region_code, transaction_currency_code,
  status, adapter_status, display_name_zh, created_at, updated_at
)
SELECT
  code, platform_code, region_code, transaction_currency_code,
  status, adapter_status, display_name_zh, created_at, updated_at
FROM marketplace_registry_legacy_0029;

INSERT INTO marketplace_registry (
  code, platform_code, region_code, transaction_currency_code,
  status, adapter_status, display_name_zh, created_at, updated_at
)
VALUES
  (
    'RAKUTEN_JP', 'RAKUTEN', 'JP', 'JPY', 'ACTIVE', 'UNAVAILABLE',
    '乐天日本站', CAST(unixepoch('now') AS INTEGER)*1000,
    CAST(unixepoch('now') AS INTEGER)*1000
  ),
  (
    'TIKTOK_JP', 'TIKTOK', 'JP', 'JPY', 'ACTIVE', 'UNAVAILABLE',
    'TikTok 日本站', CAST(unixepoch('now') AS INTEGER)*1000,
    CAST(unixepoch('now') AS INTEGER)*1000
  );

-- Older immutable child tables still reference this compatibility parent.
-- Freeze it completely so it cannot become a second mutable registry.
CREATE TRIGGER trg_marketplace_registry_legacy_0029_no_insert
BEFORE INSERT ON marketplace_registry_legacy_0029
BEGIN
  SELECT RAISE(ABORT, 'marketplace_registry_legacy_0029_is_frozen');
END;

CREATE TRIGGER trg_marketplace_registry_legacy_0029_no_update
BEFORE UPDATE ON marketplace_registry_legacy_0029
BEGIN
  SELECT RAISE(ABORT, 'marketplace_registry_legacy_0029_is_frozen');
END;

CREATE TRIGGER trg_marketplace_registry_legacy_0029_no_delete
BEFORE DELETE ON marketplace_registry_legacy_0029
BEGIN
  SELECT RAISE(ABORT, 'marketplace_registry_legacy_0029_is_frozen');
END;

-- Store scope is the first existing operational boundary that must accept
-- the new canonical codes. Existing rows are copied unchanged.
CREATE TABLE seller_store_marketplaces_next (
  store_id TEXT PRIMARY KEY REFERENCES seller_stores(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (store_id, seller_organization_id),
  FOREIGN KEY (store_id, seller_organization_id)
    REFERENCES seller_stores(id, organization_id)
) STRICT;

INSERT INTO seller_store_marketplaces_next (
  store_id, seller_organization_id, marketplace_code, created_at
)
SELECT store_id, seller_organization_id, marketplace_code, created_at
FROM seller_store_marketplaces;

DROP TRIGGER trg_seller_store_marketplace_default;
DROP TRIGGER trg_formal_order_marketplace_money_source_guard;
DROP INDEX idx_store_marketplace_org;
DROP TABLE seller_store_marketplaces;
ALTER TABLE seller_store_marketplaces_next RENAME TO seller_store_marketplaces;

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

CREATE TABLE platform_product_identities (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  platform_product_identifier TEXT NOT NULL CHECK (
    length(platform_product_identifier) BETWEEN 1 AND 200
  ),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  seller_store_id TEXT REFERENCES seller_stores(id),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 200),
  source_locator TEXT CHECK (
    source_locator IS NULL OR length(source_locator) BETWEEN 1 AND 500
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (marketplace_code, platform_product_identifier),
  CHECK (
    (seller_organization_id IS NULL AND seller_store_id IS NULL)
    OR (seller_organization_id IS NOT NULL AND seller_store_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_platform_product_identity_scope
ON platform_product_identities (
  seller_organization_id, seller_store_id, marketplace_code, id
);

CREATE TABLE platform_order_identities (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  platform_order_identifier TEXT NOT NULL CHECK (
    length(platform_order_identifier) BETWEEN 1 AND 200
  ),
  platform_product_identity_id TEXT REFERENCES platform_product_identities(id),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  seller_store_id TEXT REFERENCES seller_stores(id),
  platform_order_date TEXT CHECK (
    platform_order_date IS NULL OR (
      platform_order_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(platform_order_date)=platform_order_date
    )
  ),
  source_locator TEXT CHECK (
    source_locator IS NULL OR length(source_locator) BETWEEN 1 AND 500
  ),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (marketplace_code, platform_order_identifier),
  CHECK (
    (seller_organization_id IS NULL AND seller_store_id IS NULL)
    OR (seller_organization_id IS NOT NULL AND seller_store_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_platform_order_identity_scope
ON platform_order_identities (
  seller_organization_id, seller_store_id, marketplace_code, created_at, id
);

CREATE TABLE platform_identity_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('PRODUCT','ORDER')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 16 AND 160),
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED','DISABLED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','IMPORT','SYSTEM')),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 160),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (entity_type, entity_id, event_type, created_at, id)
) STRICT;

CREATE INDEX idx_platform_identity_events_entity
ON platform_identity_events (entity_type, entity_id, created_at, id);

CREATE TRIGGER trg_platform_product_identity_scope_guard
BEFORE INSERT ON platform_product_identities
WHEN NEW.seller_store_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM seller_stores store
    JOIN seller_store_marketplaces scope
      ON scope.store_id=store.id
     AND scope.seller_organization_id=store.organization_id
    JOIN seller_organizations organization
      ON organization.id=store.organization_id
    WHERE store.id=NEW.seller_store_id
      AND store.organization_id=NEW.seller_organization_id
      AND store.status='ACTIVE'
      AND organization.status='ACTIVE'
      AND scope.marketplace_code=NEW.marketplace_code
  )
BEGIN
  SELECT RAISE(ABORT, 'platform_product_identity_scope_mismatch');
END;

CREATE TRIGGER trg_platform_product_identity_no_key_update
BEFORE UPDATE ON platform_product_identities
WHEN NEW.marketplace_code<>OLD.marketplace_code
  OR NEW.platform_product_identifier<>OLD.platform_product_identifier
  OR COALESCE(NEW.seller_organization_id,'')<>COALESCE(OLD.seller_organization_id,'')
  OR COALESCE(NEW.seller_store_id,'')<>COALESCE(OLD.seller_store_id,'')
BEGIN
  SELECT RAISE(ABORT, 'platform_product_identity_key_is_immutable');
END;

CREATE TRIGGER trg_platform_product_identities_no_delete
BEFORE DELETE ON platform_product_identities
BEGIN
  SELECT RAISE(ABORT, 'platform_product_identities_are_immutable');
END;

CREATE TRIGGER trg_platform_order_identity_scope_guard
BEFORE INSERT ON platform_order_identities
WHEN NEW.seller_store_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM seller_stores store
    JOIN seller_store_marketplaces scope
      ON scope.store_id=store.id
     AND scope.seller_organization_id=store.organization_id
    JOIN seller_organizations organization
      ON organization.id=store.organization_id
    WHERE store.id=NEW.seller_store_id
      AND store.organization_id=NEW.seller_organization_id
      AND store.status='ACTIVE'
      AND organization.status='ACTIVE'
      AND scope.marketplace_code=NEW.marketplace_code
  )
BEGIN
  SELECT RAISE(ABORT, 'platform_order_identity_scope_mismatch');
END;

CREATE TRIGGER trg_platform_order_identity_product_guard
BEFORE INSERT ON platform_order_identities
WHEN NEW.platform_product_identity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM platform_product_identities product
    WHERE product.id=NEW.platform_product_identity_id
      AND product.marketplace_code=NEW.marketplace_code
      AND product.seller_organization_id IS NEW.seller_organization_id
      AND product.seller_store_id IS NEW.seller_store_id
  )
BEGIN
  SELECT RAISE(ABORT, 'platform_order_identity_product_scope_mismatch');
END;

CREATE TRIGGER trg_platform_order_identity_no_key_update
BEFORE UPDATE ON platform_order_identities
WHEN NEW.marketplace_code<>OLD.marketplace_code
  OR NEW.platform_order_identifier<>OLD.platform_order_identifier
  OR COALESCE(NEW.platform_product_identity_id,'')<>COALESCE(OLD.platform_product_identity_id,'')
  OR COALESCE(NEW.seller_organization_id,'')<>COALESCE(OLD.seller_organization_id,'')
  OR COALESCE(NEW.seller_store_id,'')<>COALESCE(OLD.seller_store_id,'')
BEGIN
  SELECT RAISE(ABORT, 'platform_order_identity_key_is_immutable');
END;

CREATE TRIGGER trg_platform_order_identities_no_delete
BEFORE DELETE ON platform_order_identities
BEGIN
  SELECT RAISE(ABORT, 'platform_order_identities_are_immutable');
END;

CREATE TRIGGER trg_platform_identity_event_target_guard
BEFORE INSERT ON platform_identity_events
WHEN (NEW.entity_type='PRODUCT' AND NOT EXISTS (
  SELECT 1 FROM platform_product_identities WHERE id=NEW.entity_id
))
OR (NEW.entity_type='ORDER' AND NOT EXISTS (
  SELECT 1 FROM platform_order_identities WHERE id=NEW.entity_id
))
BEGIN
  SELECT RAISE(ABORT, 'platform_identity_event_target_missing');
END;

CREATE TRIGGER trg_platform_identity_events_no_update
BEFORE UPDATE ON platform_identity_events
BEGIN
  SELECT RAISE(ABORT, 'platform_identity_events_are_immutable');
END;

CREATE TRIGGER trg_platform_identity_events_no_delete
BEFORE DELETE ON platform_identity_events
BEGIN
  SELECT RAISE(ABORT, 'platform_identity_events_are_immutable');
END;

-- The legacy order/evidence tables require Amazon-shaped fields. These two
-- immutable carriers make non-Amazon formal facts first-class without
-- inventing Amazon order numbers, ASINs, reservations, or provider state.
CREATE TABLE platform_order_evidence_records (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  platform_order_identity_id TEXT NOT NULL
    REFERENCES platform_order_identities(id),
  platform_product_identity_id TEXT
    REFERENCES platform_product_identities(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  seller_store_id TEXT REFERENCES seller_stores(id),
  evidence_type TEXT NOT NULL CHECK (
    evidence_type IN ('ORDER_FACT','ORDER_EVIDENCE_INTERNAL_COMMUNICATION')
  ),
  status TEXT NOT NULL CHECK (status IN ('VERIFIED','REJECTED')),
  source_locator TEXT CHECK (
    source_locator IS NULL OR length(source_locator) BETWEEN 1 AND 500
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (seller_organization_id IS NULL AND seller_store_id IS NULL)
    OR (seller_organization_id IS NOT NULL AND seller_store_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_platform_order_evidence_scope
ON platform_order_evidence_records (
  seller_organization_id, seller_store_id, marketplace_code,
  platform_order_identity_id, created_at, id
);

CREATE TRIGGER trg_platform_order_evidence_scope_guard
BEFORE INSERT ON platform_order_evidence_records
WHEN NOT EXISTS (
  SELECT 1
  FROM platform_order_identities order_identity
  WHERE order_identity.id=NEW.platform_order_identity_id
    AND order_identity.marketplace_code=NEW.marketplace_code
    AND order_identity.platform_product_identity_id
      IS NEW.platform_product_identity_id
    AND order_identity.seller_organization_id
      IS NEW.seller_organization_id
    AND order_identity.seller_store_id IS NEW.seller_store_id
)
OR (
  NEW.platform_product_identity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM platform_product_identities product_identity
    WHERE product_identity.id=NEW.platform_product_identity_id
      AND product_identity.marketplace_code=NEW.marketplace_code
      AND product_identity.seller_organization_id
        IS NEW.seller_organization_id
      AND product_identity.seller_store_id IS NEW.seller_store_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'platform_order_evidence_scope_mismatch');
END;

CREATE TRIGGER trg_platform_order_evidence_no_update
BEFORE UPDATE ON platform_order_evidence_records
BEGIN
  SELECT RAISE(ABORT, 'platform_order_evidence_records_are_immutable');
END;

CREATE TRIGGER trg_platform_order_evidence_no_delete
BEFORE DELETE ON platform_order_evidence_records
BEGIN
  SELECT RAISE(ABORT, 'platform_order_evidence_records_are_immutable');
END;

CREATE TABLE platform_formal_orders (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  order_evidence_record_id TEXT NOT NULL UNIQUE
    REFERENCES platform_order_evidence_records(id),
  platform_order_identity_id TEXT NOT NULL UNIQUE
    REFERENCES platform_order_identities(id),
  platform_product_identity_id TEXT NOT NULL
    REFERENCES platform_product_identities(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code)
    CHECK (marketplace_code IN ('RAKUTEN_JP','TIKTOK_JP')),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  seller_store_id TEXT NOT NULL REFERENCES seller_stores(id),
  product_name_snapshot TEXT NOT NULL CHECK (
    length(product_name_snapshot) BETWEEN 1 AND 200
  ),
  review_type TEXT CHECK (
    review_type IS NULL OR review_type IN ('RATING','TEXT','IMAGE','VIDEO')
  ),
  status TEXT NOT NULL CHECK (status='CONFIRMED'),
  confirmed_at INTEGER NOT NULL CHECK (confirmed_at >= 0),
  confirmed_business_date TEXT CHECK (
    confirmed_business_date IS NULL OR (
      confirmed_business_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(confirmed_business_date)=confirmed_business_date
    )
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_platform_formal_orders_seller
ON platform_formal_orders (
  seller_organization_id, seller_store_id, confirmed_at, id
);

CREATE TRIGGER trg_platform_formal_order_source_guard
BEFORE INSERT ON platform_formal_orders
WHEN EXISTS (
  SELECT 1 FROM formal_orders legacy_order WHERE legacy_order.id=NEW.id
)
OR NOT EXISTS (
  SELECT 1
  FROM marketplace_registry marketplace
  WHERE marketplace.code=NEW.marketplace_code
    AND marketplace.status='ACTIVE'
)
OR NOT EXISTS (
  SELECT 1
  FROM seller_stores store
  JOIN seller_store_marketplaces scope
    ON scope.store_id=store.id
   AND scope.seller_organization_id=store.organization_id
  JOIN seller_organizations organization
    ON organization.id=store.organization_id
  WHERE store.id=NEW.seller_store_id
    AND store.organization_id=NEW.seller_organization_id
    AND store.status='ACTIVE'
    AND organization.status='ACTIVE'
    AND scope.marketplace_code=NEW.marketplace_code
)
OR NOT EXISTS (
  SELECT 1
  FROM platform_order_identities order_identity
  WHERE order_identity.id=NEW.platform_order_identity_id
    AND order_identity.marketplace_code=NEW.marketplace_code
    AND order_identity.platform_product_identity_id
      =NEW.platform_product_identity_id
    AND order_identity.seller_organization_id=NEW.seller_organization_id
    AND order_identity.seller_store_id=NEW.seller_store_id
    AND order_identity.status='ACTIVE'
)
OR NOT EXISTS (
  SELECT 1
  FROM platform_product_identities product_identity
  WHERE product_identity.id=NEW.platform_product_identity_id
    AND product_identity.marketplace_code=NEW.marketplace_code
    AND product_identity.seller_organization_id=NEW.seller_organization_id
    AND product_identity.seller_store_id=NEW.seller_store_id
    AND product_identity.status='ACTIVE'
)
OR NOT EXISTS (
  SELECT 1
  FROM platform_order_evidence_records evidence
  WHERE evidence.id=NEW.order_evidence_record_id
    AND evidence.platform_order_identity_id=NEW.platform_order_identity_id
    AND evidence.platform_product_identity_id=NEW.platform_product_identity_id
    AND evidence.marketplace_code=NEW.marketplace_code
    AND evidence.seller_organization_id=NEW.seller_organization_id
    AND evidence.seller_store_id=NEW.seller_store_id
    AND evidence.evidence_type='ORDER_FACT'
    AND evidence.status='VERIFIED'
)
BEGIN
  SELECT RAISE(ABORT, 'platform_formal_order_source_mismatch');
END;

CREATE TRIGGER trg_platform_formal_orders_no_update
BEFORE UPDATE ON platform_formal_orders
BEGIN
  SELECT RAISE(ABORT, 'platform_formal_orders_are_immutable');
END;

CREATE TRIGGER trg_platform_formal_orders_no_delete
BEFORE DELETE ON platform_formal_orders
BEGIN
  SELECT RAISE(ABORT, 'platform_formal_orders_are_immutable');
END;

-- A formal-order id is a public route identifier shared by both carriers.
-- Prevent future legacy rows from becoming ambiguous with a platform row.
CREATE TRIGGER trg_formal_orders_platform_id_collision_guard
BEFORE INSERT ON formal_orders
WHEN EXISTS (
  SELECT 1 FROM platform_formal_orders platform_order
  WHERE platform_order.id=NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_id_carrier_collision');
END;

-- Platform chat screenshots reuse the governed file Purpose and explicit
-- audience graph. The ORDER_EVIDENCE_SUBMISSION link entity points to the
-- immutable platform communication evidence record; this carrier binds that
-- evidence and file graph to exactly one platform formal order.
CREATE TABLE platform_order_evidence_internal_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  platform_formal_order_id TEXT NOT NULL
    REFERENCES platform_formal_orders(id),
  platform_order_evidence_record_id TEXT NOT NULL UNIQUE
    REFERENCES platform_order_evidence_records(id),
  slot INTEGER NOT NULL CHECK (slot=1),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (platform_formal_order_id, slot)
) STRICT;

CREATE INDEX idx_platform_order_evidence_internal_files_order
ON platform_order_evidence_internal_files (
  platform_formal_order_id, slot, created_at, id
);

CREATE TRIGGER trg_platform_order_evidence_internal_files_guard
BEFORE INSERT ON platform_order_evidence_internal_files
WHEN EXISTS (
  SELECT 1 FROM order_evidence_internal_files legacy_attachment
  WHERE legacy_attachment.file_object_id=NEW.file_object_id
    OR legacy_attachment.file_entity_link_id=NEW.file_entity_link_id
)
OR NOT EXISTS (
  SELECT 1
  FROM platform_formal_orders formal_order
  JOIN seller_organizations organization
    ON organization.id=formal_order.seller_organization_id
    AND organization.status='ACTIVE'
  JOIN seller_stores store
    ON store.id=formal_order.seller_store_id
    AND store.organization_id=formal_order.seller_organization_id
    AND store.status='ACTIVE'
  JOIN platform_order_evidence_records evidence
    ON evidence.id=NEW.platform_order_evidence_record_id
    AND evidence.platform_order_identity_id=
      formal_order.platform_order_identity_id
    AND evidence.platform_product_identity_id=
      formal_order.platform_product_identity_id
    AND evidence.marketplace_code=formal_order.marketplace_code
    AND evidence.seller_organization_id=
      formal_order.seller_organization_id
    AND evidence.seller_store_id=formal_order.seller_store_id
    AND evidence.evidence_type='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
    AND evidence.status='VERIFIED'
  JOIN file_entity_links file_link
    ON file_link.id=NEW.file_entity_link_id
    AND file_link.file_object_id=NEW.file_object_id
    AND file_link.entity_type='ORDER_EVIDENCE_SUBMISSION'
    AND file_link.entity_id=evidence.id
    AND file_link.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
    AND file_link.visibility='SELLER_VISIBLE'
    AND file_link.authorization_mode='EXPLICIT_AUDIENCES'
    AND file_link.revoked_at IS NULL
    AND (file_link.expires_at IS NULL
      OR file_link.expires_at>NEW.created_at)
  JOIN file_objects file_object
    ON file_object.id=NEW.file_object_id
    AND file_object.status='VERIFIED'
    AND file_object.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
    AND file_object.visibility='SELLER_VISIBLE'
    AND file_object.detected_mime IN ('image/jpeg','image/png','image/webp')
  JOIN file_upload_intents upload_intent
    ON upload_intent.id=file_object.upload_intent_id
    AND upload_intent.status='VERIFIED'
    AND upload_intent.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
    AND upload_intent.visibility='SELLER_VISIBLE'
  JOIN file_entity_audience_grants audience_grant
    ON audience_grant.file_entity_link_id=file_link.id
    AND audience_grant.subject_type='SELLER_ORGANIZATION'
    AND audience_grant.seller_organization_id=
      formal_order.seller_organization_id
    AND audience_grant.revoked_at IS NULL
    AND (audience_grant.expires_at IS NULL
      OR audience_grant.expires_at>NEW.created_at)
  WHERE formal_order.id=NEW.platform_formal_order_id
    AND formal_order.status='CONFIRMED'
)
BEGIN
  SELECT RAISE(ABORT, 'platform_order_internal_file_scope_mismatch');
END;

CREATE TRIGGER trg_platform_order_evidence_internal_files_no_update
BEFORE UPDATE ON platform_order_evidence_internal_files
BEGIN
  SELECT RAISE(ABORT, 'platform_order_evidence_internal_files_are_immutable');
END;

CREATE TRIGGER trg_platform_order_evidence_internal_files_no_delete
BEFORE DELETE ON platform_order_evidence_internal_files
BEGIN
  SELECT RAISE(ABORT, 'platform_order_evidence_internal_files_are_immutable');
END;

CREATE TRIGGER trg_order_evidence_internal_files_platform_collision_guard
BEFORE INSERT ON order_evidence_internal_files
WHEN EXISTS (
  SELECT 1 FROM platform_order_evidence_internal_files platform_attachment
  WHERE platform_attachment.file_object_id=NEW.file_object_id
    OR platform_attachment.file_entity_link_id=NEW.file_entity_link_id
)
BEGIN
  SELECT RAISE(ABORT, 'order_internal_file_carrier_collision');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM marketplace_registry)=5
  AND (SELECT platform_code FROM marketplace_registry WHERE code='RAKUTEN_JP')='RAKUTEN'
  AND (SELECT platform_code FROM marketplace_registry WHERE code='TIKTOK_JP')='TIKTOK'
  AND (SELECT adapter_status FROM marketplace_registry WHERE code='RAKUTEN_JP')='UNAVAILABLE'
  AND (SELECT adapter_status FROM marketplace_registry WHERE code='TIKTOK_JP')='UNAVAILABLE'
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='platform_product_identities')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='platform_order_identities')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='platform_identity_events')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='platform_order_evidence_records')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='platform_formal_orders')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='platform_order_evidence_internal_files')
  AND (SELECT COUNT(*) FROM marketplace_registry_legacy_0029)=3
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='index' AND name='idx_store_marketplace_org')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=42,
  installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=41;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
