-- Owner ruling 2026-09-01 (schema 40): yueguangbai and yueguangbaiai are two
-- distinct staff accounts and must never fold into one canonical value. The
-- alias contract split (feat: align channel alias contract) made 'yueguangbai'
-- a legitimate canonical SellerChannelCode, but the runtime seller_channels
-- registry still seeded only six channels -- a yueguangbai-canonical import
-- would fail with CHANNEL_NOT_FOUND (Codex 0901 review, Q4 blocker).
--
-- This seeds the seventh ACTIVE channel so the runtime registry matches the
-- alias contract. Data-only change: no table/view/trigger/index is created or
-- dropped, so the object inventory counts are unchanged; only the inventory
-- SHA moves.

INSERT INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version, created_at, updated_at, disabled_at
) VALUES (
  'seller-channel-yueguangbai', 'yueguangbai', 'yueguangbai', 'yueguangbai', 'ACTIVE', 1, 1, 1787661496000, 1787661496000, NULL
);

UPDATE app_schema_state
SET
  schema_version=40,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=39;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=40
  AND (
    SELECT COUNT(*) FROM seller_channels
    WHERE code='yueguangbai' AND status='ACTIVE' AND prefix='yueguangbai'
  )=1
  AND (SELECT COUNT(*) FROM seller_channels)=7
  AND (
    SELECT COUNT(*) FROM seller_channels
    WHERE code IN ('yueguangbai', 'yueguangbaiai') AND status='ACTIVE'
  )=2
THEN 1 ELSE 0 END;
