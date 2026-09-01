-- Owner ruling 2026-09-01 (same-day follow-up, schema 41): yueguangbai
-- (月光白) is the same staff account as ygbceping, so the alias folds into
-- ygbceping while yueguangbaiai (月光白AI) stays separate. The 0040 seed of
-- a standalone yueguangbai channel is retired FK-safely: organizations that
-- reference the channel are re-pointed to the ygbceping channel (same
-- account, so the re-point preserves truth), and the channel row itself is
-- disabled as a tombstone instead of deleted, keeping seller_organization_
-- channel_events foreign keys and audit history intact on any legal
-- schema-40 database.

UPDATE seller_organizations
SET origin_channel_id='seller-channel-ygbceping', version=version+1
WHERE origin_channel_id='seller-channel-yueguangbai';

UPDATE seller_organizations
SET current_channel_id='seller-channel-ygbceping', version=version+1
WHERE current_channel_id='seller-channel-yueguangbai';

UPDATE seller_channels
SET status='DISABLED',
    updated_at=CAST(unixepoch('now') AS INTEGER) * 1000,
    disabled_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE code='yueguangbai';

UPDATE app_schema_state
SET
  schema_version=41,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=40;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=41
  AND (SELECT COUNT(*) FROM seller_channels WHERE status='ACTIVE')=6
  AND (
    SELECT COUNT(*) FROM seller_channels
    WHERE code='yueguangbai' AND status='DISABLED'
  )=1
  AND (
    SELECT COUNT(*) FROM seller_organizations
    WHERE origin_channel_id='seller-channel-yueguangbai'
       OR current_channel_id='seller-channel-yueguangbai'
  )=0
  AND (
    SELECT COUNT(*) FROM seller_channels
    WHERE code='ygbceping' AND status='ACTIVE'
  )=1
  AND (
    SELECT COUNT(*) FROM seller_channels
    WHERE code='yueguangbaiai' AND status='ACTIVE'
  )=1
THEN 1 ELSE 0 END;
