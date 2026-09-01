-- Baseline 0004 seller_stores_catalog (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=3 THEN 1 ELSE 0 END;

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
    CHECK (created_at >= 0), ordering_guide_expected_amount_jpy INTEGER
  CHECK (
    ordering_guide_expected_amount_jpy IS NULL
    OR ordering_guide_expected_amount_jpy
      BETWEEN 0 AND 9007199254740991
  ), color_spec_mode TEXT
  CHECK (
    color_spec_mode IS NULL
    OR color_spec_mode IN ('MAIN_IMAGE_VARIANT', 'ANY_VARIANT')
  ), default_buyer_self_pay_bps INTEGER NOT NULL DEFAULT 0
  CHECK (
    typeof(default_buyer_self_pay_bps)='integer'
    AND default_buyer_self_pay_bps BETWEEN 0 AND 10000
  ), order_interval_days INTEGER
  CHECK (
    order_interval_days IS NULL
    OR (
      typeof(order_interval_days)='integer'
      AND order_interval_days BETWEEN 1 AND 36500
    )
  ), orders_per_run INTEGER
  CHECK (
    orders_per_run IS NULL
    OR (
      typeof(orders_per_run)='integer'
      AND orders_per_run BETWEEN 1 AND 100000
    )
  ),
  UNIQUE (
    product_id,
    version_no
  )
) STRICT;

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

