PRAGMA foreign_keys = ON;

-- M16 owns schema 37. Keep the version guard before every DDL so a skipped or
-- repeated migration cannot leave partial scheduling objects behind.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=36
) THEN 1 ELSE 0 END;

-- Historical product versions remain valid and explicitly unconfigured.
-- The three governed application write paths require both values; nullable
-- columns keep direct restore/import of pre-0037 history possible.
ALTER TABLE product_versions
ADD COLUMN order_interval_days INTEGER
  CHECK (
    order_interval_days IS NULL
    OR (
      typeof(order_interval_days)='integer'
      AND order_interval_days BETWEEN 1 AND 36500
    )
  );

ALTER TABLE product_versions
ADD COLUMN orders_per_run INTEGER
  CHECK (
    orders_per_run IS NULL
    OR (
      typeof(orders_per_run)='integer'
      AND orders_per_run BETWEEN 1 AND 100000
    )
  );

CREATE TABLE demand_order_schedule_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  demand_batch_id TEXT NOT NULL REFERENCES demand_batches(id),
  version_no INTEGER NOT NULL CHECK (version_no>=1),
  demand_version INTEGER NOT NULL CHECK (demand_version>=1),
  source_product_version_id TEXT NOT NULL REFERENCES product_versions(id),
  first_order_date TEXT NOT NULL CHECK (
    first_order_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(first_order_date)=first_order_date
  ),
  order_interval_days INTEGER NOT NULL CHECK (
    typeof(order_interval_days)='integer'
    AND order_interval_days BETWEEN 1 AND 36500
  ),
  orders_per_run INTEGER NOT NULL CHECK (
    typeof(orders_per_run)='integer'
    AND orders_per_run BETWEEN 1 AND 100000
  ),
  previous_first_order_date TEXT CHECK (
    previous_first_order_date IS NULL
    OR (
      previous_first_order_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(previous_first_order_date)=previous_first_order_date
    )
  ),
  previous_theoretical_last_order_date TEXT CHECK (
    previous_theoretical_last_order_date IS NULL
    OR (
      previous_theoretical_last_order_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(previous_theoretical_last_order_date)
        =previous_theoretical_last_order_date
    )
  ),
  theoretical_last_order_date TEXT NOT NULL CHECK (
    theoretical_last_order_date GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(theoretical_last_order_date)=theoretical_last_order_date
  ),
  affected_reservation_count INTEGER NOT NULL CHECK (
    typeof(affected_reservation_count)='integer'
    AND affected_reservation_count>=0
  ),
  preview_hash TEXT NOT NULL CHECK (
    length(preview_hash)=64 AND preview_hash NOT GLOB '*[^0-9a-f]*'
  ),
  change_reason TEXT NOT NULL CHECK (length(change_reason) BETWEEN 1 AND 1000),
  changed_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  UNIQUE (demand_batch_id,version_no),
  CHECK (
    (version_no=1
      AND previous_first_order_date IS NULL
      AND previous_theoretical_last_order_date IS NULL)
    OR
    (version_no>1
      AND previous_first_order_date IS NOT NULL
      AND previous_theoretical_last_order_date IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_demand_order_schedules_current
ON demand_order_schedule_versions(demand_batch_id,version_no DESC);

CREATE TRIGGER trg_demand_order_schedule_insert_guard
BEFORE INSERT ON demand_order_schedule_versions
WHEN NOT EXISTS (
  SELECT 1
  FROM demand_batches demand
  JOIN product_versions version
    ON version.product_id=demand.product_id
    AND version.version_no=demand.product_version_no
  JOIN staff_users staff ON staff.id=NEW.changed_by_staff_id
  WHERE demand.id=NEW.demand_batch_id
    AND demand.status='PUBLISHED'
    AND demand.version=NEW.demand_version
    AND version.id=NEW.source_product_version_id
    AND staff.status='ACTIVE'
    AND NEW.version_no=COALESCE((
      SELECT MAX(existing.version_no)+1
      FROM demand_order_schedule_versions existing
      WHERE existing.demand_batch_id=NEW.demand_batch_id
    ),1)
    AND NEW.theoretical_last_order_date=date(
      NEW.first_order_date,
      printf(
        '+%d days',
        ((demand.target_quantity-1)/NEW.orders_per_run)
          * NEW.order_interval_days
      )
    )
    AND NEW.theoretical_last_order_date<=date(
      demand.order_deadline/1000,
      'unixepoch',
      '+8 hours'
    )
    AND NEW.affected_reservation_count<=(
      SELECT COUNT(*)
      FROM product_reservations reservation
      WHERE reservation.demand_batch_id=demand.id
        AND reservation.status IN ('PENDING_REVIEW','APPROVED')
    )
    AND (
      (
        NEW.version_no=1
        AND (
          (
            version.order_interval_days IS NULL
            AND version.orders_per_run IS NULL
          )
          OR (
            NEW.order_interval_days=version.order_interval_days
            AND NEW.orders_per_run=version.orders_per_run
          )
        )
      )
      OR
      (
        NEW.version_no>1
        AND EXISTS (
          SELECT 1
          FROM demand_order_schedule_versions previous
          WHERE previous.demand_batch_id=NEW.demand_batch_id
            AND previous.version_no=NEW.version_no-1
            AND previous.source_product_version_id
              =NEW.source_product_version_id
            AND previous.first_order_date=NEW.previous_first_order_date
            AND previous.theoretical_last_order_date
              =NEW.previous_theoretical_last_order_date
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT,'demand_order_schedule_source_invalid');
END;

CREATE TRIGGER trg_demand_order_schedule_versions_no_update
BEFORE UPDATE ON demand_order_schedule_versions
BEGIN
  SELECT RAISE(ABORT,'demand_order_schedule_versions_are_immutable');
END;

CREATE TRIGGER trg_demand_order_schedule_versions_no_delete
BEFORE DELETE ON demand_order_schedule_versions
BEGIN
  SELECT RAISE(ABORT,'demand_order_schedule_versions_are_immutable');
END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1 FROM product_versions
    WHERE order_interval_days IS NOT NULL OR orders_per_run IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type='index' AND name='idx_demand_order_schedules_current'
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=37,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=36;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
