-- Baseline 0006 demand_reservations_scheduling (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=5 THEN 1 ELSE 0 END;

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
  closed_at INTEGER, held_reservation_count INTEGER NOT NULL DEFAULT 0
CHECK (held_reservation_count >= 0), approved_reservation_count INTEGER NOT NULL DEFAULT 0
CHECK (approved_reservation_count >= 0), buyer_self_pay_bps_snapshot INTEGER
  CHECK (
    buyer_self_pay_bps_snapshot IS NULL
    OR (
      typeof(buyer_self_pay_bps_snapshot)='integer'
      AND buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
    )
  ), buyer_self_pay_source TEXT
  CHECK (
    buyer_self_pay_source IS NULL
    OR buyer_self_pay_source IN ('PRODUCT_DEFAULT', 'STAFF_OVERRIDE')
  ), buyer_self_pay_override_reason TEXT
  CHECK (
    buyer_self_pay_override_reason IS NULL
    OR length(buyer_self_pay_override_reason) BETWEEN 1 AND 1000
  ),
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
    CHECK (reopened_count >= 0), buyer_self_pay_bps_snapshot INTEGER
  CHECK (
    buyer_self_pay_bps_snapshot IS NULL
    OR buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  ), reference_order_amount_jpy_snapshot INTEGER
  CHECK (
    reference_order_amount_jpy_snapshot IS NULL
    OR reference_order_amount_jpy_snapshot BETWEEN 0 AND 9007199254740991
  ), estimated_self_pay_jpy_snapshot INTEGER
  CHECK (
    estimated_self_pay_jpy_snapshot IS NULL
    OR estimated_self_pay_jpy_snapshot BETWEEN 0 AND 9007199254740991
  ), estimated_refundable_principal_jpy_snapshot INTEGER
  CHECK (
    estimated_refundable_principal_jpy_snapshot IS NULL
    OR estimated_refundable_principal_jpy_snapshot BETWEEN 0 AND 9007199254740991
  ), buyer_self_pay_accepted_at INTEGER
  CHECK (buyer_self_pay_accepted_at IS NULL OR buyer_self_pay_accepted_at >= 0), buyer_self_pay_accepted_demand_version INTEGER
  CHECK (
    buyer_self_pay_accepted_demand_version IS NULL
    OR buyer_self_pay_accepted_demand_version >= 1
  ),
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

CREATE TABLE product_applications (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL,
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code),
  submitted_by_member_id TEXT NOT NULL,
  asin_display TEXT NOT NULL
    CHECK (length(asin_display)=10),
  asin_normalized TEXT NOT NULL
    CHECK (
      length(asin_normalized)=10
      AND asin_normalized NOT GLOB '*[^A-Z0-9]*'
    ),
  product_name TEXT NOT NULL
    CHECK (length(product_name) BETWEEN 1 AND 200),
  search_keywords_json TEXT NOT NULL,
  product_url TEXT,
  buyer_visible_notes TEXT,
  seller_notes TEXT,
  status TEXT NOT NULL
    CHECK (status IN (
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN'
    )),
  review_reason TEXT,
  reviewed_by_staff_id TEXT
    REFERENCES staff_users(id),
  product_id TEXT
    REFERENCES products(id),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  submitted_at INTEGER NOT NULL
    CHECK (submitted_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= submitted_at),
  reviewed_at INTEGER,
  withdrawn_at INTEGER, ordering_guide_expected_amount_jpy INTEGER
  CHECK (
    ordering_guide_expected_amount_jpy IS NULL
    OR ordering_guide_expected_amount_jpy
      BETWEEN 1 AND 9007199254740991
  ),
  FOREIGN KEY (
    store_id,
    organization_id,
    marketplace_code
  ) REFERENCES seller_stores (
    id,
    organization_id,
    marketplace_code
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
      AND reviewed_by_staff_id IS NULL
      AND product_id IS NULL
      AND reviewed_at IS NULL
      AND withdrawn_at IS NULL
    )
    OR
    (
      status='APPROVED'
      AND review_reason IS NULL
      AND reviewed_by_staff_id IS NOT NULL
      AND product_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND withdrawn_at IS NULL
    )
    OR
    (
      status='REJECTED'
      AND review_reason IS NOT NULL
      AND reviewed_by_staff_id IS NOT NULL
      AND product_id IS NULL
      AND reviewed_at IS NOT NULL
      AND withdrawn_at IS NULL
    )
    OR
    (
      status='WITHDRAWN'
      AND review_reason IS NULL
      AND reviewed_by_staff_id IS NULL
      AND product_id IS NULL
      AND reviewed_at IS NULL
      AND withdrawn_at IS NOT NULL
    )
  )
) STRICT;

