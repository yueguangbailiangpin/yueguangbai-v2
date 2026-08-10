PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=46
) THEN 1 ELSE 0 END;

-- Existing Staff work-item producers predate multi-Marketplace Staff scope.  The
-- database derives the most specific known Marketplace from store first, then
-- Buyer membership, so older producers cannot silently leave a US/KR task as JP.
CREATE TRIGGER trg_staff_work_item_marketplace_after_insert
AFTER INSERT ON staff_work_items
BEGIN
  UPDATE staff_work_items
  SET marketplace_code = COALESCE(
    (
      SELECT mapping.marketplace_code
      FROM seller_store_marketplaces mapping
      WHERE mapping.store_id=NEW.store_id
      ORDER BY mapping.marketplace_code
      LIMIT 1
    ),
    (
      SELECT assignment.marketplace_code
      FROM buyer_marketplace_assignments assignment
      WHERE assignment.buyer_customer_id=NEW.buyer_customer_id
      ORDER BY assignment.marketplace_code
      LIMIT 1
    ),
    NEW.marketplace_code
  )
  WHERE id=NEW.id;
END;

-- Reconcile existing rows using the same deterministic derivation.
UPDATE staff_work_items
SET marketplace_code = COALESCE(
  (
    SELECT mapping.marketplace_code
    FROM seller_store_marketplaces mapping
    WHERE mapping.store_id=staff_work_items.store_id
    ORDER BY mapping.marketplace_code
    LIMIT 1
  ),
  (
    SELECT assignment.marketplace_code
    FROM buyer_marketplace_assignments assignment
    WHERE assignment.buyer_customer_id=staff_work_items.buyer_customer_id
    ORDER BY assignment.marketplace_code
    LIMIT 1
  ),
  marketplace_code
);

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type='trigger' AND name='trg_staff_work_item_marketplace_after_insert'
) THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=47,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=46;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
