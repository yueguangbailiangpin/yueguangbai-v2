PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=53
) THEN 1 ELSE 0 END;

-- Staff authorization is now Role + Marketplace. Historical explicit GRANT
-- overrides are retired so a stale personal grant cannot expand a role.
UPDATE staff_permission_overrides
SET status='REVOKED',
    revoked_at=COALESCE(revoked_at,CAST(unixepoch('now') AS INTEGER)*1000),
    reason=COALESCE(reason,'MIGRATION_0054_ROLE_AUTHORITY_DENY_ONLY'),
    updated_at=MAX(updated_at,CAST(unixepoch('now') AS INTEGER)*1000)
WHERE status='ACTIVE' AND effect='GRANT';

CREATE TRIGGER trg_staff_permission_override_deny_only_insert
BEFORE INSERT ON staff_permission_overrides
WHEN NEW.status='ACTIVE' AND NEW.effect='GRANT'
BEGIN
  SELECT RAISE(ABORT,'staff_permission_active_grant_forbidden');
END;

CREATE TRIGGER trg_staff_permission_override_deny_only_update
BEFORE UPDATE ON staff_permission_overrides
WHEN NEW.status='ACTIVE' AND NEW.effect='GRANT'
BEGIN
  SELECT RAISE(ABORT,'staff_permission_active_grant_forbidden');
END;

-- Runtime marketplace authority. Internal business/reporting code uses the
-- canonical code; legacy persistence codes remain adapters only.
CREATE TABLE marketplace_runtime_config (
  marketplace_code TEXT PRIMARY KEY REFERENCES marketplace_registry(code),
  legacy_order_code TEXT NOT NULL CHECK (length(legacy_order_code) BETWEEN 1 AND 40),
  business_timezone TEXT NOT NULL CHECK (length(business_timezone) BETWEEN 3 AND 80),
  reporting_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai'
    CHECK (length(reporting_timezone) BETWEEN 3 AND 80),
  currency_code TEXT NOT NULL CHECK (length(currency_code)=3 AND currency_code=upper(currency_code)),
  currency_exponent INTEGER NOT NULL CHECK (currency_exponent BETWEEN 0 AND 4),
  seller_portal_status TEXT NOT NULL CHECK (seller_portal_status IN ('ACTIVE','PREPARED','DISABLED')),
  buyer_portal_status TEXT NOT NULL CHECK (buyer_portal_status IN ('ACTIVE','PREPARED','DISABLED')),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at)
) STRICT;

INSERT INTO marketplace_runtime_config(
  marketplace_code,legacy_order_code,business_timezone,reporting_timezone,
  currency_code,currency_exponent,seller_portal_status,buyer_portal_status,
  created_at,updated_at
) VALUES
  ('AMAZON_JP','JP','Asia/Tokyo','Asia/Shanghai','JPY',0,'ACTIVE','ACTIVE',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('AMAZON_US','US','America/Los_Angeles','Asia/Shanghai','USD',2,'PREPARED','ACTIVE',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('COUPANG_KR','KR','Asia/Seoul','Asia/Shanghai','KRW',0,'PREPARED','PREPARED',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('RAKUTEN_JP','RAKUTEN_JP','Asia/Tokyo','Asia/Shanghai','JPY',0,'PREPARED','PREPARED',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000),
  ('TIKTOK_JP','TIKTOK_JP','Asia/Tokyo','Asia/Shanghai','JPY',0,'PREPARED','PREPARED',CAST(unixepoch('now') AS INTEGER)*1000,CAST(unixepoch('now') AS INTEGER)*1000);

-- Formal orders keep the legacy marketplace_code for compatibility, while all
-- new cross-market logic has a canonical authority column.
ALTER TABLE formal_orders ADD COLUMN canonical_marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (canonical_marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','TIKTOK_JP'
  ));
UPDATE formal_orders
SET canonical_marketplace_code=CASE marketplace_code
  WHEN 'JP' THEN 'AMAZON_JP'
  WHEN 'US' THEN 'AMAZON_US'
  WHEN 'KR' THEN 'COUPANG_KR'
  ELSE canonical_marketplace_code END;
CREATE INDEX idx_formal_orders_canonical_market_date
ON formal_orders(canonical_marketplace_code,confirmed_business_date,id);

-- Operational acquisition channels must have a single Buyer or Seller audience.
-- Historical BOTH rows remain readable for reporting but cannot be created again.
CREATE TRIGGER trg_acquisition_channel_no_new_both
BEFORE INSERT ON acquisition_channels
WHEN NEW.lead_type='BOTH'
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_both_is_legacy_only');
END;

-- The employee-facing anonymous label is a durable business identifier. Owners
-- may rotate the receiving WeChat, but may not rename Channel 1 into Channel 4.
CREATE TRIGGER trg_acquisition_channel_staff_label_immutable
BEFORE UPDATE OF staff_label ON acquisition_channel_privacy_profiles
WHEN NEW.staff_label<>OLD.staff_label
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_staff_label_is_immutable');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  NOT EXISTS(SELECT 1 FROM staff_permission_overrides WHERE status='ACTIVE' AND effect='GRANT')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='marketplace_runtime_config')
  AND EXISTS(SELECT 1 FROM pragma_table_info('formal_orders') WHERE name='canonical_marketplace_code')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_acquisition_channel_no_new_both')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_acquisition_channel_staff_label_immutable')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=54,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=53;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