CREATE TABLE product_application_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  application_id TEXT NOT NULL
    REFERENCES product_applications(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL
    REFERENCES seller_stores(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'PRODUCT_APPLICATION_SUBMITTED',
      'PRODUCT_APPLICATION_APPROVED',
      'PRODUCT_APPLICATION_REJECTED',
      'PRODUCT_APPLICATION_WITHDRAWN'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('STAFF', 'SELLER_MEMBER')),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT,
  next_status TEXT NOT NULL
    CHECK (next_status IN (
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN'
    )),
  application_version INTEGER NOT NULL
    CHECK (application_version >= 1),
  product_id TEXT
    REFERENCES products(id),
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

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

CREATE INDEX idx_demand_batch_events_batch
ON demand_batch_events (
  demand_batch_id,
  created_at,
  id
);

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

CREATE INDEX idx_demand_order_schedules_current
ON demand_order_schedule_versions(demand_batch_id,version_no DESC);

CREATE INDEX idx_product_application_events_application
ON product_application_events (
  application_id,
  created_at,
  id
);

CREATE INDEX idx_product_applications_org_status
ON product_applications (
  organization_id,
  status,
  submitted_at,
  id
);

CREATE INDEX idx_product_applications_review_queue
ON product_applications (
  status,
  submitted_at,
  id
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

CREATE INDEX idx_reservation_events_reservation
ON reservation_events (
  reservation_id,
  created_at,
  id
);

CREATE UNIQUE INDEX uq_active_buyer_product_reservation
ON product_reservations (
  buyer_customer_id,
  product_id
)
WHERE status IN (
  'PENDING_REVIEW',
  'APPROVED'
);

CREATE UNIQUE INDEX uq_demand_batches_reservation_snapshot
ON demand_batches (
  id,
  organization_id,
  store_id,
  product_id,
  product_version_no,
  marketplace_code
);

CREATE UNIQUE INDEX uq_product_application_submitted_asin
ON product_applications (
  marketplace_code,
  asin_normalized
)
WHERE status='SUBMITTED';

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

CREATE TRIGGER trg_demand_batch_events_no_delete
BEFORE DELETE ON demand_batch_events
BEGIN
  SELECT RAISE(
    ABORT,
    'demand_batch_events_are_immutable'
  );
END;

CREATE TRIGGER trg_demand_batch_events_no_update
BEFORE UPDATE ON demand_batch_events
BEGIN
  SELECT RAISE(
    ABORT,
    'demand_batch_events_are_immutable'
  );
END;

CREATE TRIGGER trg_demand_buyer_self_pay_publish_guard_insert
BEFORE INSERT ON demand_batches
WHEN NEW.status='PUBLISHED'
  AND NOT (
    (NEW.buyer_self_pay_bps_snapshot IS NULL
      AND NEW.buyer_self_pay_source IS NULL
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.buyer_self_pay_source IN ('PRODUCT_DEFAULT', 'STAFF_OVERRIDE')
  AND (
    (NEW.buyer_self_pay_source='PRODUCT_DEFAULT'
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR
    (NEW.buyer_self_pay_source='STAFF_OVERRIDE'
      AND NEW.buyer_self_pay_override_reason IS NOT NULL
      AND length(NEW.buyer_self_pay_override_reason) BETWEEN 1 AND 1000)
  )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'demand_buyer_self_pay_snapshot_required');
END;

CREATE TRIGGER trg_demand_buyer_self_pay_publish_guard_update
BEFORE UPDATE OF status, buyer_self_pay_bps_snapshot,
  buyer_self_pay_source, buyer_self_pay_override_reason
ON demand_batches
WHEN NEW.status='PUBLISHED' AND NOT (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.buyer_self_pay_source IN ('PRODUCT_DEFAULT', 'STAFF_OVERRIDE')
  AND (
    (NEW.buyer_self_pay_source='PRODUCT_DEFAULT'
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR
    (NEW.buyer_self_pay_source='STAFF_OVERRIDE'
      AND NEW.buyer_self_pay_override_reason IS NOT NULL
      AND length(NEW.buyer_self_pay_override_reason) BETWEEN 1 AND 1000)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'demand_buyer_self_pay_snapshot_required');
END;

CREATE TRIGGER trg_demand_buyer_self_pay_published_immutable
BEFORE UPDATE OF buyer_self_pay_bps_snapshot,
  buyer_self_pay_source, buyer_self_pay_override_reason
ON demand_batches
WHEN OLD.status='PUBLISHED' AND (
  NOT (NEW.buyer_self_pay_bps_snapshot IS OLD.buyer_self_pay_bps_snapshot)
  OR NOT (NEW.buyer_self_pay_source IS OLD.buyer_self_pay_source)
  OR NOT (NEW.buyer_self_pay_override_reason IS OLD.buyer_self_pay_override_reason)
)
BEGIN
  SELECT RAISE(ABORT, 'published_demand_buyer_self_pay_is_immutable');
END;

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

CREATE TRIGGER trg_demand_order_schedule_versions_no_delete
BEFORE DELETE ON demand_order_schedule_versions
BEGIN
  SELECT RAISE(ABORT,'demand_order_schedule_versions_are_immutable');
END;

CREATE TRIGGER trg_demand_order_schedule_versions_no_update
BEFORE UPDATE ON demand_order_schedule_versions
BEGIN
  SELECT RAISE(ABORT,'demand_order_schedule_versions_are_immutable');
END;

CREATE TRIGGER trg_product_application_events_no_delete
BEFORE DELETE ON product_application_events
BEGIN
  SELECT RAISE(
    ABORT,
    'product_application_events_are_immutable'
  );
END;

CREATE TRIGGER trg_product_application_events_no_update
BEFORE UPDATE ON product_application_events
BEGIN
  SELECT RAISE(
    ABORT,
    'product_application_events_are_immutable'
  );
END;

CREATE TRIGGER trg_reservation_events_no_delete
BEFORE DELETE ON reservation_events
BEGIN
  SELECT RAISE(ABORT, 'reservation_events_are_immutable');
END;

CREATE TRIGGER trg_reservation_events_no_update
BEFORE UPDATE ON reservation_events
BEGIN
  SELECT RAISE(ABORT, 'reservation_events_are_immutable');
END;

CREATE TRIGGER trg_reservation_self_pay_snapshot_immutable
BEFORE UPDATE OF buyer_self_pay_bps_snapshot,
  reference_order_amount_jpy_snapshot,
  estimated_self_pay_jpy_snapshot,
  estimated_refundable_principal_jpy_snapshot,
  buyer_self_pay_accepted_at,
  buyer_self_pay_accepted_demand_version
ON product_reservations
BEGIN
  SELECT RAISE(ABORT, 'reservation_buyer_self_pay_snapshot_immutable');
END;

CREATE TRIGGER trg_reservation_self_pay_snapshot_insert_guard
BEFORE INSERT ON product_reservations
WHEN NOT (
  (
    NEW.buyer_self_pay_bps_snapshot IS NULL
    AND NEW.reference_order_amount_jpy_snapshot IS NULL
    AND NEW.estimated_self_pay_jpy_snapshot IS NULL
    AND NEW.estimated_refundable_principal_jpy_snapshot IS NULL
    AND NEW.buyer_self_pay_accepted_at IS NULL
    AND NEW.buyer_self_pay_accepted_demand_version IS NULL
  )
  OR (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.reference_order_amount_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_self_pay_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_refundable_principal_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_self_pay_jpy_snapshot
      + NEW.estimated_refundable_principal_jpy_snapshot
      = NEW.reference_order_amount_jpy_snapshot
  AND NEW.buyer_self_pay_accepted_at IS NOT NULL
  AND NEW.buyer_self_pay_accepted_demand_version >= 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'reservation_buyer_self_pay_snapshot_required');
END;

UPDATE app_schema_state
SET
  schema_version=6,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
