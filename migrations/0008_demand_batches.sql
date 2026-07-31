PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX uq_products_id_org_store_marketplace
ON products (
  id,
  organization_id,
  store_id,
  marketplace_code
);

CREATE TABLE demand_batches (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL,
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code),
  product_id TEXT NOT NULL,
  product_version_no INTEGER NOT NULL
    CHECK (product_version_no >= 1),
  submitted_by_member_id TEXT NOT NULL,
  task_type TEXT NOT NULL
    CHECK (task_type IN (
      'RATING',
      'TEXT',
      'IMAGE',
      'VIDEO'
    )),
  target_quantity INTEGER NOT NULL
    CHECK (target_quantity BETWEEN 1 AND 100000),
  buyer_visible_notes TEXT,
  seller_notes TEXT,
  open_at INTEGER NOT NULL
    CHECK (open_at >= 0),
  reservation_deadline INTEGER NOT NULL
    CHECK (reservation_deadline > open_at),
  order_deadline INTEGER NOT NULL
    CHECK (order_deadline > reservation_deadline),
  status TEXT NOT NULL
    CHECK (status IN (
      'SUBMITTED',
      'PUBLISHED',
      'REJECTED',
      'WITHDRAWN',
      'CLOSED'
    )),
  review_reason TEXT,
  close_reason TEXT,
  reviewed_by_staff_id TEXT
    REFERENCES staff_users(id),
  closed_by_staff_id TEXT
    REFERENCES staff_users(id),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  submitted_at INTEGER NOT NULL
    CHECK (submitted_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= submitted_at),
  reviewed_at INTEGER,
  published_at INTEGER,
  withdrawn_at INTEGER,
  closed_at INTEGER,
  FOREIGN KEY (
    product_id,
    organization_id,
    store_id,
    marketplace_code
  ) REFERENCES products (
    id,
    organization_id,
    store_id,
    marketplace_code
  ),
  FOREIGN KEY (
    product_id,
    product_version_no
  ) REFERENCES product_versions (
    product_id,
    version_no
  ),
  FOREIGN KEY (
    submitted_by_member_id,
    organization_id
  ) REFERENCES seller_organization_members (
    id,
    organization_id
  ),
  CHECK (
    (
      status='SUBMITTED'
      AND review_reason IS NULL
      AND close_reason IS NULL
      AND reviewed_by_staff_id IS NULL
      AND closed_by_staff_id IS NULL
      AND reviewed_at IS NULL
      AND published_at IS NULL
      AND withdrawn_at IS NULL
      AND closed_at IS NULL
    )
    OR
    (
      status='PUBLISHED'
      AND review_reason IS NULL
      AND close_reason IS NULL
      AND reviewed_by_staff_id IS NOT NULL
      AND closed_by_staff_id IS NULL
      AND reviewed_at IS NOT NULL
      AND published_at IS NOT NULL
      AND withdrawn_at IS NULL
      AND closed_at IS NULL
    )
    OR
    (
      status='REJECTED'
      AND review_reason IS NOT NULL
      AND close_reason IS NULL
      AND reviewed_by_staff_id IS NOT NULL
      AND closed_by_staff_id IS NULL
      AND reviewed_at IS NOT NULL
      AND published_at IS NULL
      AND withdrawn_at IS NULL
      AND closed_at IS NULL
    )
    OR
    (
      status='WITHDRAWN'
      AND review_reason IS NULL
      AND close_reason IS NULL
      AND reviewed_by_staff_id IS NULL
      AND closed_by_staff_id IS NULL
      AND reviewed_at IS NULL
      AND published_at IS NULL
      AND withdrawn_at IS NOT NULL
      AND closed_at IS NULL
    )
    OR
    (
      status='CLOSED'
      AND review_reason IS NULL
      AND close_reason IS NOT NULL
      AND reviewed_by_staff_id IS NOT NULL
      AND closed_by_staff_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND published_at IS NOT NULL
      AND withdrawn_at IS NULL
      AND closed_at IS NOT NULL
    )
  )
) STRICT;

CREATE INDEX idx_demand_batches_org_status
ON demand_batches (
  organization_id,
  status,
  submitted_at,
  id
);

CREATE INDEX idx_demand_batches_product_status
ON demand_batches (
  product_id,
  status,
  submitted_at,
  id
);

CREATE INDEX idx_demand_batches_public
ON demand_batches (
  marketplace_code,
  status,
  open_at,
  reservation_deadline,
  id
);

CREATE TABLE demand_batch_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  demand_batch_id TEXT NOT NULL
    REFERENCES demand_batches(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL
    REFERENCES seller_stores(id),
  product_id TEXT NOT NULL
    REFERENCES products(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'DEMAND_BATCH_SUBMITTED',
      'DEMAND_BATCH_PUBLISHED',
      'DEMAND_BATCH_REJECTED',
      'DEMAND_BATCH_WITHDRAWN',
      'DEMAND_BATCH_CLOSED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('STAFF', 'SELLER_MEMBER')),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT,
  next_status TEXT NOT NULL
    CHECK (next_status IN (
      'SUBMITTED',
      'PUBLISHED',
      'REJECTED',
      'WITHDRAWN',
      'CLOSED'
    )),
  demand_version INTEGER NOT NULL
    CHECK (demand_version >= 1),
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_demand_batch_events_batch
ON demand_batch_events (
  demand_batch_id,
  created_at,
  id
);

CREATE TRIGGER trg_demand_batch_events_no_update
BEFORE UPDATE ON demand_batch_events
BEGIN
  SELECT RAISE(
    ABORT,
    'demand_batch_events_are_immutable'
  );
END;

CREATE TRIGGER trg_demand_batch_events_no_delete
BEFORE DELETE ON demand_batch_events
BEGIN
  SELECT RAISE(
    ABORT,
    'demand_batch_events_are_immutable'
  );
END;

UPDATE app_schema_state
SET
  schema_version=8,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
