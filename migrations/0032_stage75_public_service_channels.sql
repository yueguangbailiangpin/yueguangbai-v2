-- Stage 7.5 (batch 2): company public service channels for the buyer portal.
-- Two fixed codes (BUYER_PRE_SALES / BUYER_AFTER_SALES), seeded EMPTY — no
-- real WeChat ids or QR files exist yet and none may be invented. The config
-- is independent of any staff login identity; only the owner may edit it.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=31 THEN 1 ELSE 0 END;

CREATE TABLE company_public_service_channels (
  code TEXT PRIMARY KEY CHECK (
    code IN ('BUYER_PRE_SALES','BUYER_AFTER_SALES')
  ),
  display_name TEXT NOT NULL CHECK (
    length(display_name) BETWEEN 1 AND 120
  ),
  wechat_id TEXT CHECK (
    wechat_id IS NULL OR (length(wechat_id) BETWEEN 1 AND 120)
  ),
  qr_file_object_id TEXT REFERENCES file_objects(id),
  version INTEGER NOT NULL CHECK (version>=1),
  updated_by_staff_id TEXT REFERENCES staff_users(id),
  updated_at INTEGER NOT NULL CHECK (updated_at>=0),
  created_at INTEGER NOT NULL CHECK (created_at>=0 AND created_at<=updated_at),
  -- Only the owner may change the public channel config.
  updated_by_must_be_owner INTEGER NOT NULL DEFAULT 1 CHECK (
    updated_by_must_be_owner=1
  )
) STRICT;

-- Seeds start fully empty (task rule: never fabricate contact data).
INSERT INTO company_public_service_channels(
  code, display_name, wechat_id, qr_file_object_id, version,
  updated_by_staff_id, updated_at, created_at
) VALUES
  ('BUYER_PRE_SALES','售前客服',NULL,NULL,1,NULL,0,0),
  ('BUYER_AFTER_SALES','售后客服',NULL,NULL,1,NULL,0,0);

UPDATE app_schema_state
SET
  schema_version=32,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=31;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=32 THEN 1 ELSE 0 END;
