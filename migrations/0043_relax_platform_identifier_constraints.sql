-- Owner ruling 2026-09-01 (D-059, schema 43): relax the standard_products
-- identifier CHECK constraints from ASIN-only (exactly 10 alphanumeric
-- characters) to a per-marketplace platform identifier (1-50 alphanumeric +
-- hyphen). This covers Amazon ASINs (10), Rakuten product numbers (R-1,
-- S-1, R-1 PRO), TEMU IDs (FX281259), and Yahoo JAN codes (13 digits).
-- The UNIQUE (marketplace_code, asin_normalized) constraint stays as-is,
-- preserving per-marketplace identifier uniqueness.

CREATE TABLE standard_products__0043_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  marketplace_code TEXT NOT NULL,
  asin_display TEXT NOT NULL CHECK (length(asin_display) BETWEEN 1 AND 50),
  asin_normalized TEXT NOT NULL CHECK (
    length(asin_normalized) BETWEEN 1 AND 50 AND asin_normalized NOT GLOB '*[^A-Z0-9-]*'
  ),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
  canonical_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  source_batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (marketplace_code, asin_normalized)
) STRICT;

INSERT INTO standard_products__0043_new
SELECT id, marketplace_code, asin_display, asin_normalized, canonical_name, canonical_url, status, source_batch_id, created_at, updated_at
FROM standard_products;

DROP TABLE standard_products;
ALTER TABLE standard_products__0043_new RENAME TO standard_products;

UPDATE app_schema_state
SET schema_version=43, installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=42;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=43
  AND (SELECT COUNT(*) FROM standard_products) = (SELECT COUNT(*) FROM standard_products)
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE name='standard_products' AND sql LIKE '%BETWEEN 1 AND 50%')
THEN 1 ELSE 0 END;
