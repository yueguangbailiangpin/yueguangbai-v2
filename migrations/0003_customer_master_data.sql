PRAGMA foreign_keys = ON;

CREATE TABLE marketplaces (
  code TEXT PRIMARY KEY
    CHECK (code IN ('JP')),
  name TEXT NOT NULL
    CHECK (length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at)
) STRICT;

INSERT INTO marketplaces (
  code,
  name,
  status,
  created_at,
  updated_at
) VALUES (
  'JP',
  'Amazon Japan',
  'ACTIVE',
  CAST(unixepoch('now') AS INTEGER) * 1000,
  CAST(unixepoch('now') AS INTEGER) * 1000
);

CREATE TABLE customer_identity_subjects (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  subject_type TEXT NOT NULL
    CHECK (subject_type IN (
      'BUYER_CUSTOMER',
      'SELLER_ORG_MEMBER'
    )),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE TABLE buyer_channels (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  code TEXT NOT NULL UNIQUE
    CHECK (
      length(code) BETWEEN 1 AND 8
      AND code NOT GLOB '*[^A-Z0-9]*'
    ),
  name TEXT NOT NULL
    CHECK (length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  next_sequence INTEGER NOT NULL DEFAULT 1
    CHECK (next_sequence >= 1),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  disabled_at INTEGER,
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE seller_channels (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  code TEXT NOT NULL UNIQUE
    CHECK (
      length(code) BETWEEN 1 AND 60
      AND code NOT GLOB '*[^a-z0-9_-]*'
    ),
  prefix TEXT NOT NULL UNIQUE
    CHECK (
      length(prefix) BETWEEN 1 AND 60
      AND prefix NOT GLOB '*[^a-z0-9-]*'
    ),
  name TEXT NOT NULL
    CHECK (length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  next_sequence INTEGER NOT NULL DEFAULT 1
    CHECK (next_sequence >= 1),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  disabled_at INTEGER,
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR
    (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;

INSERT INTO seller_channels (
  id,
  code,
  prefix,
  name,
  status,
  next_sequence,
  version,
  created_at,
  updated_at,
  disabled_at
) VALUES
  (
    'seller-channel-ido-mango',
    'ido-mango',
    'ido-mango',
    'ido-mango',
    'ACTIVE',
    1,
    1,
    CAST(unixepoch('now') AS INTEGER) * 1000,
    CAST(unixepoch('now') AS INTEGER) * 1000,
    NULL
  ),
  (
    'seller-channel-ygbceping',
    'ygbceping',
    'ygbceping',
    'ygbceping',
    'ACTIVE',
    1,
    1,
    CAST(unixepoch('now') AS INTEGER) * 1000,
    CAST(unixepoch('now') AS INTEGER) * 1000,
    NULL
  ),
  (
    'seller-channel-yueguangbaiai',
    'yueguangbaiai',
    'yueguangbaiai',
    'yueguangbaiai',
    'ACTIVE',
    1,
    1,
    CAST(unixepoch('now') AS INTEGER) * 1000,
    CAST(unixepoch('now') AS INTEGER) * 1000,
    NULL
  );

CREATE TABLE buyer_customers (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  identity_subject_id TEXT NOT NULL UNIQUE
    REFERENCES customer_identity_subjects(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code),
  buyer_channel_id TEXT NOT NULL
    REFERENCES buyer_channels(id),
  buyer_customer_no TEXT UNIQUE,
  buyer_sequence INTEGER,
  first_valid_order_business_date TEXT,
  display_name TEXT NOT NULL
    CHECK (length(display_name) BETWEEN 1 AND 100),
  access_status TEXT NOT NULL
    CHECK (access_status IN ('DISABLED', 'ACTIVE')),
  identity_review_status TEXT NOT NULL
    CHECK (identity_review_status IN (
      'CLEAR',
      'REVIEW_REQUIRED'
    )),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  activated_at INTEGER,
  disabled_at INTEGER,
  CHECK (
    (
      buyer_customer_no IS NULL
      AND buyer_sequence IS NULL
      AND first_valid_order_business_date IS NULL
    )
    OR
    (
      buyer_customer_no IS NOT NULL
      AND buyer_sequence IS NOT NULL
      AND buyer_sequence >= 1
      AND first_valid_order_business_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    )
  ),
  CHECK (
    (access_status='ACTIVE'
      AND activated_at IS NOT NULL
      AND disabled_at IS NULL)
    OR
    (access_status='DISABLED')
  )
) STRICT;


CREATE TRIGGER trg_buyer_identity_subject_type_guard
BEFORE INSERT ON buyer_customers
WHEN NOT EXISTS (
  SELECT 1
  FROM customer_identity_subjects subject
  WHERE subject.id=NEW.identity_subject_id
    AND subject.subject_type='BUYER_CUSTOMER'
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_identity_subject_type_mismatch');
END;

CREATE UNIQUE INDEX uq_buyer_channel_sequence
ON buyer_customers (
  buyer_channel_id,
  buyer_sequence
)
WHERE buyer_sequence IS NOT NULL;

CREATE INDEX idx_buyer_customer_status_channel
ON buyer_customers (
  access_status,
  buyer_channel_id,
  created_at,
  id
);

CREATE TABLE seller_organizations (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code),
  seller_code TEXT NOT NULL UNIQUE
    CHECK (length(seller_code) BETWEEN 3 AND 100),
  origin_channel_id TEXT NOT NULL
    REFERENCES seller_channels(id),
  current_channel_id TEXT NOT NULL
    REFERENCES seller_channels(id),
  seller_sequence INTEGER NOT NULL
    CHECK (seller_sequence >= 1),
  organization_name TEXT NOT NULL
    CHECK (length(organization_name) BETWEEN 1 AND 200),
  status TEXT NOT NULL
    CHECK (status IN ('DISABLED', 'ACTIVE')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  activated_at INTEGER,
  disabled_at INTEGER,
  UNIQUE (origin_channel_id, seller_sequence),
  CHECK (
    (status='ACTIVE'
      AND activated_at IS NOT NULL
      AND disabled_at IS NULL)
    OR
    (status='DISABLED')
  )
) STRICT;

CREATE INDEX idx_seller_org_status_channel
ON seller_organizations (
  status,
  current_channel_id,
  created_at,
  id
);

CREATE TABLE seller_organization_members (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  identity_subject_id TEXT NOT NULL UNIQUE
    REFERENCES customer_identity_subjects(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  member_number INTEGER NOT NULL
    CHECK (member_number >= 1),
  username_fallback TEXT NOT NULL UNIQUE
    CHECK (length(username_fallback) BETWEEN 3 AND 160),
  display_name TEXT NOT NULL
    CHECK (length(display_name) BETWEEN 1 AND 100),
  role TEXT NOT NULL
    CHECK (role IN (
      'OWNER',
      'OPERATIONS',
      'FINANCE',
      'VIEWER'
    )),
  primary_owner INTEGER NOT NULL DEFAULT 0
    CHECK (primary_owner IN (0, 1)),
  status TEXT NOT NULL
    CHECK (status IN ('DISABLED', 'ACTIVE')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  activated_at INTEGER,
  disabled_at INTEGER,
  UNIQUE (organization_id, member_number),
  CHECK (
    (primary_owner=0)
    OR
    (primary_owner=1 AND role='OWNER')
  ),
  CHECK (
    (status='ACTIVE'
      AND activated_at IS NOT NULL
      AND disabled_at IS NULL)
    OR
    (status='DISABLED')
  )
) STRICT;


CREATE TRIGGER trg_seller_member_identity_subject_type_guard
BEFORE INSERT ON seller_organization_members
WHEN NOT EXISTS (
  SELECT 1
  FROM customer_identity_subjects subject
  WHERE subject.id=NEW.identity_subject_id
    AND subject.subject_type='SELLER_ORG_MEMBER'
)
BEGIN
  SELECT RAISE(ABORT, 'seller_member_identity_subject_type_mismatch');
END;

CREATE UNIQUE INDEX uq_seller_org_primary_owner
ON seller_organization_members (
  organization_id
)
WHERE primary_owner=1;

CREATE INDEX idx_seller_org_members_org_status
ON seller_organization_members (
  organization_id,
  status,
  member_number
);

CREATE TABLE wechat_identity_claims (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  identity_subject_id TEXT NOT NULL
    REFERENCES customer_identity_subjects(id),
  display_wechat TEXT NOT NULL
    CHECK (length(display_wechat) BETWEEN 3 AND 128),
  normalized_wechat TEXT NOT NULL
    CHECK (length(normalized_wechat) BETWEEN 3 AND 128),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'RESERVED', 'RELEASED')),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  acquired_at INTEGER NOT NULL
    CHECK (acquired_at >= 0),
  reserved_at INTEGER,
  released_at INTEGER,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  CHECK (
    (status='ACTIVE'
      AND reserved_at IS NULL
      AND released_at IS NULL)
    OR
    (status='RESERVED'
      AND reserved_at IS NOT NULL
      AND released_at IS NULL)
    OR
    (status='RELEASED'
      AND reserved_at IS NOT NULL
      AND released_at IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX uq_wechat_claim_active_or_reserved
ON wechat_identity_claims (
  normalized_wechat
)
WHERE status IN ('ACTIVE', 'RESERVED');

CREATE UNIQUE INDEX uq_wechat_claim_subject_active
ON wechat_identity_claims (
  identity_subject_id
)
WHERE status='ACTIVE';

CREATE INDEX idx_wechat_claim_subject_history
ON wechat_identity_claims (
  identity_subject_id,
  created_at,
  id
);

CREATE TABLE customer_identity_claim_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  claim_id TEXT NOT NULL
    REFERENCES wechat_identity_claims(id),
  identity_subject_id TEXT NOT NULL
    REFERENCES customer_identity_subjects(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'CLAIMED',
      'RESERVED',
      'RELEASED'
    )),
  previous_status TEXT,
  next_status TEXT NOT NULL
    CHECK (next_status IN (
      'ACTIVE',
      'RESERVED',
      'RELEASED'
    )),
  actor_type TEXT NOT NULL
    CHECK (length(actor_type) BETWEEN 1 AND 40),
  actor_id TEXT,
  reason TEXT
    CHECK (reason IS NULL OR length(reason) <= 1000),
  idempotency_key TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_customer_identity_claim_events_claim
ON customer_identity_claim_events (
  claim_id,
  created_at,
  id
);

CREATE TRIGGER trg_customer_identity_claim_events_no_update
BEFORE UPDATE ON customer_identity_claim_events
BEGIN
  SELECT RAISE(ABORT, 'customer_identity_claim_events_are_immutable');
END;

CREATE TRIGGER trg_customer_identity_claim_events_no_delete
BEFORE DELETE ON customer_identity_claim_events
BEGIN
  SELECT RAISE(ABORT, 'customer_identity_claim_events_are_immutable');
END;

CREATE TABLE seller_organization_channel_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'ORIGIN_ASSIGNED',
      'CHANNEL_TRANSFERRED'
    )),
  previous_channel_id TEXT
    REFERENCES seller_channels(id),
  next_channel_id TEXT NOT NULL
    REFERENCES seller_channels(id),
  actor_staff_id TEXT
    REFERENCES staff_users(id),
  reason TEXT
    CHECK (reason IS NULL OR length(reason) <= 1000),
  idempotency_key TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_seller_channel_events_org
ON seller_organization_channel_events (
  organization_id,
  created_at,
  id
);

CREATE TRIGGER trg_seller_channel_events_no_update
BEFORE UPDATE ON seller_organization_channel_events
BEGIN
  SELECT RAISE(ABORT, 'seller_channel_events_are_immutable');
END;

CREATE TRIGGER trg_seller_channel_events_no_delete
BEFORE DELETE ON seller_organization_channel_events
BEGIN
  SELECT RAISE(ABORT, 'seller_channel_events_are_immutable');
END;

CREATE TABLE buyer_number_allocation_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT NOT NULL UNIQUE
    REFERENCES buyer_customers(id),
  buyer_channel_id TEXT NOT NULL
    REFERENCES buyer_channels(id),
  buyer_customer_no TEXT NOT NULL UNIQUE,
  buyer_sequence INTEGER NOT NULL
    CHECK (buyer_sequence >= 1),
  first_valid_order_business_date TEXT NOT NULL
    CHECK (
      first_valid_order_business_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  actor_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (buyer_channel_id, buyer_sequence)
) STRICT;

CREATE TRIGGER trg_buyer_number_events_no_update
BEFORE UPDATE ON buyer_number_allocation_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_number_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_number_events_no_delete
BEFORE DELETE ON buyer_number_allocation_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_number_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=3,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
