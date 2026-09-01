-- Owner ruling 2026-09-01 (same-day follow-up, schema 41): yueguangbai
-- (月光白) is the same staff account as ygbceping, so yueguangbai folds into
-- ygbceping as an input alias and yueguangbaiai (月光白AI) stays a separate
-- account. The 0040 seed of a standalone yueguangbai channel is therefore
-- retired: no canonical value resolves to it anymore, and the registry
-- returns to six channels. Data-only change; object inventory unchanged.

DELETE FROM seller_channels WHERE code = 'yueguangbai';

UPDATE app_schema_state
SET
  schema_version=41,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=40;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=41
  AND (SELECT COUNT(*) FROM seller_channels)=6
  AND (SELECT COUNT(*) FROM seller_channels WHERE code='yueguangbai')=0
  AND (SELECT COUNT(*) FROM seller_channels WHERE code='ygbceping' AND status='ACTIVE')=1
  AND (SELECT COUNT(*) FROM seller_channels WHERE code='yueguangbaiai' AND status='ACTIVE')=1
THEN 1 ELSE 0 END;
