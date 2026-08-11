PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=57
) THEN 1 ELSE 0 END;

ALTER TABLE formal_orders ADD COLUMN marketplace_business_date TEXT CHECK (
  marketplace_business_date IS NULL OR (
    marketplace_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(marketplace_business_date)=marketplace_business_date
  )
);
UPDATE formal_orders
SET marketplace_business_date=CASE canonical_marketplace_code
  WHEN 'AMAZON_JP' THEN date(confirmed_at/1000,'unixepoch','+9 hours')
  WHEN 'RAKUTEN_JP' THEN date(confirmed_at/1000,'unixepoch','+9 hours')
  WHEN 'TIKTOK_JP' THEN date(confirmed_at/1000,'unixepoch','+9 hours')
  WHEN 'COUPANG_KR' THEN date(confirmed_at/1000,'unixepoch','+9 hours')
  ELSE confirmed_business_date END
WHERE marketplace_business_date IS NULL;
CREATE INDEX idx_formal_orders_marketplace_business_date
ON formal_orders(canonical_marketplace_code,marketplace_business_date,id);

-- A production backup is not considered current merely because an old restore
-- once succeeded. Every materially newer schema requires a new D1 + R2 recovery
-- rehearsal and a release-bound attestation.
CREATE TABLE production_recovery_attestations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  release_sha TEXT NOT NULL CHECK (length(release_sha) BETWEEN 7 AND 64),
  schema_version INTEGER NOT NULL CHECK (schema_version>=1),
  d1_manifest_sha256 TEXT NOT NULL CHECK (length(d1_manifest_sha256)=64 AND d1_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  r2_manifest_sha256 TEXT NOT NULL CHECK (length(r2_manifest_sha256)=64 AND r2_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  restored_database_integrity_ok INTEGER NOT NULL CHECK (restored_database_integrity_ok=1),
  restored_foreign_keys_ok INTEGER NOT NULL CHECK (restored_foreign_keys_ok=1),
  r2_sample_readback_ok INTEGER NOT NULL CHECK (r2_sample_readback_ok=1),
  verified_at INTEGER NOT NULL CHECK (verified_at>=0),
  verified_by_staff_id TEXT REFERENCES staff_users(id),
  evidence_note TEXT NOT NULL CHECK (length(evidence_note) BETWEEN 8 AND 2000)
) STRICT;
CREATE INDEX idx_production_recovery_attestation_schema
ON production_recovery_attestations(schema_version DESC,verified_at DESC,id DESC);
CREATE TRIGGER trg_production_recovery_attestations_no_update
BEFORE UPDATE ON production_recovery_attestations
BEGIN SELECT RAISE(ABORT,'production_recovery_attestations_are_immutable'); END;
CREATE TRIGGER trg_production_recovery_attestations_no_delete
BEFORE DELETE ON production_recovery_attestations
BEGIN SELECT RAISE(ABORT,'production_recovery_attestations_are_immutable'); END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM pragma_table_info('formal_orders') WHERE name='marketplace_business_date')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='production_recovery_attestations')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=58,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=57;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
