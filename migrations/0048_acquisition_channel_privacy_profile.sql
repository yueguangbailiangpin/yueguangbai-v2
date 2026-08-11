PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=47
) THEN 1 ELSE 0 END;

-- Real acquisition source details stay on acquisition_channels and are visible
-- only to Owner / acquisition Staff. Ordinary customer-intake Staff receive only
-- the anonymous staff_label from this profile.
CREATE TABLE acquisition_channel_privacy_profiles (
  channel_id TEXT PRIMARY KEY REFERENCES acquisition_channels(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER','BOTH')),
  staff_label TEXT NOT NULL CHECK (length(staff_label) BETWEEN 1 AND 40),
  intake_wechat_label TEXT CHECK (
    intake_wechat_label IS NULL OR length(intake_wechat_label) BETWEEN 1 AND 100
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  updated_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at)
) STRICT;

CREATE UNIQUE INDEX uq_acquisition_channel_staff_label
ON acquisition_channel_privacy_profiles (
  marketplace_code, lead_type, staff_label
);

-- One configured receiving WeChat belongs to one acquisition channel. NULL is
-- allowed during migration/setup, but ordinary Staff cannot use such a channel.
CREATE UNIQUE INDEX uq_acquisition_channel_intake_wechat
ON acquisition_channel_privacy_profiles (intake_wechat_label)
WHERE intake_wechat_label IS NOT NULL;

WITH ranked AS (
  SELECT
    channel.id AS channel_id,
    channel.marketplace_code,
    channel.lead_type,
    '渠道' || ROW_NUMBER() OVER (
      PARTITION BY channel.marketplace_code, channel.lead_type
      ORDER BY channel.created_at, channel.id
    ) AS staff_label,
    channel.created_at,
    channel.updated_at
  FROM acquisition_channels channel
)
INSERT INTO acquisition_channel_privacy_profiles (
  channel_id,marketplace_code,lead_type,staff_label,intake_wechat_label,
  version,updated_by_staff_id,created_at,updated_at
)
SELECT
  channel_id,marketplace_code,lead_type,staff_label,NULL,
  1,NULL,created_at,updated_at
FROM ranked;

CREATE TRIGGER trg_acquisition_channel_privacy_profile_after_insert
AFTER INSERT ON acquisition_channels
BEGIN
  INSERT INTO acquisition_channel_privacy_profiles (
    channel_id,marketplace_code,lead_type,staff_label,intake_wechat_label,
    version,updated_by_staff_id,created_at,updated_at
  ) VALUES (
    NEW.id,
    NEW.marketplace_code,
    NEW.lead_type,
    '渠道' || (
      1 + (
        SELECT COUNT(*)
        FROM acquisition_channel_privacy_profiles profile
        WHERE profile.marketplace_code=NEW.marketplace_code
          AND profile.lead_type=NEW.lead_type
      )
    ),
    NULL,
    1,
    NEW.created_by_staff_id,
    NEW.created_at,
    NEW.updated_at
  );
END;

CREATE TRIGGER trg_acquisition_channel_privacy_profile_scope_guard
BEFORE UPDATE ON acquisition_channel_privacy_profiles
WHEN NEW.channel_id<>OLD.channel_id
  OR NEW.marketplace_code<>OLD.marketplace_code
  OR NEW.lead_type<>OLD.lead_type
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_privacy_profile_invalid_update');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1 FROM acquisition_channels channel
    WHERE NOT EXISTS (
      SELECT 1 FROM acquisition_channel_privacy_profiles profile
      WHERE profile.channel_id=channel.id
        AND profile.marketplace_code=channel.marketplace_code
        AND profile.lead_type=channel.lead_type
    )
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type='trigger'
      AND name='trg_acquisition_channel_privacy_profile_after_insert'
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=48,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=47;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
