PRAGMA foreign_keys = ON;

-- Module 1: preserve the Amazon order page's date-only fact. Existing rows
-- remain NULL; every new evidence version and formal order must supply it.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=27
) THEN 1 ELSE 0 END;

ALTER TABLE order_evidence_versions
ADD COLUMN amazon_order_date TEXT
  CHECK (
    amazon_order_date IS NULL
    OR (
      length(amazon_order_date)=10
      AND amazon_order_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(amazon_order_date) IS NOT NULL
      AND date(amazon_order_date)=amazon_order_date
    )
  );

ALTER TABLE formal_orders
ADD COLUMN amazon_order_date TEXT
  CHECK (
    amazon_order_date IS NULL
    OR (
      length(amazon_order_date)=10
      AND amazon_order_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(amazon_order_date) IS NOT NULL
      AND date(amazon_order_date)=amazon_order_date
    )
  );

DROP TRIGGER trg_order_evidence_version_submission_guard;

CREATE TRIGGER trg_order_evidence_version_submission_guard
BEFORE INSERT ON order_evidence_versions
WHEN NEW.amazon_order_date IS NULL OR NOT EXISTS (
  SELECT 1
  FROM order_evidence_submissions submission
  WHERE submission.id=NEW.submission_id
    AND submission.reservation_id=NEW.reservation_id
    AND submission.buyer_customer_id=NEW.buyer_customer_id
    AND submission.marketplace_code=NEW.marketplace_code
    AND NEW.submitted_by_buyer_id=NEW.buyer_customer_id
    AND (
      (
        NEW.version_no=submission.current_version_no
        AND NEW.version_no=1
        AND submission.status='PENDING_VERIFICATION'
      )
      OR
      (
        NEW.version_no=submission.current_version_no+1
        AND submission.status='CHANGES_REQUESTED'
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_version_submission_mismatch');
END;

DROP TRIGGER trg_formal_order_source_guard;

CREATE TRIGGER trg_formal_order_source_guard
BEFORE INSERT ON formal_orders
WHEN
  NEW.amazon_order_date IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.id=NEW.order_evidence_version_id
      AND evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    WHERE submission.id=NEW.order_evidence_submission_id
      AND submission.reservation_id=NEW.reservation_id
      AND submission.buyer_customer_id=NEW.buyer_customer_id
      AND submission.marketplace_code=NEW.marketplace_code
      AND submission.status='VERIFIED'
      AND evidence.reservation_id=NEW.reservation_id
      AND evidence.buyer_customer_id=NEW.buyer_customer_id
      AND evidence.marketplace_code=NEW.marketplace_code
      AND evidence.amazon_order_number_raw=NEW.amazon_order_number_raw
      AND evidence.amazon_order_number_normalized=
        NEW.amazon_order_number_normalized
      AND evidence.final_paid_jpy=NEW.final_paid_jpy
      AND evidence.amazon_order_date=NEW.amazon_order_date
  )
  OR NOT EXISTS (
    SELECT 1
    FROM product_reservations reservation
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    WHERE reservation.id=NEW.reservation_id
      AND reservation.status='APPROVED'
      AND reservation.demand_batch_id=NEW.demand_batch_id
      AND reservation.buyer_customer_id=NEW.buyer_customer_id
      AND reservation.organization_id=NEW.seller_organization_id
      AND reservation.store_id=NEW.store_id
      AND reservation.product_id=NEW.product_id
      AND reservation.product_version_no=NEW.product_version_no
      AND reservation.marketplace_code=NEW.marketplace_code
      AND demand.organization_id=NEW.seller_organization_id
      AND demand.store_id=NEW.store_id
      AND demand.product_id=NEW.product_id
      AND demand.product_version_no=NEW.product_version_no
      AND demand.marketplace_code=NEW.marketplace_code
      AND demand.task_type=NEW.review_type
  )
  OR NOT EXISTS (
    SELECT 1
    FROM products product
    JOIN product_versions product_version
      ON product_version.id=NEW.product_version_id
      AND product_version.product_id=product.id
      AND product_version.version_no=NEW.product_version_no
    WHERE product.id=NEW.product_id
      AND product.organization_id=NEW.seller_organization_id
      AND product.store_id=NEW.store_id
      AND product.marketplace_code=NEW.marketplace_code
      AND product.asin_display=NEW.asin_display
      AND product.asin_normalized=NEW.asin_normalized
      AND product_version.product_name=NEW.product_name_snapshot
  )
  OR NOT EXISTS (
    SELECT 1
    FROM buyer_customers buyer
    WHERE buyer.id=NEW.buyer_customer_id
      AND buyer.marketplace_code=NEW.marketplace_code
      AND buyer.buyer_customer_no=NEW.buyer_customer_no
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_source_mismatch');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM pragma_table_info('order_evidence_versions')
    WHERE name='amazon_order_date' AND type='TEXT' AND "notnull"=0
  )
  AND EXISTS (
    SELECT 1 FROM pragma_table_info('formal_orders')
    WHERE name='amazon_order_date' AND type='TEXT' AND "notnull"=0
  )
  AND NOT EXISTS (
    SELECT 1 FROM order_evidence_versions
    WHERE amazon_order_date IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM formal_orders
    WHERE amazon_order_date IS NOT NULL
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=28,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=27;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
