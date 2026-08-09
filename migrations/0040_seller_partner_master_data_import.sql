PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Migration 0040 is a forward-only compatibility change. It preserves all
-- existing seller channel prefixes and sequence counters and only appends the
-- two frozen channels that were missing from the baseline.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=39
) THEN 1 ELSE 0 END;

INSERT INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version,
  created_at, updated_at, disabled_at
) VALUES
  (
    'seller-channel-yinghua1942', 'yinghua1942', 'yinghua1942',
    'yinghua1942', 'ACTIVE', 1, 1,
    CAST(unixepoch('now') AS INTEGER)*1000,
    CAST(unixepoch('now') AS INTEGER)*1000, NULL
  ),
  (
    'seller-channel-queshengai', 'queshengai', 'queshengai',
    'queshengai', 'ACTIVE', 1, 1,
    CAST(unixepoch('now') AS INTEGER)*1000,
    CAST(unixepoch('now') AS INTEGER)*1000, NULL
  );

-- The old global claim index prevented two independent seller organizations
-- from retaining the same WeChat. Buyer claims remain globally unique; seller
-- claims are bounded by their identity subject and organization member.
ALTER TABLE wechat_identity_claims
ADD COLUMN identity_subject_type TEXT
CHECK (
  identity_subject_type IS NULL
  OR identity_subject_type IN ('BUYER_CUSTOMER', 'SELLER_ORG_MEMBER')
);

UPDATE wechat_identity_claims
SET identity_subject_type=(
  SELECT subject.subject_type
  FROM customer_identity_subjects subject
  WHERE subject.id=wechat_identity_claims.identity_subject_id
)
WHERE identity_subject_type IS NULL;

DROP INDEX uq_wechat_claim_active_or_reserved;

CREATE UNIQUE INDEX uq_wechat_claim_buyer_active_or_reserved
ON wechat_identity_claims (normalized_wechat)
WHERE status IN ('ACTIVE', 'RESERVED')
  AND identity_subject_type='BUYER_CUSTOMER';

CREATE INDEX idx_wechat_claim_seller_normalized
ON wechat_identity_claims (
  normalized_wechat,
  identity_subject_type,
  status,
  identity_subject_id
);

