PRAGMA foreign_keys = ON;

CREATE TABLE seller_stores (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code),
  display_name TEXT NOT NULL
    CHECK (length(display_name) BETWEEN 1 AND 200),
  normalized_name TEXT NOT NULL
    CHECK (length(normalized_name) BETWEEN 1 AND 200),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  disabled_at INTEGER,
  UNIQUE (
    organization_id,
    marketplace_code,
    normalized_name
  ),
  UNIQUE (
    id,
    organization_id
  ),
  UNIQUE (
    id,
    organization_id,
    marketplace_code
  ),
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_seller_stores_org_status
ON seller_stores (
  organization_id,
  status,
  display_name,
  id
);

CREATE TABLE seller_store_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  store_id TEXT NOT NULL
    REFERENCES seller_stores(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'STORE_CREATED',
      'STORE_DISABLED',
      'STORE_REACTIVATED'
    )),
  actor_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  previous_state_json TEXT,
  next_state_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_seller_store_events_store
ON seller_store_events (
  store_id,
  created_at,
  id
);

CREATE TRIGGER trg_seller_store_events_no_update
BEFORE UPDATE ON seller_store_events
BEGIN
  SELECT RAISE(ABORT, 'seller_store_events_are_immutable');
END;

CREATE TRIGGER trg_seller_store_events_no_delete
BEFORE DELETE ON seller_store_events
BEGIN
  SELECT RAISE(ABORT, 'seller_store_events_are_immutable');
END;

CREATE UNIQUE INDEX uq_seller_member_id_org
ON seller_organization_members (
  id,
  organization_id
);

CREATE TABLE seller_member_store_scopes (
  member_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  assigned_by_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL
    CHECK (assigned_at >= 0),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  PRIMARY KEY (
    member_id,
    store_id
  ),
  FOREIGN KEY (
    member_id,
    organization_id
  ) REFERENCES seller_organization_members (
    id,
    organization_id
  ),
  FOREIGN KEY (
    store_id,
    organization_id
  ) REFERENCES seller_stores (
    id,
    organization_id
  ),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR
    (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_seller_member_store_scopes_member
ON seller_member_store_scopes (
  member_id,
  status,
  store_id
);

CREATE INDEX idx_seller_member_store_scopes_store
ON seller_member_store_scopes (
  store_id,
  status,
  member_id
);

CREATE TABLE seller_member_store_scope_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  member_id TEXT NOT NULL
    REFERENCES seller_organization_members(id),
  store_id TEXT NOT NULL
    REFERENCES seller_stores(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'STORE_SCOPE_ASSIGNED',
      'STORE_SCOPE_REVOKED'
    )),
  actor_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_seller_scope_events_member
ON seller_member_store_scope_events (
  member_id,
  created_at,
  id
);

CREATE TRIGGER trg_seller_scope_events_no_update
BEFORE UPDATE ON seller_member_store_scope_events
BEGIN
  SELECT RAISE(ABORT, 'seller_scope_events_are_immutable');
END;

CREATE TRIGGER trg_seller_scope_events_no_delete
BEFORE DELETE ON seller_member_store_scope_events
BEGIN
  SELECT RAISE(ABORT, 'seller_scope_events_are_immutable');
END;

CREATE TABLE products (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL,
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code),
  asin_display TEXT NOT NULL
    CHECK (length(asin_display)=10),
  asin_normalized TEXT NOT NULL
    CHECK (
      length(asin_normalized)=10
      AND asin_normalized NOT GLOB '*[^A-Z0-9]*'
    ),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  current_version_no INTEGER NOT NULL
    CHECK (current_version_no >= 1),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  disabled_at INTEGER,
  UNIQUE (
    marketplace_code,
    asin_normalized
  ),
  UNIQUE (
    id,
    organization_id
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
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_products_store_status
ON products (
  store_id,
  status,
  asin_normalized,
  id
);

CREATE INDEX idx_products_org_status
ON products (
  organization_id,
  status,
  created_at,
  id
);

CREATE TABLE product_versions (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  product_id TEXT NOT NULL
    REFERENCES products(id),
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  product_name TEXT NOT NULL
    CHECK (length(product_name) BETWEEN 1 AND 200),
  search_keywords_json TEXT NOT NULL,
  product_url TEXT,
  buyer_visible_notes TEXT,
  internal_notes TEXT,
  created_by_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (
    product_id,
    version_no
  )
) STRICT;

CREATE INDEX idx_product_versions_product
ON product_versions (
  product_id,
  version_no DESC
);

CREATE TRIGGER trg_product_versions_no_update
BEFORE UPDATE ON product_versions
BEGIN
  SELECT RAISE(ABORT, 'product_versions_are_immutable');
END;

CREATE TRIGGER trg_product_versions_no_delete
BEFORE DELETE ON product_versions
BEGIN
  SELECT RAISE(ABORT, 'product_versions_are_immutable');
END;

CREATE TABLE product_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  product_id TEXT NOT NULL
    REFERENCES products(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL
    REFERENCES seller_stores(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'PRODUCT_CREATED',
      'PRODUCT_VERSION_ADDED',
      'PRODUCT_DISABLED',
      'PRODUCT_REACTIVATED'
    )),
  product_version_no INTEGER,
  actor_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  previous_state_json TEXT,
  next_state_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_product_events_product
ON product_events (
  product_id,
  created_at,
  id
);

CREATE TRIGGER trg_product_events_no_update
BEFORE UPDATE ON product_events
BEGIN
  SELECT RAISE(ABORT, 'product_events_are_immutable');
END;

CREATE TRIGGER trg_product_events_no_delete
BEFORE DELETE ON product_events
BEGIN
  SELECT RAISE(ABORT, 'product_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=5,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