CREATE TABLE seller_partner_import_batches (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  manifest_hash TEXT NOT NULL UNIQUE CHECK (
    length(manifest_hash)=64
    AND manifest_hash NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (
    status IN ('PREVIEWED', 'COMMITTED', 'ROLLED_BACK')
  ),
  actor_staff_id TEXT NOT NULL CHECK (length(actor_staff_id) BETWEEN 1 AND 120),
  source_count INTEGER NOT NULL CHECK (source_count >= 0),
  valid_count INTEGER NOT NULL CHECK (valid_count >= 0),
  quarantined_count INTEGER NOT NULL CHECK (quarantined_count >= 0),
  organization_count INTEGER NOT NULL CHECK (organization_count >= 0),
  standard_product_count INTEGER NOT NULL CHECK (standard_product_count >= 0),
  offering_count INTEGER NOT NULL CHECK (offering_count >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  committed_at INTEGER,
  rolled_back_at INTEGER,
  CHECK (valid_count + quarantined_count = source_count),
  CHECK (
    (status='PREVIEWED' AND committed_at IS NULL AND rolled_back_at IS NULL)
    OR (status='COMMITTED' AND committed_at IS NOT NULL AND rolled_back_at IS NULL)
    OR (status='ROLLED_BACK' AND committed_at IS NOT NULL AND rolled_back_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE standard_products (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  marketplace_code TEXT NOT NULL,
  asin_display TEXT NOT NULL CHECK (length(asin_display)=10),
  asin_normalized TEXT NOT NULL CHECK (
    length(asin_normalized)=10 AND asin_normalized NOT GLOB '*[^A-Z0-9]*'
  ),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
  canonical_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  source_batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (marketplace_code, asin_normalized)
) STRICT;

CREATE TABLE seller_product_offerings (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  standard_product_id TEXT NOT NULL REFERENCES standard_products(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  seller_store_id TEXT NOT NULL REFERENCES seller_stores(id),
  marketplace_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  cooperation_status TEXT NOT NULL CHECK (
    cooperation_status IN ('CURRENT', 'HISTORICAL', 'UNKNOWN')
  ),
  source_reservable INTEGER NOT NULL CHECK (source_reservable IN (0, 1)),
  source_batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (standard_product_id, seller_organization_id, seller_store_id)
) STRICT;

CREATE TABLE product_reservation_openings (
  offering_id TEXT PRIMARY KEY REFERENCES seller_product_offerings(id),
  status TEXT NOT NULL CHECK (status IN ('NOT_OPEN', 'ELIGIBLE', 'OPEN', 'CLOSED')),
  eligibility_reason TEXT NOT NULL CHECK (length(eligibility_reason) BETWEEN 1 AND 500),
  source_batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (status<>'OPEN' OR eligibility_reason='CURRENT_COOPERATION_AND_RESERVABLE')
) STRICT;

CREATE TABLE product_version_main_images (
  product_version_id TEXT PRIMARY KEY REFERENCES product_versions(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE seller_customer_groups (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 240),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at)
) STRICT;

CREATE TABLE seller_customer_group_marketplaces (
  seller_customer_group_id TEXT NOT NULL REFERENCES seller_customer_groups(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  seller_organization_id TEXT NOT NULL UNIQUE REFERENCES seller_organizations(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY(seller_customer_group_id,marketplace_code)
) STRICT;

CREATE TABLE seller_member_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  member_id TEXT NOT NULL
    REFERENCES seller_organization_members(id),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'SELLER_MEMBER_CREATED',
      'SELLER_MEMBER_ACTIVATED',
      'SELLER_MEMBER_ROLE_CHANGED',
      'SELLER_MEMBER_DISABLED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('STAFF', 'SELLER_MEMBER')),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_state_json TEXT,
  next_state_json TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE TABLE seller_member_invitations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
  organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  invited_wechat_normalized TEXT NOT NULL CHECK (length(invited_wechat_normalized) BETWEEN 1 AND 200),
  invited_wechat_display TEXT NOT NULL CHECK (length(invited_wechat_display) BETWEEN 1 AND 200),
  invited_display_name TEXT NOT NULL CHECK (length(invited_display_name) BETWEEN 1 AND 100),
  invited_role TEXT NOT NULL CHECK (invited_role IN ('OPERATIONS','FINANCE','VIEWER')),
  store_scope_json TEXT NOT NULL CHECK (json_valid(store_scope_json)),
  issued_by_member_id TEXT NOT NULL REFERENCES seller_organization_members(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED','EXPIRED')),
  version INTEGER NOT NULL CHECK (version>=1),
  issued_at INTEGER NOT NULL CHECK (issued_at>=0),
  expires_at INTEGER NOT NULL CHECK (expires_at>issued_at),
  consumed_at INTEGER,
  consumed_member_id TEXT REFERENCES seller_organization_members(id),
  consumed_account_id TEXT REFERENCES customer_login_accounts(id),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ACTIVE' AND consumed_at IS NULL AND consumed_member_id IS NULL AND consumed_account_id IS NULL AND revoked_at IS NULL)
    OR (status='CONSUMED' AND consumed_at IS NOT NULL AND consumed_member_id IS NOT NULL AND consumed_account_id IS NOT NULL AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND consumed_at IS NULL)
    OR (status='EXPIRED' AND consumed_at IS NULL AND revoked_at IS NULL)
  )
) STRICT;

CREATE TABLE seller_member_invitation_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  invitation_id TEXT NOT NULL REFERENCES seller_member_invitations(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('SELLER_MEMBER','CUSTOMER','SYSTEM')),
  actor_id TEXT,
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

CREATE TABLE seller_member_portal_store_grants (
  member_id TEXT NOT NULL REFERENCES seller_organization_members(id),
  organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL REFERENCES seller_stores(id),
  granted_by_member_id TEXT NOT NULL REFERENCES seller_organization_members(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  revoked_at INTEGER,
  PRIMARY KEY(member_id,store_id),
  CHECK (revoked_at IS NULL OR revoked_at>=created_at)
) STRICT;

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

CREATE TABLE seller_partner_import_source_records (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  batch_id TEXT NOT NULL REFERENCES seller_partner_import_batches(id),
  source_folder_id TEXT NOT NULL CHECK (length(source_folder_id) BETWEEN 12 AND 80),
  source_record_id TEXT NOT NULL CHECK (length(source_record_id) BETWEEN 1 AND 200),
  source_locator TEXT NOT NULL CHECK (length(source_locator) BETWEEN 1 AND 500),
  source_row_hash TEXT NOT NULL CHECK (
    length(source_row_hash)=64 AND source_row_hash NOT GLOB '*[^0-9a-f]*'
  ),
  seller_wechat_display TEXT NOT NULL CHECK (length(seller_wechat_display) BETWEEN 3 AND 128),
  seller_wechat_normalized TEXT NOT NULL CHECK (length(seller_wechat_normalized) BETWEEN 3 AND 128),
  source_seller_code TEXT,
  channel_code TEXT CHECK (channel_code IS NULL OR length(channel_code) BETWEEN 1 AND 60),
  asin_normalized TEXT CHECK (asin_normalized IS NULL OR length(asin_normalized)=10),
  product_name TEXT,
  product_url TEXT,
  cooperation_status TEXT NOT NULL CHECK (
    cooperation_status IN ('CURRENT', 'HISTORICAL', 'UNKNOWN')
  ),
  source_reservable INTEGER NOT NULL CHECK (source_reservable IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('VALID', 'QUARANTINED', 'IMPORTED')),
  exception_code TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (batch_id, source_folder_id, source_record_id),
  UNIQUE (batch_id, source_row_hash),
  CHECK ((status='QUARANTINED' AND exception_code IS NOT NULL) OR status<>'QUARANTINED'),
  CHECK ((status<>'VALID' AND status<>'IMPORTED') OR channel_code IS NOT NULL),
  CHECK ((status<>'VALID' AND status<>'IMPORTED') OR asin_normalized IS NOT NULL)
) STRICT;

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

CREATE TABLE "seller_store_marketplaces" (
  store_id TEXT PRIMARY KEY REFERENCES seller_stores(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (store_id, seller_organization_id),
  FOREIGN KEY (store_id, seller_organization_id)
    REFERENCES seller_stores(id, organization_id)
) STRICT;

CREATE INDEX idx_product_events_product
ON product_events (
  product_id,
  created_at,
  id
);

CREATE INDEX idx_product_version_main_images_link
ON product_version_main_images (file_entity_link_id,product_version_id);

CREATE INDEX idx_product_versions_product
ON product_versions (
  product_id,
  version_no DESC
);

CREATE INDEX idx_products_org_status
ON products (
  organization_id,
  status,
  created_at,
  id
);

CREATE INDEX idx_products_store_status
ON products (
  store_id,
  status,
  asin_normalized,
  id
);

CREATE INDEX idx_seller_import_source_batch_status
ON seller_partner_import_source_records (batch_id, status, source_folder_id, source_record_id);

CREATE INDEX idx_seller_member_events_member
ON seller_member_events (
  member_id,
  created_at,
  id
);

CREATE INDEX idx_seller_member_events_organization
ON seller_member_events (
  organization_id,
  created_at,
  id
);

CREATE INDEX idx_seller_member_invitation_events
ON seller_member_invitation_events(invitation_id,created_at,id);

CREATE INDEX idx_seller_member_invitation_org_status
ON seller_member_invitations(organization_id,status,issued_at DESC,id DESC);

CREATE INDEX idx_seller_member_portal_grant_org
ON seller_member_portal_store_grants(organization_id,member_id,revoked_at,store_id);

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

CREATE INDEX idx_seller_product_offerings_org_status
ON seller_product_offerings (seller_organization_id, status, standard_product_id, id);

CREATE INDEX idx_seller_scope_events_member
ON seller_member_store_scope_events (
  member_id,
  created_at,
  id
);

CREATE INDEX idx_seller_store_events_store
ON seller_store_events (
  store_id,
  created_at,
  id
);

CREATE INDEX idx_seller_stores_org_status
ON seller_stores (
  organization_id,
  status,
  display_name,
  id
);

CREATE INDEX idx_store_marketplace_org
ON seller_store_marketplaces (
  seller_organization_id, marketplace_code, store_id
);

CREATE UNIQUE INDEX uq_products_id_org_store_marketplace
ON products (
  id,
  organization_id,
  store_id,
  marketplace_code
);

CREATE UNIQUE INDEX uq_seller_member_invitation_active_identity
ON seller_member_invitations(organization_id,invited_wechat_normalized)
WHERE status='ACTIVE';

CREATE TRIGGER trg_product_events_no_delete
BEFORE DELETE ON product_events
BEGIN
  SELECT RAISE(ABORT, 'product_events_are_immutable');
END;

CREATE TRIGGER trg_product_events_no_update
BEFORE UPDATE ON product_events
BEGIN
  SELECT RAISE(ABORT, 'product_events_are_immutable');
END;

CREATE TRIGGER trg_product_version_main_images_no_delete
BEFORE DELETE ON product_version_main_images
BEGIN SELECT RAISE(ABORT,'product_version_main_images_are_immutable'); END;

CREATE TRIGGER trg_product_version_main_images_no_update
BEFORE UPDATE ON product_version_main_images
BEGIN SELECT RAISE(ABORT,'product_version_main_images_are_immutable'); END;

CREATE TRIGGER trg_product_versions_no_delete
BEFORE DELETE ON product_versions
BEGIN
  SELECT RAISE(ABORT, 'product_versions_are_immutable');
END;

CREATE TRIGGER trg_product_versions_no_update
BEFORE UPDATE ON product_versions
BEGIN
  SELECT RAISE(ABORT, 'product_versions_are_immutable');
END;

CREATE TRIGGER trg_product_versions_ordering_profile_insert_guard
BEFORE INSERT ON product_versions
WHEN
  NEW.ordering_guide_expected_amount_jpy IS NULL
  OR typeof(NEW.ordering_guide_expected_amount_jpy)<>'integer'
  OR NEW.ordering_guide_expected_amount_jpy
    NOT BETWEEN 0 AND 9007199254740991
  OR NEW.color_spec_mode IS NULL
  OR NEW.color_spec_mode NOT IN ('MAIN_IMAGE_VARIANT', 'ANY_VARIANT')
BEGIN
  SELECT RAISE(ABORT, 'product_version_ordering_profile_required');
END;

CREATE TRIGGER trg_product_versions_self_pay_insert_guard
BEFORE INSERT ON product_versions
WHEN typeof(NEW.default_buyer_self_pay_bps)<>'integer'
  OR NEW.default_buyer_self_pay_bps NOT BETWEEN 0 AND 10000
BEGIN
  SELECT RAISE(ABORT, 'product_version_buyer_self_pay_bps_invalid');
END;

CREATE TRIGGER trg_seller_customer_group_after_org
AFTER INSERT ON seller_organizations
BEGIN
  INSERT INTO seller_customer_groups(id,canonical_name,status,created_at,updated_at)
  VALUES('seller-group-' || NEW.id,NEW.organization_name,NEW.status,NEW.created_at,NEW.updated_at);
  INSERT INTO seller_customer_group_marketplaces(
    seller_customer_group_id,marketplace_code,seller_organization_id,created_at
  ) VALUES(
    'seller-group-' || NEW.id,
    CASE NEW.marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE NEW.marketplace_code END,
    NEW.id,NEW.created_at
  );
END;

CREATE TRIGGER trg_seller_member_events_no_delete
BEFORE DELETE ON seller_member_events
BEGIN
  SELECT RAISE(ABORT, 'seller_member_events_are_immutable');
END;

CREATE TRIGGER trg_seller_member_events_no_update
BEFORE UPDATE ON seller_member_events
BEGIN
  SELECT RAISE(ABORT, 'seller_member_events_are_immutable');
END;

CREATE TRIGGER trg_seller_member_invitation_events_no_delete
BEFORE DELETE ON seller_member_invitation_events
BEGIN SELECT RAISE(ABORT,'seller_member_invitation_events_are_immutable'); END;

CREATE TRIGGER trg_seller_member_invitation_events_no_update
BEFORE UPDATE ON seller_member_invitation_events
BEGIN SELECT RAISE(ABORT,'seller_member_invitation_events_are_immutable'); END;

CREATE TRIGGER trg_seller_member_portal_grant_no_delete
BEFORE DELETE ON seller_member_portal_store_grants
BEGIN SELECT RAISE(ABORT,'seller_member_portal_grants_are_immutable'); END;

CREATE TRIGGER trg_seller_member_portal_grant_no_update
BEFORE UPDATE ON seller_member_portal_store_grants
WHEN NOT (
  NEW.member_id IS OLD.member_id AND NEW.organization_id IS OLD.organization_id
  AND NEW.store_id IS OLD.store_id AND NEW.granted_by_member_id IS OLD.granted_by_member_id
  AND NEW.created_at IS OLD.created_at AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
  AND NEW.revoked_at>=OLD.created_at
)
BEGIN SELECT RAISE(ABORT,'seller_member_portal_grant_invalid_update'); END;

CREATE TRIGGER trg_seller_member_portal_grant_scope_guard
BEFORE INSERT ON seller_member_portal_store_grants
WHEN NOT EXISTS(
  SELECT 1 FROM seller_organization_members member
  JOIN seller_stores store ON store.id=NEW.store_id
  JOIN seller_organization_members granter ON granter.id=NEW.granted_by_member_id
  WHERE member.id=NEW.member_id
    AND member.organization_id=NEW.organization_id
    AND member.status='ACTIVE'
    AND store.organization_id=NEW.organization_id
    AND store.status='ACTIVE'
    AND granter.organization_id=NEW.organization_id
    AND granter.primary_owner=1
    AND granter.status='ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT,'seller_member_portal_grant_scope_mismatch');
END;

CREATE TRIGGER trg_seller_partner_import_source_no_delete
BEFORE DELETE ON seller_partner_import_source_records
BEGIN
  SELECT RAISE(ABORT, 'seller_partner_import_source_records_are_immutable');
END;

CREATE TRIGGER trg_seller_partner_import_source_no_update
BEFORE UPDATE ON seller_partner_import_source_records
BEGIN
  SELECT RAISE(ABORT, 'seller_partner_import_source_records_are_immutable');
END;

CREATE TRIGGER trg_seller_scope_events_no_delete
BEFORE DELETE ON seller_member_store_scope_events
BEGIN
  SELECT RAISE(ABORT, 'seller_scope_events_are_immutable');
END;

CREATE TRIGGER trg_seller_scope_events_no_update
BEFORE UPDATE ON seller_member_store_scope_events
BEGIN
  SELECT RAISE(ABORT, 'seller_scope_events_are_immutable');
END;

CREATE TRIGGER trg_seller_store_events_no_delete
BEFORE DELETE ON seller_store_events
BEGIN
  SELECT RAISE(ABORT, 'seller_store_events_are_immutable');
END;

CREATE TRIGGER trg_seller_store_events_no_update
BEFORE UPDATE ON seller_store_events
BEGIN
  SELECT RAISE(ABORT, 'seller_store_events_are_immutable');
END;

CREATE TRIGGER trg_seller_store_marketplace_default
AFTER INSERT ON seller_stores
BEGIN
  INSERT INTO seller_store_marketplaces (
    store_id, seller_organization_id, marketplace_code, created_at
  ) VALUES (NEW.id, NEW.organization_id, 'AMAZON_JP', NEW.created_at);
END;

UPDATE app_schema_state
SET
  schema_version=4,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
