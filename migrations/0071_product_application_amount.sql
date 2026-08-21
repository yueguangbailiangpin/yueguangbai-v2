-- Seller-entered reference order amount for product applications.
-- Historical applications remain readable with NULL; all new submissions are
-- required by the application command to provide a positive JPY integer.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=70 THEN 1 ELSE 0 END;

ALTER TABLE product_applications
ADD COLUMN ordering_guide_expected_amount_jpy INTEGER
  CHECK (
    ordering_guide_expected_amount_jpy IS NULL
    OR ordering_guide_expected_amount_jpy
      BETWEEN 1 AND 9007199254740991
  );

UPDATE app_schema_state SET schema_version=71 WHERE singleton_id=1;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
