-- 0075: refund & settlement account fields (approved migration exception #3,
-- precedents 0073/0074).  Buyers store an Alipay refund account once so the
-- refund workbench can surface it per obligation instead of asking over WeChat
-- every time; sellers store a settlement account for the symmetric staff
-- settlement flow.  All four columns are nullable (NULL = not filled in yet),
-- existing rows are untouched, and no enum/payment_channel is involved: the
-- account is a pre-stored reference, not a transaction channel.  The
-- name-and-identifier pair is validated at the application layer (both or
-- neither) because ALTER TABLE cannot add a table-level pair check.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=74 THEN 1 ELSE 0 END;

ALTER TABLE buyer_customers
ADD COLUMN refund_account_name TEXT
  CHECK (refund_account_name IS NULL
    OR length(refund_account_name) BETWEEN 1 AND 100);

ALTER TABLE buyer_customers
ADD COLUMN refund_account_identifier TEXT
  CHECK (refund_account_identifier IS NULL
    OR length(refund_account_identifier) BETWEEN 3 AND 128);

ALTER TABLE seller_organizations
ADD COLUMN settlement_account_name TEXT
  CHECK (settlement_account_name IS NULL
    OR length(settlement_account_name) BETWEEN 1 AND 100);

ALTER TABLE seller_organizations
ADD COLUMN settlement_account_identifier TEXT
  CHECK (settlement_account_identifier IS NULL
    OR length(settlement_account_identifier) BETWEEN 3 AND 128);

UPDATE app_schema_state
SET schema_version=75,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=74;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