CREATE TABLE seller_partner_import_batches (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  manifest_hash TEXT NOT NULL UNIQUE CHECK (
    length(manifest_hash)=64
    AND manifest_hash NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (
    status IN ('PREVIEWED', 'COMMITTED', 'ROLLED_BACK')
  ),
  actor_staff_id TEXT NOT NULL CHECK (length(actor_staff_id) BETWEEN 1 AND 120),
  source_count INTEGER NOT NULL CHECK (source_count >= 0),
  valid_count INTEGER NOT NULL CHECK (valid_count >= 0),
  quarantined_count INTEGER NOT NULL CHECK (quarantined_count >= 0),
  organization_count INTEGER NOT NULL CHECK (organization_count >= 0),
  standard_product_count INTEGER NOT NULL CHECK (standard_product_count >= 0),
  offering_count INTEGER NOT NULL CHECK (offering_count >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  committed_at INTEGER,
  rolled_back_at INTEGER,
  CHECK (valid_count + quarantined_count = source_count),
  CHECK (
    (status='PREVIEWED' AND committed_at IS NULL AND rolled_back_at IS NULL)
    OR (status='COMMITTED' AND committed_at IS NOT NULL AND rolled_back_at IS NULL)
    OR (status='ROLLED_BACK' AND committed_at IS NOT NULL AND rolled_back_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE seller_partner_import_source_records (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  source_folder_id TEXT NOT NULL CHECK (length(source_folder_id) BETWEEN 12 AND 80),
  source_record_id TEXT NOT NULL CHECK (length(source_record_id) BETWEEN 1 AND 200),
  source_locator TEXT NOT NULL CHECK (length(source_locator) BETWEEN 1 AND 500),
  source_row_hash TEXT NOT NULL CHECK (
    length(source_row_hash)=64 AND source_row_hash NOT GLOB '*[^0-9a-f]*'
  ),
  seller_wechat_display TEXT NOT NULL CHECK (length(seller_wechat_display) BETWEEN 3 AND 128),
  seller_wechat_normalized TEXT NOT NULL CHECK (length(seller_wechat_normalized) BETWEEN 3 AND 128),
  source_seller_code TEXT,
  channel_code TEXT CHECK (channel_code IS NULL OR length(channel_code) BETWEEN 1 AND 60),
  asin_normalized TEXT CHECK (asin_normalized IS NULL OR length(asin_normalized)=10),
  product_name TEXT,
  product_url TEXT,
  cooperation_status TEXT NOT NULL CHECK (
    cooperation_status IN ('CURRENT', 'HISTORICAL', 'UNKNOWN')
  ),
  source_reservable INTEGER NOT NULL CHECK (source_reservable IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('VALID', 'QUARANTINED', 'IMPORTED')),
  exception_code TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (batch_id, source_folder_id, source_record_id),
  UNIQUE (batch_id, source_row_hash),
  CHECK ((status='QUARANTINED' AND exception_code IS NOT NULL) OR status<>'QUARANTINED'),
  CHECK ((status<>'VALID' AND status<>'IMPORTED') OR channel_code IS NOT NULL),
  CHECK ((status<>'VALID' AND status<>'IMPORTED') OR asin_normalized IS NOT NULL)
) STRICT;

CREATE INDEX idx_seller_import_source_batch_status
ON seller_partner_import_source_records (batch_id, status, source_folder_id, source_record_id);

CREATE TABLE standard_products (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  asin_display TEXT NOT NULL CHECK (length(asin_display)=10),
  asin_normalized TEXT NOT NULL CHECK (
    length(asin_normalized)=10 AND asin_normalized NOT GLOB '*[^A-Z0-9]*'
  ),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
  canonical_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  source_batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (marketplace_code, asin_normalized)
) STRICT;

CREATE TABLE seller_product_offerings (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  standard_product_id TEXT NOT NULL REFERENCES standard_products(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  seller_store_id TEXT NOT NULL REFERENCES seller_stores(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  cooperation_status TEXT NOT NULL CHECK (
    cooperation_status IN ('CURRENT', 'HISTORICAL', 'UNKNOWN')
  ),
  source_reservable INTEGER NOT NULL CHECK (source_reservable IN (0, 1)),
  source_batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (standard_product_id, seller_organization_id, seller_store_id)
) STRICT;

CREATE INDEX idx_seller_product_offerings_org_status
ON seller_product_offerings (seller_organization_id, status, standard_product_id, id);

CREATE TABLE product_reservation_openings (
  offering_id TEXT PRIMARY KEY REFERENCES seller_product_offerings(id),
  status TEXT NOT NULL CHECK (status IN ('NOT_OPEN', 'ELIGIBLE', 'OPEN', 'CLOSED')),
  eligibility_reason TEXT NOT NULL CHECK (length(eligibility_reason) BETWEEN 1 AND 500),
  source_batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (status<>'OPEN' OR eligibility_reason='CURRENT_COOPERATION_AND_RESERVABLE')
) STRICT;

CREATE TRIGGER trg_seller_partner_import_source_no_update
BEFORE UPDATE ON seller_partner_import_source_records
BEGIN
  SELECT RAISE(ABORT, 'seller_partner_import_source_records_are_immutable');
END;

CREATE TRIGGER trg_seller_partner_import_source_no_delete
BEFORE DELETE ON seller_partner_import_source_records
BEGIN
  SELECT RAISE(ABORT, 'seller_partner_import_source_records_are_immutable');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM seller_channels WHERE code='yinghua1942')
  AND EXISTS (SELECT 1 FROM seller_channels WHERE code='queshengai')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='standard_products')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='seller_product_offerings')
  AND EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='product_reservation_openings')
  AND EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type='index' AND name='uq_wechat_claim_buyer_active_or_reserved'
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=40, installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=39;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
