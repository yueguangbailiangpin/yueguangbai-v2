PRAGMA foreign_keys = ON;

ALTER TABLE demand_batches
ADD COLUMN held_reservation_count INTEGER NOT NULL DEFAULT 0
CHECK (held_reservation_count >= 0);

ALTER TABLE demand_batches
ADD COLUMN approved_reservation_count INTEGER NOT NULL DEFAULT 0
CHECK (approved_reservation_count >= 0);

CREATE TRIGGER trg_demand_batch_capacity_guard_insert
BEFORE INSERT ON demand_batches
WHEN
  NEW.held_reservation_count < 0
  OR NEW.approved_reservation_count < 0
  OR (
    NEW.held_reservation_count
    + NEW.approved_reservation_count
  ) > NEW.target_quantity
BEGIN
  SELECT RAISE(ABORT, 'demand_batch_capacity_exceeded');
END;

CREATE TRIGGER trg_demand_batch_capacity_guard_update
BEFORE UPDATE OF
  held_reservation_count,
  approved_reservation_count,
  target_quantity
ON demand_batches
WHEN
  NEW.held_reservation_count < 0
  OR NEW.approved_reservation_count < 0
  OR (
    NEW.held_reservation_count
    + NEW.approved_reservation_count
  ) > NEW.target_quantity
BEGIN
  SELECT RAISE(ABORT, 'demand_batch_capacity_exceeded');
END;

CREATE UNIQUE INDEX uq_demand_batches_reservation_snapshot
ON demand_batches (
  id,
  organization_id,
  store_id,
  product_id,
  product_version_no,
  marketplace_code
);

CREATE UNIQUE INDEX uq_buyer_customers_id_marketplace
ON buyer_customers (
  id,
  marketplace_code
);

CREATE TABLE product_reservations (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  demand_batch_id TEXT NOT NULL,
  buyer_customer_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_version_no INTEGER NOT NULL
    CHECK (product_version_no >= 1),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code),
  status TEXT NOT NULL
    CHECK (status IN (
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED'
    )),
  precheck_snapshot_json TEXT NOT NULL,
  hold_expires_at INTEGER NOT NULL
    CHECK (hold_expires_at >= 0),
  order_deadline_snapshot INTEGER NOT NULL
    CHECK (order_deadline_snapshot > hold_expires_at),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  submitted_at INTEGER NOT NULL
    CHECK (submitted_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= submitted_at),
  decided_by_staff_id TEXT
    REFERENCES staff_users(id),
  decision_reason TEXT,
  decided_at INTEGER,
  cancelled_at INTEGER,
  expired_at INTEGER,
  reopened_count INTEGER NOT NULL DEFAULT 0
    CHECK (reopened_count >= 0),
  FOREIGN KEY (
    demand_batch_id,
    organization_id,
    store_id,
    product_id,
    product_version_no,
    marketplace_code
  ) REFERENCES demand_batches (
    id,
    organization_id,
    store_id,
    product_id,
    product_version_no,
    marketplace_code
  ),
  FOREIGN KEY (
    buyer_customer_id,
    marketplace_code
  ) REFERENCES buyer_customers (
    id,
    marketplace_code
  ),
  UNIQUE (
    demand_batch_id,
    buyer_customer_id
  ),
  CHECK (
    (
      status='PENDING_REVIEW'
      AND decided_by_staff_id IS NULL
      AND decision_reason IS NULL
      AND decided_at IS NULL
      AND cancelled_at IS NULL
      AND expired_at IS NULL
    )
    OR
    (
      status='APPROVED'
      AND decided_by_staff_id IS NOT NULL
      AND decision_reason IS NULL
      AND decided_at IS NOT NULL
      AND cancelled_at IS NULL
      AND expired_at IS NULL
    )
    OR
    (
      status='REJECTED'
      AND decided_by_staff_id IS NOT NULL
      AND decision_reason IS NOT NULL
      AND decided_at IS NOT NULL
      AND cancelled_at IS NULL
      AND expired_at IS NULL
    )
    OR
    (
      status='CANCELLED'
      AND cancelled_at IS NOT NULL
      AND expired_at IS NULL
    )
    OR
    (
      status='EXPIRED'
      AND expired_at IS NOT NULL
      AND cancelled_at IS NULL
    )
  )
) STRICT;

CREATE UNIQUE INDEX uq_active_buyer_product_reservation
ON product_reservations (
  buyer_customer_id,
  product_id
)
WHERE status IN (
  'PENDING_REVIEW',
  'APPROVED'
);

CREATE INDEX idx_product_reservations_buyer_status
ON product_reservations (
  buyer_customer_id,
  status,
  submitted_at,
  id
);

CREATE INDEX idx_product_reservations_demand_status
ON product_reservations (
  demand_batch_id,
  status,
  submitted_at,
  id
);

CREATE INDEX idx_product_reservations_expiry
ON product_reservations (
  status,
  hold_expires_at,
  order_deadline_snapshot,
  id
);

CREATE TABLE reservation_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  reservation_id TEXT NOT NULL
    REFERENCES product_reservations(id),
  demand_batch_id TEXT NOT NULL
    REFERENCES demand_batches(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'RESERVATION_SUBMITTED',
      'RESERVATION_APPROVED',
      'RESERVATION_REJECTED',
      'RESERVATION_CANCELLED',
      'RESERVATION_EXPIRED',
      'RESERVATION_REOPENED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN (
      'BUYER_CUSTOMER',
      'STAFF',
      'SYSTEM'
    )),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT,
  next_status TEXT NOT NULL
    CHECK (next_status IN (
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED'
    )),
  reservation_version INTEGER NOT NULL
    CHECK (reservation_version >= 1),
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_reservation_events_reservation
ON reservation_events (
  reservation_id,
  created_at,
  id
);

CREATE TRIGGER trg_reservation_events_no_update
BEFORE UPDATE ON reservation_events
BEGIN
  SELECT RAISE(ABORT, 'reservation_events_are_immutable');
END;

CREATE TRIGGER trg_reservation_events_no_delete
BEFORE DELETE ON reservation_events
BEGIN
  SELECT RAISE(ABORT, 'reservation_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=9,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
