PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=46
) THEN 1 ELSE 0 END;

-- Existing Staff work-item producers predate multi-Marketplace Staff scope.  The
-- database derives the most specific known Marketplace from store first, then
-- Buyer membership, so older producers cannot silently leave a US/KR task as JP.
-- The historical update guard predates marketplace_code. Replace it in this
-- forward migration so only this deterministic derivation may keep the same
-- work-item version; every ordinary state/reassignment update still advances
-- the version and may never rewrite marketplace truth.
DROP TRIGGER trg_staff_work_items_update_guard;

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

CREATE TRIGGER trg_staff_work_items_update_guard
BEFORE UPDATE ON staff_work_items
WHEN NOT (
  (
    OLD.status='OPEN'
    AND NEW.status IN ('OPEN','COMPLETED','CANCELLED')
    AND NEW.version=OLD.version+1
    AND NEW.updated_at>=OLD.updated_at
    AND NEW.id IS OLD.id
    AND NEW.work_type IS OLD.work_type
    AND NEW.source_entity_type IS OLD.source_entity_type
    AND NEW.source_entity_id IS OLD.source_entity_id
    AND NEW.buyer_customer_id IS OLD.buyer_customer_id
    AND NEW.seller_organization_id IS OLD.seller_organization_id
    AND NEW.store_id IS OLD.store_id
    AND NEW.duty_code IS OLD.duty_code
    AND NEW.fixed_assignment_type IS OLD.fixed_assignment_type
    AND NEW.marketplace_code IS OLD.marketplace_code
    AND NEW.created_at IS OLD.created_at
  )
  OR
  (
    NEW.id IS OLD.id
    AND NEW.work_type IS OLD.work_type
    AND NEW.source_entity_type IS OLD.source_entity_type
    AND NEW.source_entity_id IS OLD.source_entity_id
    AND NEW.buyer_customer_id IS OLD.buyer_customer_id
    AND NEW.seller_organization_id IS OLD.seller_organization_id
    AND NEW.store_id IS OLD.store_id
    AND NEW.duty_code IS OLD.duty_code
    AND NEW.fixed_assignment_type IS OLD.fixed_assignment_type
    AND NEW.fixed_assignment_id IS OLD.fixed_assignment_id
    AND NEW.assigned_staff_id IS OLD.assigned_staff_id
    AND NEW.status IS OLD.status
    AND NEW.version=OLD.version
    AND NEW.created_at IS OLD.created_at
    AND NEW.updated_at IS OLD.updated_at
    AND NEW.completed_at IS OLD.completed_at
    AND NEW.cancelled_at IS OLD.cancelled_at
    AND NEW.marketplace_code IS COALESCE(
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
      OLD.marketplace_code
    )
  )
)
BEGIN
  SELECT RAISE(ABORT,'staff_work_item_invalid_transition');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type='trigger' AND name='trg_staff_work_item_marketplace_after_insert'
) AND EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type='trigger' AND name='trg_staff_work_items_update_guard'
) THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=47,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=46;
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
