PRAGMA foreign_keys = ON;

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
  withdrawn_at INTEGER,
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

CREATE UNIQUE INDEX uq_product_application_submitted_asin
ON product_applications (
  marketplace_code,
  asin_normalized
)
WHERE status='SUBMITTED';

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

CREATE INDEX idx_product_application_events_application
ON product_application_events (
  application_id,
  created_at,
  id
);

CREATE TRIGGER trg_product_application_events_no_update
BEFORE UPDATE ON product_application_events
BEGIN
  SELECT RAISE(
    ABORT,
    'product_application_events_are_immutable'
  );
END;

CREATE TRIGGER trg_product_application_events_no_delete
BEFORE DELETE ON product_application_events
BEGIN
  SELECT RAISE(
    ABORT,
    'product_application_events_are_immutable'
  );
END;

UPDATE app_schema_state
SET
  schema_version=7,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
