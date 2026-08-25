-- Baseline 0001 foundation (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

PRAGMA foreign_keys = ON;

CREATE TABLE currencies (
  code TEXT PRIMARY KEY CHECK (
    length(code)=3 AND code NOT GLOB '*[^A-Z]*'
  ),
  exponent INTEGER NOT NULL CHECK (exponent BETWEEN 0 AND 9),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

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

CREATE TABLE app_schema_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  installed_at INTEGER NOT NULL CHECK (installed_at >= 0)
) STRICT;

INSERT INTO app_schema_state (
  singleton_id,
  schema_version,
  installed_at
) VALUES (
  1,
  1,
  CAST(unixepoch('now') AS INTEGER) * 1000
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  aggregate_type TEXT NOT NULL
    CHECK (length(aggregate_type) BETWEEN 1 AND 100),
  aggregate_id TEXT NOT NULL
    CHECK (length(aggregate_id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL
    CHECK (length(event_type) BETWEEN 1 AND 100),
  actor_type TEXT NOT NULL
    CHECK (length(actor_type) BETWEEN 1 AND 40),
  actor_id TEXT,
  actor_roles_json TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT,
  previous_state_json TEXT,
  next_state_json TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE TABLE marketplaces (
  code TEXT PRIMARY KEY
    CHECK (code IN ('JP')),
  name TEXT NOT NULL
    CHECK (length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE command_idempotency_records (
  actor_type TEXT NOT NULL
    CHECK (length(actor_type) BETWEEN 1 AND 40),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  action TEXT NOT NULL
    CHECK (length(action) BETWEEN 1 AND 100),
  target_type TEXT NOT NULL
    CHECK (length(target_type) BETWEEN 1 AND 100),
  target_id TEXT NOT NULL
    CHECK (length(target_id) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL
    CHECK (
      length(request_hash) = 64
      AND request_hash NOT GLOB '*[^0-9a-f]*'
    ),
  status TEXT NOT NULL
    CHECK (status IN ('PROCESSING', 'COMMITTED', 'FAILED')),
  lease_token TEXT NOT NULL
    CHECK (length(lease_token) BETWEEN 16 AND 200),
  lease_expires_at INTEGER NOT NULL
    CHECK (lease_expires_at >= 0),
  attempt_count INTEGER NOT NULL
    CHECK (attempt_count >= 1),
  response_json TEXT,
  result_references_json TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  completed_at INTEGER,
  PRIMARY KEY (
    actor_type,
    actor_id,
    idempotency_key
  ),
  CHECK (
    (status = 'COMMITTED'
      AND response_json IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_code IS NULL)
    OR
    (status = 'PROCESSING'
      AND response_json IS NULL
      AND completed_at IS NULL
      AND error_code IS NULL)
    OR
    (status = 'FAILED'
      AND response_json IS NULL
      AND completed_at IS NULL
      AND error_code IS NOT NULL)
  )
) STRICT;

CREATE TABLE integration_outbox (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  dedup_key TEXT NOT NULL UNIQUE
    CHECK (length(dedup_key) BETWEEN 8 AND 200),
  event_type TEXT NOT NULL
    CHECK (length(event_type) BETWEEN 1 AND 100),
  aggregate_type TEXT NOT NULL
    CHECK (length(aggregate_type) BETWEEN 1 AND 100),
  aggregate_id TEXT NOT NULL
    CHECK (length(aggregate_id) BETWEEN 1 AND 200),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL
    CHECK (
      length(payload_hash) = 64
      AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  available_at INTEGER NOT NULL
    CHECK (available_at >= 0),
  lease_token TEXT,
  lease_expires_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  sent_at INTEGER,
  CHECK (
    (status = 'PENDING'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND sent_at IS NULL)
    OR
    (status = 'PROCESSING'
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND sent_at IS NULL)
    OR
    (status = 'FAILED'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND sent_at IS NULL
      AND last_error IS NOT NULL)
    OR
    (status = 'SENT'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND sent_at IS NOT NULL
      AND last_error IS NULL)
  )
) STRICT;

CREATE TABLE marketplace_legacy_aliases (
  legacy_code TEXT PRIMARY KEY REFERENCES marketplaces(code),
  marketplace_code TEXT NOT NULL UNIQUE
) STRICT;

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

CREATE TABLE transaction_assertions (
  assertion_value INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_audit_events_actor
ON audit_events (
  actor_type,
  actor_id,
  created_at
);

CREATE INDEX idx_audit_events_aggregate
ON audit_events (
  aggregate_type,
  aggregate_id,
  created_at,
  id
);

CREATE INDEX idx_command_idempotency_status_lease
ON command_idempotency_records (
  status,
  lease_expires_at
);

CREATE INDEX idx_integration_outbox_expired_lease
ON integration_outbox (
  status,
  lease_expires_at
);

CREATE INDEX idx_integration_outbox_ready
ON integration_outbox (
  status,
  available_at,
  created_at,
  id
);

CREATE TRIGGER trg_audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events_are_immutable');
END;

CREATE TRIGGER trg_audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events_are_immutable');
END;

CREATE TRIGGER trg_marketplace_runtime_config_no_delete
BEFORE DELETE ON marketplace_runtime_config
BEGIN SELECT RAISE(ABORT,'marketplace_runtime_config_requires_versioned_migration'); END;

CREATE TRIGGER trg_marketplace_runtime_config_no_update
BEFORE UPDATE ON marketplace_runtime_config
BEGIN SELECT RAISE(ABORT,'marketplace_runtime_config_requires_versioned_migration'); END;

CREATE TRIGGER trg_transaction_assertion_cleanup
AFTER INSERT ON transaction_assertions
BEGIN
  DELETE FROM transaction_assertions
  WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER trg_transaction_assertion_guard
BEFORE INSERT ON transaction_assertions
WHEN NEW.assertion_value <> 1
BEGIN
  SELECT RAISE(ABORT, 'transaction_assertion_failed');
END;

INSERT INTO currencies (
  code, exponent, status, created_at, updated_at
) VALUES (
  'JPY', 0, 'ACTIVE', 1787661495000, 1787661495000
);

INSERT INTO currencies (
  code, exponent, status, created_at, updated_at
) VALUES (
  'USD', 2, 'ACTIVE', 1787661495000, 1787661495000
);

INSERT INTO currencies (
  code, exponent, status, created_at, updated_at
) VALUES (
  'KRW', 0, 'DISABLED', 1787661495000, 1787661495000
);

INSERT INTO currencies (
  code, exponent, status, created_at, updated_at
) VALUES (
  'CNY', 2, 'ACTIVE', 1787661495000, 1787661495000
);

INSERT INTO marketplace_registry (
  code, platform_code, region_code, transaction_currency_code, status, adapter_status, display_name_zh, created_at, updated_at
) VALUES (
  'AMAZON_JP', 'AMAZON', 'JP', 'JPY', 'ACTIVE', 'AVAILABLE', '亚马逊日本站', 1787661495000, 1787661495000
);

INSERT INTO marketplace_registry (
  code, platform_code, region_code, transaction_currency_code, status, adapter_status, display_name_zh, created_at, updated_at
) VALUES (
  'AMAZON_US', 'AMAZON', 'US', 'USD', 'ACTIVE', 'AVAILABLE', '亚马逊美国站', 1787661495000, 1787661495000
);

INSERT INTO marketplace_registry (
  code, platform_code, region_code, transaction_currency_code, status, adapter_status, display_name_zh, created_at, updated_at
) VALUES (
  'COUPANG_KR', 'COUPANG', 'KR', 'KRW', 'DISABLED', 'UNAVAILABLE', 'Coupang 韩国站（未开通）', 1787661495000, 1787661495000
);

INSERT INTO marketplaces (
  code, name, status, created_at, updated_at
) VALUES (
  'JP', 'Amazon Japan', 'ACTIVE', 1787661494000, 1787661494000
);

INSERT INTO marketplace_legacy_aliases (
  legacy_code, marketplace_code
) VALUES (
  'JP', 'AMAZON_JP'
);

INSERT INTO marketplace_runtime_config (
  marketplace_code, legacy_order_code, business_timezone, reporting_timezone, currency_code, currency_exponent, seller_portal_status, buyer_portal_status, created_at, updated_at
) VALUES (
  'AMAZON_JP', 'JP', 'Asia/Tokyo', 'Asia/Shanghai', 'JPY', 0, 'ACTIVE', 'ACTIVE', 1787661495000, 1787661495000
);

INSERT INTO marketplace_runtime_config (
  marketplace_code, legacy_order_code, business_timezone, reporting_timezone, currency_code, currency_exponent, seller_portal_status, buyer_portal_status, created_at, updated_at
) VALUES (
  'AMAZON_US', 'US', 'America/Los_Angeles', 'Asia/Shanghai', 'USD', 2, 'PREPARED', 'ACTIVE', 1787661495000, 1787661495000
);

INSERT INTO marketplace_runtime_config (
  marketplace_code, legacy_order_code, business_timezone, reporting_timezone, currency_code, currency_exponent, seller_portal_status, buyer_portal_status, created_at, updated_at
) VALUES (
  'COUPANG_KR', 'KR', 'Asia/Seoul', 'Asia/Shanghai', 'KRW', 0, 'PREPARED', 'PREPARED', 1787661495000, 1787661495000
);
