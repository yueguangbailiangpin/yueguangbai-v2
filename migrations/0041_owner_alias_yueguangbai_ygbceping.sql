-- Owner ruling 2026-09-01 (same-day follow-up, schema 41): yueguangbai
-- (月光白) is the same staff account as ygbceping, so the alias folds into
-- ygbceping while yueguangbaiai (月光白AI) stays separate. The 0040 seed of
-- a standalone yueguangbai channel is retired FK- and uniqueness-safely on
-- any legal schema-40 database:
--
-- 1. Organizations originating on the yueguangbai channel are re-pointed to
--    the ygbceping channel, and their per-channel seller_sequence numbers
--    are appended past the end of the ygbceping numbering space (stable MAX
--    offset; the base rows are untouched by this statement), with
--    seller_code rewritten as `ygbceping-<new sequence>` to preserve the
--    UNIQUE(origin_channel_id, seller_sequence) and UNIQUE(seller_code)
--    constraints when both channels used the same sequence numbers.
-- 2. Current-channel references follow the same fold.
-- 3. The ygbceping channel's next_sequence is raised past the merged
--    maximum so future imports never collide.
-- 4. The yueguangbai channel row is kept as a DISABLED tombstone (never
--    deleted), so seller_organization_channel_events foreign keys and audit
--    history stay intact.

UPDATE seller_organizations
SET origin_channel_id='seller-channel-ygbceping',
    seller_sequence = seller_sequence + (
      SELECT COALESCE(MAX(base.seller_sequence), 0)
      FROM seller_organizations base
      WHERE base.origin_channel_id='seller-channel-ygbceping'
    ),
    seller_code = 'ygbceping-' || (
      seller_sequence + (
        SELECT COALESCE(MAX(base.seller_sequence), 0)
        FROM seller_organizations base
        WHERE base.origin_channel_id='seller-channel-ygbceping'
      )
    ),
    version = version + 1
WHERE origin_channel_id='seller-channel-yueguangbai';

UPDATE seller_organizations
SET current_channel_id='seller-channel-ygbceping', version=version+1
WHERE current_channel_id='seller-channel-yueguangbai';

UPDATE seller_channels
SET next_sequence = max(next_sequence, (
      SELECT COALESCE(MAX(org.seller_sequence), 0) + 1
      FROM seller_organizations org
      WHERE org.origin_channel_id='seller-channel-ygbceping'
    )),
    version = version + 1
WHERE code='ygbceping';

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
    SELECT next_sequence FROM seller_channels WHERE code='ygbceping'
  ) >= (
    SELECT COALESCE(MAX(org.seller_sequence), 0) + 1
    FROM seller_organizations org
    WHERE org.origin_channel_id='seller-channel-ygbceping'
  )
THEN 1 ELSE 0 END;
