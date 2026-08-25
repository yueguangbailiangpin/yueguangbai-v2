-- Stage 4 (D-054): marketplace canonical unification — atomic removal of the
-- legacy 'JP' alias layer. Generated mechanically from the applied 0001-0019
-- final state (stage-4 generator, 2026-08-26):
--   * every table whose FK targeted the retired marketplaces(code) table is
--     rebuilt with marketplace_registry(code) as the FK authority;
--   * stored 'JP' short codes are rewritten to 'AMAZON_JP' in the same pass;
--   * formal_orders drops the JP marketplace_code column and renames
--     canonical_marketplace_code -> marketplace_code (single canonical column);
--   * marketplace_runtime_config drops legacy_order_code;
--   * five-code enums (RAKUTEN_JP/TIKTOK_JP preparation residue) collapse to
--     the three canonical codes;
--   * marketplace_legacy_aliases and marketplaces are dropped;
--   * seller assignment / customer-group triggers lose their alias joins and
--     JP case arms; the effective-dates view loses the dead Rakuten/TikTok arms.
-- Runtime API contracts accept exactly AMAZON_JP / AMAZON_US / COUPANG_KR
-- after this migration; historical 'JP' values survive only in the stage-6
-- historical import mapping layer.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=19 THEN 1 ELSE 0 END;

-- ===== drop triggers/views around rebuilt tables (recreated at the end) =====
DROP TRIGGER IF EXISTS trg_acquisition_assignment_insert_guard;
DROP TRIGGER IF EXISTS trg_acquisition_lead_link_first_touch_attribution;
DROP TRIGGER IF EXISTS trg_acquisition_source_correction_guard;
DROP TRIGGER IF EXISTS trg_buyer_invitation_consumed_link_acquisition_lead;
DROP TRIGGER IF EXISTS trg_buyer_marketplace_assignment_fact_guard;
DROP TRIGGER IF EXISTS trg_buyer_refund_obligation_source_guard;
DROP TRIGGER IF EXISTS trg_customer_account_identity_rebind_guard;
DROP TRIGGER IF EXISTS trg_customer_account_identity_rebind_persona_sync;
DROP TRIGGER IF EXISTS trg_customer_account_persona_after_account_buyer;
DROP TRIGGER IF EXISTS trg_customer_account_persona_source_guard;
DROP TRIGGER IF EXISTS trg_customer_account_personas_no_update;
DROP TRIGGER IF EXISTS trg_demand_order_schedule_insert_guard;
DROP TRIGGER IF EXISTS trg_formal_order_event_identity_guard;
DROP TRIGGER IF EXISTS trg_formal_order_financial_self_pay_guard;
DROP TRIGGER IF EXISTS trg_formal_order_financial_snapshot_guard;
DROP TRIGGER IF EXISTS trg_formal_order_marketplace_money_source_guard;
DROP TRIGGER IF EXISTS trg_order_archive_closure_insert_guard;
DROP TRIGGER IF EXISTS trg_order_archive_closure_reclose_source_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_event_identity_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_single_image_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_version_file_guard;
DROP TRIGGER IF EXISTS trg_order_instruction_historical_marker_guard;
DROP TRIGGER IF EXISTS trg_order_instruction_version_source_guard;
DROP TRIGGER IF EXISTS trg_product_version_main_image_guard;
DROP TRIGGER IF EXISTS trg_review_case_source_guard;
DROP TRIGGER IF EXISTS trg_seller_member_portal_grant_scope_guard;
DROP TRIGGER IF EXISTS trg_seller_payable_source_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_snapshot_confirmation_guard;
DROP TRIGGER IF EXISTS trg_seller_principal_rate_snapshot_guard;
DROP TRIGGER IF EXISTS trg_seller_staff_assignments_staff_guard;
DROP VIEW IF EXISTS formal_order_effective_dates;
DROP VIEW IF EXISTS formal_order_effective_operational_state;
DROP VIEW IF EXISTS internal_finance_cash_movements;
DROP VIEW IF EXISTS internal_order_finance_positions;
DROP VIEW IF EXISTS seller_organization_settlement_balances;
DROP TRIGGER IF EXISTS trg_buyer_refund_obligation_requires_normal_order;
DROP TRIGGER IF EXISTS trg_review_approval_requires_normal_order;
DROP TRIGGER IF EXISTS trg_review_service_fee_requires_normal_order;
DROP VIEW IF EXISTS internal_finance_exceptions;
DROP TRIGGER IF EXISTS trg_acquisition_channel_no_new_both;
DROP TRIGGER IF EXISTS trg_acquisition_channel_origin_guard;
DROP TRIGGER IF EXISTS trg_acquisition_channel_privacy_profile_after_insert;
DROP TRIGGER IF EXISTS trg_acquisition_channels_no_delete;
DROP TRIGGER IF EXISTS trg_acquisition_intake_fact_after_lead;
DROP TRIGGER IF EXISTS trg_acquisition_lead_immutable_origin;
DROP TRIGGER IF EXISTS trg_acquisition_lead_prospect_guard;
DROP TRIGGER IF EXISTS trg_acquisition_lead_prospect_insert_guard;
DROP TRIGGER IF EXISTS trg_acquisition_lead_prospect_source_update_guard;
DROP TRIGGER IF EXISTS trg_acquisition_leads_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_customer_marketplace_default;
DROP TRIGGER IF EXISTS trg_customer_account_persona_after_buyer;
DROP TRIGGER IF EXISTS trg_demand_batch_capacity_guard_insert;
DROP TRIGGER IF EXISTS trg_demand_batch_capacity_guard_update;
DROP TRIGGER IF EXISTS trg_demand_buyer_self_pay_publish_guard_insert;
DROP TRIGGER IF EXISTS trg_demand_buyer_self_pay_publish_guard_update;
DROP TRIGGER IF EXISTS trg_demand_buyer_self_pay_published_immutable;
DROP TRIGGER IF EXISTS trg_formal_order_instruction_guard;
DROP TRIGGER IF EXISTS trg_formal_order_non_jp_local_date_required;
DROP TRIGGER IF EXISTS trg_formal_order_number_claim_source_guard;
DROP TRIGGER IF EXISTS trg_formal_order_number_claim_transition_guard;
DROP TRIGGER IF EXISTS trg_formal_order_number_claims_no_delete;
DROP TRIGGER IF EXISTS trg_formal_order_number_conflicts_no_delete;
DROP TRIGGER IF EXISTS trg_formal_order_source_guard;
DROP TRIGGER IF EXISTS trg_formal_orders_no_delete;
DROP TRIGGER IF EXISTS trg_formal_orders_no_update;
DROP TRIGGER IF EXISTS trg_marketplace_runtime_config_no_delete;
DROP TRIGGER IF EXISTS trg_marketplace_runtime_config_no_update;
DROP TRIGGER IF EXISTS trg_order_evidence_duplicate_signal_after_version;
DROP TRIGGER IF EXISTS trg_order_evidence_duplicate_signals_no_delete;
DROP TRIGGER IF EXISTS trg_order_evidence_duplicate_signals_no_update;
DROP TRIGGER IF EXISTS trg_order_evidence_instruction_snapshot_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_marketplace_money_legacy_insert;
DROP TRIGGER IF EXISTS trg_order_evidence_submission_identity_immutable;
DROP TRIGGER IF EXISTS trg_order_evidence_submission_reservation_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_version_submission_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_versions_no_delete;
DROP TRIGGER IF EXISTS trg_order_evidence_versions_no_update;
DROP TRIGGER IF EXISTS trg_order_instruction_identity_immutable;
DROP TRIGGER IF EXISTS trg_order_instruction_reservation_guard;
DROP TRIGGER IF EXISTS trg_order_instruction_transition_guard;
DROP TRIGGER IF EXISTS trg_order_instructions_no_delete;
DROP TRIGGER IF EXISTS trg_reservation_self_pay_snapshot_immutable;
DROP TRIGGER IF EXISTS trg_reservation_self_pay_snapshot_insert_guard;
DROP TRIGGER IF EXISTS trg_seller_customer_group_after_org;
DROP TRIGGER IF EXISTS trg_seller_store_marketplace_default;
DROP TRIGGER IF EXISTS trg_staff_assignment_fallbacks_insert_guard;
DROP TRIGGER IF EXISTS trg_staff_assignment_fallbacks_update_guard;
DROP TRIGGER IF EXISTS trg_staff_work_item_marketplace_after_insert;
DROP TRIGGER IF EXISTS trg_staff_work_items_assignment_guard;
DROP TRIGGER IF EXISTS trg_staff_work_items_no_delete;
DROP TRIGGER IF EXISTS trg_staff_work_items_update_guard;

-- ===== buyer_customers =====
CREATE TABLE buyer_customers_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  identity_subject_id TEXT NOT NULL UNIQUE
    REFERENCES customer_identity_subjects(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
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
  disabled_at INTEGER, refund_account_name TEXT
  CHECK (refund_account_name IS NULL
    OR length(refund_account_name) BETWEEN 1 AND 100), refund_account_identifier TEXT
  CHECK (refund_account_identifier IS NULL
    OR length(refund_account_identifier) BETWEEN 3 AND 128),
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
INSERT INTO buyer_customers_stage4_new (id, identity_subject_id, marketplace_code, buyer_channel_id, buyer_customer_no, buyer_sequence, first_valid_order_business_date, display_name, access_status, identity_review_status, version, created_at, updated_at, activated_at, disabled_at, refund_account_name, refund_account_identifier)
SELECT id, identity_subject_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, buyer_channel_id, buyer_customer_no, buyer_sequence, first_valid_order_business_date, display_name, access_status, identity_review_status, version, created_at, updated_at, activated_at, disabled_at, refund_account_name, refund_account_identifier
FROM buyer_customers;
DROP TABLE buyer_customers;
ALTER TABLE buyer_customers_stage4_new RENAME TO buyer_customers;
CREATE INDEX idx_buyer_customer_status_channel
ON buyer_customers (
  access_status,
  buyer_channel_id,
  created_at,
  id
);
CREATE UNIQUE INDEX uq_buyer_channel_sequence
ON buyer_customers (
  buyer_channel_id,
  buyer_sequence
)
WHERE buyer_sequence IS NOT NULL;
CREATE UNIQUE INDEX uq_buyer_customers_id_marketplace
ON buyer_customers (
  id,
  marketplace_code
);

-- ===== seller_organizations =====
CREATE TABLE seller_organizations_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
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
  disabled_at INTEGER, next_member_number INTEGER NOT NULL DEFAULT 2
CHECK (next_member_number >= 2), settlement_account_name TEXT
  CHECK (settlement_account_name IS NULL
    OR length(settlement_account_name) BETWEEN 1 AND 100), settlement_account_identifier TEXT
  CHECK (settlement_account_identifier IS NULL
    OR length(settlement_account_identifier) BETWEEN 3 AND 128),
  UNIQUE (origin_channel_id, seller_sequence),
  CHECK (
    (status='ACTIVE'
      AND activated_at IS NOT NULL
      AND disabled_at IS NULL)
    OR
    (status='DISABLED')
  )
) STRICT;
INSERT INTO seller_organizations_stage4_new (id, marketplace_code, seller_code, origin_channel_id, current_channel_id, seller_sequence, organization_name, status, version, created_at, updated_at, activated_at, disabled_at, next_member_number, settlement_account_name, settlement_account_identifier)
SELECT id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, seller_code, origin_channel_id, current_channel_id, seller_sequence, organization_name, status, version, created_at, updated_at, activated_at, disabled_at, next_member_number, settlement_account_name, settlement_account_identifier
FROM seller_organizations;
DROP TABLE seller_organizations;
ALTER TABLE seller_organizations_stage4_new RENAME TO seller_organizations;
CREATE INDEX idx_seller_org_status_channel
ON seller_organizations (
  status,
  current_channel_id,
  created_at,
  id
);

-- ===== seller_stores =====
CREATE TABLE seller_stores_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
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
INSERT INTO seller_stores_stage4_new (id, organization_id, marketplace_code, display_name, normalized_name, status, version, created_at, updated_at, disabled_at)
SELECT id, organization_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, display_name, normalized_name, status, version, created_at, updated_at, disabled_at
FROM seller_stores;
DROP TABLE seller_stores;
ALTER TABLE seller_stores_stage4_new RENAME TO seller_stores;
CREATE INDEX idx_seller_stores_org_status
ON seller_stores (
  organization_id,
  status,
  display_name,
  id
);

-- ===== products =====
CREATE TABLE products_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL,
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
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
INSERT INTO products_stage4_new (id, organization_id, store_id, marketplace_code, asin_display, asin_normalized, status, current_version_no, version, created_at, updated_at, disabled_at)
SELECT id, organization_id, store_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, asin_display, asin_normalized, status, current_version_no, version, created_at, updated_at, disabled_at
FROM products;
DROP TABLE products;
ALTER TABLE products_stage4_new RENAME TO products;
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
CREATE UNIQUE INDEX uq_products_id_org_store_marketplace
ON products (
  id,
  organization_id,
  store_id,
  marketplace_code
);

-- ===== product_applications =====
CREATE TABLE product_applications_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL,
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
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
INSERT INTO product_applications_stage4_new (id, organization_id, store_id, marketplace_code, submitted_by_member_id, asin_display, asin_normalized, product_name, search_keywords_json, product_url, buyer_visible_notes, seller_notes, status, review_reason, reviewed_by_staff_id, product_id, version, submitted_at, updated_at, reviewed_at, withdrawn_at, ordering_guide_expected_amount_jpy)
SELECT id, organization_id, store_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, submitted_by_member_id, asin_display, asin_normalized, product_name, search_keywords_json, product_url, buyer_visible_notes, seller_notes, status, review_reason, reviewed_by_staff_id, product_id, version, submitted_at, updated_at, reviewed_at, withdrawn_at, ordering_guide_expected_amount_jpy
FROM product_applications;
DROP TABLE product_applications;
ALTER TABLE product_applications_stage4_new RENAME TO product_applications;
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
CREATE UNIQUE INDEX uq_product_application_submitted_asin
ON product_applications (
  marketplace_code,
  asin_normalized
)
WHERE status='SUBMITTED';

-- ===== demand_batches =====
CREATE TABLE demand_batches_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL,
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
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
INSERT INTO demand_batches_stage4_new (id, organization_id, store_id, marketplace_code, product_id, product_version_no, submitted_by_member_id, task_type, target_quantity, buyer_visible_notes, seller_notes, open_at, reservation_deadline, order_deadline, status, review_reason, close_reason, reviewed_by_staff_id, closed_by_staff_id, version, submitted_at, updated_at, reviewed_at, published_at, withdrawn_at, closed_at, held_reservation_count, approved_reservation_count, buyer_self_pay_bps_snapshot, buyer_self_pay_source, buyer_self_pay_override_reason)
SELECT id, organization_id, store_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, product_id, product_version_no, submitted_by_member_id, task_type, target_quantity, buyer_visible_notes, seller_notes, open_at, reservation_deadline, order_deadline, status, review_reason, close_reason, reviewed_by_staff_id, closed_by_staff_id, version, submitted_at, updated_at, reviewed_at, published_at, withdrawn_at, closed_at, held_reservation_count, approved_reservation_count, buyer_self_pay_bps_snapshot, buyer_self_pay_source, buyer_self_pay_override_reason
FROM demand_batches;
DROP TABLE demand_batches;
ALTER TABLE demand_batches_stage4_new RENAME TO demand_batches;
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
CREATE UNIQUE INDEX uq_demand_batches_reservation_snapshot
ON demand_batches (
  id,
  organization_id,
  store_id,
  product_id,
  product_version_no,
  marketplace_code
);

-- ===== product_reservations =====
CREATE TABLE product_reservations_stage4_new (
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
    REFERENCES marketplace_registry(code),
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
INSERT INTO product_reservations_stage4_new (id, demand_batch_id, buyer_customer_id, organization_id, store_id, product_id, product_version_no, marketplace_code, status, precheck_snapshot_json, hold_expires_at, order_deadline_snapshot, version, submitted_at, updated_at, decided_by_staff_id, decision_reason, decided_at, cancelled_at, expired_at, reopened_count, buyer_self_pay_bps_snapshot, reference_order_amount_jpy_snapshot, estimated_self_pay_jpy_snapshot, estimated_refundable_principal_jpy_snapshot, buyer_self_pay_accepted_at, buyer_self_pay_accepted_demand_version)
SELECT id, demand_batch_id, buyer_customer_id, organization_id, store_id, product_id, product_version_no, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, status, precheck_snapshot_json, hold_expires_at, order_deadline_snapshot, version, submitted_at, updated_at, decided_by_staff_id, decision_reason, decided_at, cancelled_at, expired_at, reopened_count, buyer_self_pay_bps_snapshot, reference_order_amount_jpy_snapshot, estimated_self_pay_jpy_snapshot, estimated_refundable_principal_jpy_snapshot, buyer_self_pay_accepted_at, buyer_self_pay_accepted_demand_version
FROM product_reservations;
DROP TABLE product_reservations;
ALTER TABLE product_reservations_stage4_new RENAME TO product_reservations;
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
CREATE UNIQUE INDEX uq_active_buyer_product_reservation
ON product_reservations (
  buyer_customer_id,
  product_id
)
WHERE status IN (
  'PENDING_REVIEW',
  'APPROVED'
);

-- ===== order_instructions =====
CREATE TABLE order_instructions_stage4_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  reservation_id TEXT NOT NULL UNIQUE REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  status TEXT NOT NULL CHECK (status IN (
    'UNPUBLISHED', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'COMPLETED'
  )),
  current_version_no INTEGER NOT NULL DEFAULT 0 CHECK (current_version_no >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  published_at INTEGER CHECK (published_at IS NULL OR published_at >= 0),
  initial_deadline_at INTEGER CHECK (
    initial_deadline_at IS NULL OR initial_deadline_at > published_at
  ),
  resubmission_deadline_at INTEGER CHECK (
    resubmission_deadline_at IS NULL OR resubmission_deadline_at >= 0
  ),
  expired_at INTEGER CHECK (expired_at IS NULL OR expired_at >= 0),
  cancelled_at INTEGER CHECK (cancelled_at IS NULL OR cancelled_at >= 0),
  completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (status='UNPUBLISHED'
      AND current_version_no=0
      AND published_at IS NULL
      AND initial_deadline_at IS NULL
      AND expired_at IS NULL
      AND cancelled_at IS NULL
      AND completed_at IS NULL)
    OR
    (status='ACTIVE'
      AND current_version_no>=1
      AND published_at IS NOT NULL
      AND initial_deadline_at IS NOT NULL
      AND expired_at IS NULL
      AND cancelled_at IS NULL
      AND completed_at IS NULL)
    OR
    (status='EXPIRED'
      AND expired_at IS NOT NULL
      AND cancelled_at IS NULL
      AND completed_at IS NULL)
    OR
    (status='CANCELLED'
      AND cancelled_at IS NOT NULL
      AND expired_at IS NULL
      AND completed_at IS NULL)
    OR
    (status='COMPLETED'
      AND current_version_no>=1
      AND completed_at IS NOT NULL
      AND expired_at IS NULL
      AND cancelled_at IS NULL)
  )
) STRICT;
INSERT INTO order_instructions_stage4_new (id, reservation_id, buyer_customer_id, marketplace_code, status, current_version_no, version, published_at, initial_deadline_at, resubmission_deadline_at, expired_at, cancelled_at, completed_at, created_at, updated_at)
SELECT id, reservation_id, buyer_customer_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, status, current_version_no, version, published_at, initial_deadline_at, resubmission_deadline_at, expired_at, cancelled_at, completed_at, created_at, updated_at
FROM order_instructions;
DROP TABLE order_instructions;
ALTER TABLE order_instructions_stage4_new RENAME TO order_instructions;
CREATE INDEX idx_order_instructions_buyer_status
ON order_instructions (buyer_customer_id, status, updated_at, id);
CREATE INDEX idx_order_instructions_expiry
ON order_instructions (
  marketplace_code, status,
  initial_deadline_at, resubmission_deadline_at, id
);

-- ===== order_evidence_submissions =====
CREATE TABLE order_evidence_submissions_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  reservation_id TEXT NOT NULL UNIQUE
    REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
  status TEXT NOT NULL
    CHECK (status IN (
      'PENDING_VERIFICATION',
      'CHANGES_REQUESTED',
      'VERIFIED',
      'WITHDRAWN',
      'CONSUMED'
    )),
  current_version_no INTEGER NOT NULL
    CHECK (current_version_no >= 1),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  public_change_reason TEXT
    CHECK (
      public_change_reason IS NULL
      OR length(public_change_reason) BETWEEN 1 AND 2000
    ),
  internal_review_note TEXT
    CHECK (
      internal_review_note IS NULL
      OR length(internal_review_note) BETWEEN 1 AND 4000
    ),
  submitted_at INTEGER NOT NULL
    CHECK (submitted_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= submitted_at),
  verified_by_staff_id TEXT
    REFERENCES staff_users(id),
  verified_at INTEGER
    CHECK (verified_at IS NULL OR verified_at >= submitted_at),
  withdrawn_at INTEGER
    CHECK (withdrawn_at IS NULL OR withdrawn_at >= submitted_at),
  consumed_at INTEGER
    CHECK (consumed_at IS NULL OR consumed_at >= submitted_at),
  created_at INTEGER NOT NULL
    CHECK (created_at = submitted_at), resubmission_deadline_at INTEGER
  CHECK (
    resubmission_deadline_at IS NULL
    OR resubmission_deadline_at >= submitted_at
  ),
  CHECK (
    (
      status='PENDING_VERIFICATION'
      AND public_change_reason IS NULL
      AND verified_by_staff_id IS NULL
      AND verified_at IS NULL
      AND withdrawn_at IS NULL
      AND consumed_at IS NULL
    )
    OR
    (
      status='CHANGES_REQUESTED'
      AND public_change_reason IS NOT NULL
      AND verified_by_staff_id IS NULL
      AND verified_at IS NULL
      AND withdrawn_at IS NULL
      AND consumed_at IS NULL
    )
    OR
    (
      status='VERIFIED'
      AND public_change_reason IS NULL
      AND verified_by_staff_id IS NOT NULL
      AND verified_at IS NOT NULL
      AND withdrawn_at IS NULL
      AND consumed_at IS NULL
    )
    OR
    (
      status='WITHDRAWN'
      AND verified_by_staff_id IS NULL
      AND verified_at IS NULL
      AND withdrawn_at IS NOT NULL
      AND consumed_at IS NULL
    )
    OR
    (
      status='CONSUMED'
      AND public_change_reason IS NULL
      AND verified_by_staff_id IS NOT NULL
      AND verified_at IS NOT NULL
      AND withdrawn_at IS NULL
      AND consumed_at IS NOT NULL
    )
  )
) STRICT;
INSERT INTO order_evidence_submissions_stage4_new (id, reservation_id, buyer_customer_id, marketplace_code, status, current_version_no, version, public_change_reason, internal_review_note, submitted_at, updated_at, verified_by_staff_id, verified_at, withdrawn_at, consumed_at, created_at, resubmission_deadline_at)
SELECT id, reservation_id, buyer_customer_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, status, current_version_no, version, public_change_reason, internal_review_note, submitted_at, updated_at, verified_by_staff_id, verified_at, withdrawn_at, consumed_at, created_at, resubmission_deadline_at
FROM order_evidence_submissions;
DROP TABLE order_evidence_submissions;
ALTER TABLE order_evidence_submissions_stage4_new RENAME TO order_evidence_submissions;
CREATE INDEX idx_order_evidence_submission_buyer
ON order_evidence_submissions (
  buyer_customer_id,
  updated_at,
  id
);
CREATE INDEX idx_order_evidence_submission_queue
ON order_evidence_submissions (
  status,
  updated_at,
  id
);
CREATE INDEX idx_order_evidence_submission_submitted
ON order_evidence_submissions (status, submitted_at, id);

-- ===== order_evidence_versions =====
CREATE TABLE order_evidence_versions_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL
    REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplace_registry(code),
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  amazon_order_number_raw TEXT NOT NULL
    CHECK (length(amazon_order_number_raw) BETWEEN 1 AND 100),
  amazon_order_number_normalized TEXT NOT NULL
    CHECK (
      length(amazon_order_number_normalized)=19
      AND substr(amazon_order_number_normalized, 4, 1)='-'
      AND substr(amazon_order_number_normalized, 12, 1)='-'
      AND length(replace(amazon_order_number_normalized, '-', ''))=17
      AND replace(amazon_order_number_normalized, '-', '')
        NOT GLOB '*[^0-9]*'
    ),
  final_paid_jpy INTEGER NOT NULL
    CHECK (final_paid_jpy BETWEEN 0 AND 9007199254740991),
  submitted_by_buyer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  buyer_note TEXT
    CHECK (
      buyer_note IS NULL
      OR length(buyer_note) BETWEEN 1 AND 2000
    ),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0), order_instruction_id TEXT REFERENCES order_instructions(id), order_instruction_version_id TEXT REFERENCES order_instruction_versions(id), instruction_deadline_snapshot INTEGER
  CHECK (
    instruction_deadline_snapshot IS NULL
    OR instruction_deadline_snapshot >= 0
  ), reference_order_amount_jpy_snapshot INTEGER
  CHECK (
    reference_order_amount_jpy_snapshot IS NULL
    OR reference_order_amount_jpy_snapshot BETWEEN 0 AND 9007199254740991
  ), buyer_self_pay_bps_snapshot INTEGER
  CHECK (
    buyer_self_pay_bps_snapshot IS NULL
    OR buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  ), buyer_self_pay_jpy INTEGER
  CHECK (
    buyer_self_pay_jpy IS NULL
    OR buyer_self_pay_jpy BETWEEN 0 AND 9007199254740991
  ), buyer_refundable_principal_jpy INTEGER
  CHECK (
    buyer_refundable_principal_jpy IS NULL
    OR buyer_refundable_principal_jpy BETWEEN 0 AND 9007199254740991
  ), price_mismatch INTEGER
  CHECK (price_mismatch IS NULL OR price_mismatch IN (0, 1)), price_difference_jpy INTEGER
  CHECK (
    price_difference_jpy IS NULL
    OR price_difference_jpy BETWEEN -9007199254740991 AND 9007199254740991
  ), submitted_before_deadline INTEGER
  CHECK (submitted_before_deadline IS NULL OR submitted_before_deadline IN (0, 1)), evidence_file_object_id TEXT REFERENCES file_objects(id), amazon_order_date TEXT
  CHECK (
    amazon_order_date IS NULL
    OR (
      length(amazon_order_date)=10
      AND amazon_order_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(amazon_order_date) IS NOT NULL
      AND date(amazon_order_date)=amazon_order_date
    )
  ),
  UNIQUE (submission_id, version_no)
) STRICT;
INSERT INTO order_evidence_versions_stage4_new (id, submission_id, reservation_id, buyer_customer_id, marketplace_code, version_no, amazon_order_number_raw, amazon_order_number_normalized, final_paid_jpy, submitted_by_buyer_id, buyer_note, created_at, order_instruction_id, order_instruction_version_id, instruction_deadline_snapshot, reference_order_amount_jpy_snapshot, buyer_self_pay_bps_snapshot, buyer_self_pay_jpy, buyer_refundable_principal_jpy, price_mismatch, price_difference_jpy, submitted_before_deadline, evidence_file_object_id, amazon_order_date)
SELECT id, submission_id, reservation_id, buyer_customer_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, version_no, amazon_order_number_raw, amazon_order_number_normalized, final_paid_jpy, submitted_by_buyer_id, buyer_note, created_at, order_instruction_id, order_instruction_version_id, instruction_deadline_snapshot, reference_order_amount_jpy_snapshot, buyer_self_pay_bps_snapshot, buyer_self_pay_jpy, buyer_refundable_principal_jpy, price_mismatch, price_difference_jpy, submitted_before_deadline, evidence_file_object_id, amazon_order_date
FROM order_evidence_versions;
DROP TABLE order_evidence_versions;
ALTER TABLE order_evidence_versions_stage4_new RENAME TO order_evidence_versions;
CREATE INDEX idx_order_evidence_version_normalized_order
ON order_evidence_versions (
  marketplace_code,
  amazon_order_number_normalized,
  created_at,
  id
);
CREATE INDEX idx_order_evidence_version_reservation
ON order_evidence_versions (
  reservation_id,
  version_no,
  id
);
CREATE INDEX idx_order_evidence_versions_instruction
ON order_evidence_versions (
  order_instruction_id,
  order_instruction_version_id,
  version_no,
  id
);

-- ===== order_evidence_duplicate_signals =====
CREATE TABLE order_evidence_duplicate_signals_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  source_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  conflicting_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  marketplace_code TEXT NOT NULL,
  amazon_order_number_normalized TEXT NOT NULL
    CHECK (length(amazon_order_number_normalized)=19),
  detected_at INTEGER NOT NULL
    CHECK (detected_at >= 0),
  UNIQUE (source_version_id, conflicting_version_id),
  CHECK (source_version_id<>conflicting_version_id)
) STRICT;
INSERT INTO order_evidence_duplicate_signals_stage4_new (id, source_version_id, conflicting_version_id, marketplace_code, amazon_order_number_normalized, detected_at)
SELECT id, source_version_id, conflicting_version_id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, amazon_order_number_normalized, detected_at
FROM order_evidence_duplicate_signals;
DROP TABLE order_evidence_duplicate_signals;
ALTER TABLE order_evidence_duplicate_signals_stage4_new RENAME TO order_evidence_duplicate_signals;
CREATE INDEX idx_order_evidence_duplicate_signal_source
ON order_evidence_duplicate_signals (
  source_version_id,
  detected_at,
  id
);

-- ===== formal_orders (dropped: canonical_marketplace_code) =====
CREATE TABLE formal_orders_stage4_new (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  order_evidence_submission_id TEXT NOT NULL UNIQUE
    REFERENCES order_evidence_submissions(id),
  order_evidence_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  reservation_id TEXT NOT NULL UNIQUE
    REFERENCES product_reservations(id),
  demand_batch_id TEXT NOT NULL
    REFERENCES demand_batches(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  buyer_customer_no TEXT NOT NULL
    CHECK (length(buyer_customer_no) BETWEEN 3 AND 120),
  seller_organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  store_id TEXT NOT NULL
    REFERENCES seller_stores(id), product_id TEXT NOT NULL
    REFERENCES products(id),
  product_version_id TEXT NOT NULL
    REFERENCES product_versions(id),
  product_version_no INTEGER NOT NULL
    CHECK (product_version_no >= 1),
  asin_display TEXT NOT NULL
    CHECK (length(asin_display)=10),
  asin_normalized TEXT NOT NULL
    CHECK (
      length(asin_normalized)=10
      AND asin_normalized NOT GLOB '*[^A-Z0-9]*'
    ),
  product_name_snapshot TEXT NOT NULL
    CHECK (length(product_name_snapshot) BETWEEN 1 AND 200),
  review_type TEXT NOT NULL
    CHECK (review_type IN ('RATING', 'TEXT', 'IMAGE', 'VIDEO')),
  amazon_order_number_raw TEXT NOT NULL
    CHECK (length(amazon_order_number_raw) BETWEEN 1 AND 100),
  amazon_order_number_normalized TEXT NOT NULL
    CHECK (
      length(amazon_order_number_normalized)=19
      AND substr(amazon_order_number_normalized, 4, 1)='-'
      AND substr(amazon_order_number_normalized, 12, 1)='-'
      AND length(replace(amazon_order_number_normalized, '-', ''))=17
      AND replace(amazon_order_number_normalized, '-', '')
        NOT GLOB '*[^0-9]*'
    ),
  final_paid_jpy INTEGER NOT NULL
    CHECK (final_paid_jpy BETWEEN 0 AND 9007199254740991),
  status TEXT NOT NULL
    CHECK (status='CONFIRMED'),
  version INTEGER NOT NULL
    CHECK (version=1),
  confirmed_by_staff_id TEXT NOT NULL
    REFERENCES staff_users(id),
  confirmed_at INTEGER NOT NULL
    CHECK (confirmed_at >= 0),
  confirmed_business_date TEXT NOT NULL
    CHECK (
      confirmed_business_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(confirmed_business_date)=confirmed_business_date
    ),
  created_at INTEGER NOT NULL
    CHECK (created_at=confirmed_at)
, order_instruction_id TEXT REFERENCES order_instructions(id), order_instruction_version_id TEXT REFERENCES order_instruction_versions(id), amazon_order_date TEXT
  CHECK (
    amazon_order_date IS NULL
    OR (
      length(amazon_order_date)=10
      AND amazon_order_date GLOB
        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(amazon_order_date) IS NOT NULL
      AND date(amazon_order_date)=amazon_order_date
    )
  ), marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP'
  REFERENCES marketplace_registry(code)
  CHECK (marketplace_code IN ('AMAZON_JP','AMAZON_US','COUPANG_KR')), marketplace_business_date TEXT CHECK (
  marketplace_business_date IS NULL OR (
    marketplace_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(marketplace_business_date)=marketplace_business_date
  )
)) STRICT;
INSERT INTO formal_orders_stage4_new (id, order_evidence_submission_id, order_evidence_version_id, reservation_id, demand_batch_id, buyer_customer_id, buyer_customer_no, seller_organization_id, store_id, product_id, product_version_id, product_version_no, asin_display, asin_normalized, product_name_snapshot, review_type, amazon_order_number_raw, amazon_order_number_normalized, final_paid_jpy, status, version, confirmed_by_staff_id, confirmed_at, confirmed_business_date, created_at, order_instruction_id, order_instruction_version_id, amazon_order_date, marketplace_code, marketplace_business_date)
SELECT id, order_evidence_submission_id, order_evidence_version_id, reservation_id, demand_batch_id, buyer_customer_id, buyer_customer_no, seller_organization_id, store_id, product_id, product_version_id, product_version_no, asin_display, asin_normalized, product_name_snapshot, review_type, amazon_order_number_raw, amazon_order_number_normalized, final_paid_jpy, status, version, confirmed_by_staff_id, confirmed_at, confirmed_business_date, created_at, order_instruction_id, order_instruction_version_id, amazon_order_date, canonical_marketplace_code, marketplace_business_date
FROM formal_orders;
DROP TABLE formal_orders;
ALTER TABLE formal_orders_stage4_new RENAME TO formal_orders;
CREATE INDEX idx_formal_orders_amazon_order_signal
ON formal_orders (
  marketplace_code,
  amazon_order_number_normalized,
  confirmed_at,
  id
);
CREATE INDEX idx_formal_orders_buyer_confirmed
ON formal_orders (
  buyer_customer_id,
  confirmed_at,
  id
);
CREATE INDEX idx_formal_orders_canonical_market_date
ON formal_orders(marketplace_code,confirmed_business_date,id);
CREATE INDEX idx_formal_orders_confirmed_business_date
ON formal_orders (confirmed_business_date, id);
CREATE INDEX idx_formal_orders_instruction
ON formal_orders (order_instruction_id, order_instruction_version_id, id);
CREATE INDEX idx_formal_orders_marketplace_business_date
ON formal_orders(marketplace_code,marketplace_business_date,id);
CREATE INDEX idx_formal_orders_seller_confirmed
ON formal_orders (
  seller_organization_id,
  confirmed_at,
  id
);
CREATE INDEX idx_formal_orders_store_confirmed
ON formal_orders (
  store_id,
  confirmed_at,
  id
);

-- ===== formal_order_number_claims =====
CREATE TABLE formal_order_number_claims_stage4_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  amazon_order_number_normalized TEXT NOT NULL CHECK (
    length(amazon_order_number_normalized)=19
  ),
  evidence_submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  current_evidence_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  formal_order_id TEXT UNIQUE
    REFERENCES formal_orders(id) DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL CHECK (status IN ('PROVISIONAL','FINAL','RELEASED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  claimed_at INTEGER NOT NULL CHECK (claimed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= claimed_at),
  finalized_at INTEGER CHECK (finalized_at IS NULL OR finalized_at >= claimed_at),
  released_at INTEGER CHECK (released_at IS NULL OR released_at >= claimed_at),
  CHECK (
    (status='PROVISIONAL' AND formal_order_id IS NULL
      AND finalized_at IS NULL AND released_at IS NULL)
    OR (status='FINAL' AND formal_order_id IS NOT NULL
      AND finalized_at IS NOT NULL AND released_at IS NULL)
    OR (status='RELEASED' AND formal_order_id IS NULL
      AND finalized_at IS NULL AND released_at IS NOT NULL)
  )
) STRICT;
INSERT INTO formal_order_number_claims_stage4_new (id, marketplace_code, amazon_order_number_normalized, evidence_submission_id, current_evidence_version_id, formal_order_id, status, version, claimed_at, updated_at, finalized_at, released_at)
SELECT id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, amazon_order_number_normalized, evidence_submission_id, current_evidence_version_id, formal_order_id, status, version, claimed_at, updated_at, finalized_at, released_at
FROM formal_order_number_claims;
DROP TABLE formal_order_number_claims;
ALTER TABLE formal_order_number_claims_stage4_new RENAME TO formal_order_number_claims;
CREATE INDEX idx_formal_order_number_claims_status
ON formal_order_number_claims (status, updated_at, id);
CREATE UNIQUE INDEX uq_formal_order_number_claims_active
ON formal_order_number_claims (
  marketplace_code, amazon_order_number_normalized
)
WHERE status IN ('PROVISIONAL','FINAL');
CREATE UNIQUE INDEX uq_formal_order_number_claims_submission_active
ON formal_order_number_claims (evidence_submission_id)
WHERE status IN ('PROVISIONAL','FINAL');

-- ===== formal_order_number_conflicts =====
CREATE TABLE formal_order_number_conflicts_stage4_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  amazon_order_number_normalized TEXT NOT NULL CHECK (
    length(amazon_order_number_normalized)=19
  ),
  formal_order_ids_json TEXT NOT NULL CHECK (
    json_valid(formal_order_ids_json)
    AND json_type(formal_order_ids_json)='array'
    AND json_array_length(formal_order_ids_json)>=2
  ),
  detected_at INTEGER NOT NULL CHECK (detected_at >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution_note TEXT CHECK (
    resolution_note IS NULL OR length(resolution_note) BETWEEN 1 AND 4000
  ),
  UNIQUE (marketplace_code, amazon_order_number_normalized),
  CHECK (
    (status='OPEN' AND resolution_note IS NULL)
    OR (status='RESOLVED' AND resolution_note IS NOT NULL)
  )
) STRICT;
INSERT INTO formal_order_number_conflicts_stage4_new (id, marketplace_code, amazon_order_number_normalized, formal_order_ids_json, detected_at, status, resolution_note)
SELECT id, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, amazon_order_number_normalized, formal_order_ids_json, detected_at, status, resolution_note
FROM formal_order_number_conflicts;
DROP TABLE formal_order_number_conflicts;
ALTER TABLE formal_order_number_conflicts_stage4_new RENAME TO formal_order_number_conflicts;

-- ===== order_instruction_expiry_scan_cursors =====
CREATE TABLE order_instruction_expiry_scan_cursors_stage4_new (
  marketplace_code TEXT PRIMARY KEY REFERENCES marketplace_registry(code),
  deadline_at INTEGER CHECK (deadline_at IS NULL OR deadline_at >= 0),
  instruction_id TEXT CHECK (
    instruction_id IS NULL OR length(instruction_id) BETWEEN 1 AND 120
  ),
  scanned_at INTEGER NOT NULL CHECK (scanned_at >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (deadline_at IS NULL AND instruction_id IS NULL)
    OR (deadline_at IS NOT NULL AND instruction_id IS NOT NULL)
  )
) STRICT;
INSERT INTO order_instruction_expiry_scan_cursors_stage4_new (marketplace_code, deadline_at, instruction_id, scanned_at, version, created_at, updated_at)
SELECT CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, deadline_at, instruction_id, scanned_at, version, created_at, updated_at
FROM order_instruction_expiry_scan_cursors;
DROP TABLE order_instruction_expiry_scan_cursors;
ALTER TABLE order_instruction_expiry_scan_cursors_stage4_new RENAME TO order_instruction_expiry_scan_cursors;

-- ===== staff_assignment_cursors =====
CREATE TABLE staff_assignment_cursors_stage4_new (
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'SELLER_ACCOUNT_MANAGER',
    'BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER',
    'BUYER_REFUND_OWNER'
  )),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  candidate_pool_key TEXT NOT NULL DEFAULT 'DEFAULT'
    CHECK (length(candidate_pool_key) BETWEEN 1 AND 200),
  team_id TEXT REFERENCES staff_teams(id),
  last_assigned_staff_id TEXT REFERENCES staff_users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (duty_code, marketplace_code, candidate_pool_key),
  CHECK (
    (team_id IS NULL AND candidate_pool_key='DEFAULT')
    OR
    (team_id IS NOT NULL AND candidate_pool_key=team_id)
  )
) STRICT;
INSERT INTO staff_assignment_cursors_stage4_new (duty_code, marketplace_code, candidate_pool_key, team_id, last_assigned_staff_id, version, created_at, updated_at)
SELECT duty_code, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, candidate_pool_key, team_id, last_assigned_staff_id, version, created_at, updated_at
FROM staff_assignment_cursors;
DROP TABLE staff_assignment_cursors;
ALTER TABLE staff_assignment_cursors_stage4_new RENAME TO staff_assignment_cursors;
CREATE INDEX idx_staff_assignment_cursor_last_staff
ON staff_assignment_cursors (
  marketplace_code, duty_code, last_assigned_staff_id
);

-- ===== staff_assignment_fallbacks =====
CREATE TABLE staff_assignment_fallbacks_stage4_new (
  marketplace_code TEXT PRIMARY KEY REFERENCES marketplace_registry(code),
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  configured_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;
INSERT INTO staff_assignment_fallbacks_stage4_new (marketplace_code, staff_id, version, configured_by_staff_id, created_at, updated_at)
SELECT CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, staff_id, version, configured_by_staff_id, created_at, updated_at
FROM staff_assignment_fallbacks;
DROP TABLE staff_assignment_fallbacks;
ALTER TABLE staff_assignment_fallbacks_stage4_new RENAME TO staff_assignment_fallbacks;

-- ===== staff_work_items =====
CREATE TABLE staff_work_items_stage4_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  work_type TEXT NOT NULL CHECK (work_type IN (
    'PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW','RESERVATION_DECISION',
    'ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW','REVIEW_DECISION',
    'BUYER_REFUND_PROCESSING'
  )),
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN (
    'PRODUCT_APPLICATION','DEMAND_BATCH','RESERVATION','ORDER_INSTRUCTION',
    'ORDER_EVIDENCE','REVIEW_CASE','BUYER_REFUND_OBLIGATION'
  )),
  source_entity_id TEXT NOT NULL CHECK (length(source_entity_id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT REFERENCES buyer_customers(id),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  store_id TEXT REFERENCES seller_stores(id),
  duty_code TEXT NOT NULL CHECK (duty_code IN (
    'SELLER_ACCOUNT_MANAGER','BUYER_PRE_SALES_OWNER',
    'BUYER_AFTER_SALES_OWNER','BUYER_REFUND_OWNER'
  )),
  fixed_assignment_type TEXT NOT NULL CHECK (
    fixed_assignment_type IN ('BUYER','SELLER')
  ),
  fixed_assignment_id TEXT NOT NULL CHECK (length(fixed_assignment_id) BETWEEN 1 AND 200),
  assigned_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER,
  cancelled_at INTEGER, marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR'
  )),
  CHECK (
    (work_type IN ('PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW')
      AND source_entity_type IN ('PRODUCT_APPLICATION','DEMAND_BATCH')
      AND duty_code='SELLER_ACCOUNT_MANAGER'
      AND fixed_assignment_type='SELLER'
      AND seller_organization_id IS NOT NULL)
    OR
    (work_type IN (
        'RESERVATION_DECISION','ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW'
      )
      AND source_entity_type IN (
        'RESERVATION','ORDER_INSTRUCTION','ORDER_EVIDENCE'
      )
      AND duty_code='BUYER_PRE_SALES_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
    OR
    (work_type='REVIEW_DECISION'
      AND source_entity_type='REVIEW_CASE'
      AND duty_code='BUYER_AFTER_SALES_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
    OR
    (work_type='BUYER_REFUND_PROCESSING'
      AND source_entity_type='BUYER_REFUND_OBLIGATION'
      AND duty_code='BUYER_REFUND_OWNER'
      AND fixed_assignment_type='BUYER'
      AND buyer_customer_id IS NOT NULL)
  ),
  CHECK (
    (status='OPEN' AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (status='COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='CANCELLED' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  )
) STRICT;
INSERT INTO staff_work_items_stage4_new (id, work_type, source_entity_type, source_entity_id, buyer_customer_id, seller_organization_id, store_id, duty_code, fixed_assignment_type, fixed_assignment_id, assigned_staff_id, status, version, created_at, updated_at, completed_at, cancelled_at, marketplace_code)
SELECT id, work_type, source_entity_type, source_entity_id, buyer_customer_id, seller_organization_id, store_id, duty_code, fixed_assignment_type, fixed_assignment_id, assigned_staff_id, status, version, created_at, updated_at, completed_at, cancelled_at, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END
FROM staff_work_items;
DROP TABLE staff_work_items;
ALTER TABLE staff_work_items_stage4_new RENAME TO staff_work_items;
CREATE INDEX idx_staff_work_items_assignee_status
ON staff_work_items (assigned_staff_id,status,created_at,id);
CREATE INDEX idx_staff_work_items_buyer_status
ON staff_work_items (buyer_customer_id,status,duty_code,id)
WHERE buyer_customer_id IS NOT NULL;
CREATE INDEX idx_staff_work_items_marketplace_status
ON staff_work_items(marketplace_code,status,work_type,created_at,id);
CREATE INDEX idx_staff_work_items_seller_status
ON staff_work_items (seller_organization_id,status,duty_code,id)
WHERE seller_organization_id IS NOT NULL;
CREATE INDEX idx_staff_work_items_status_created
ON staff_work_items (status, created_at, id);
CREATE UNIQUE INDEX uq_staff_work_item_open_source
ON staff_work_items (source_entity_type,source_entity_id,work_type)
WHERE status='OPEN';

-- ===== acquisition_channels =====
CREATE TABLE acquisition_channels_stage4_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  code TEXT NOT NULL UNIQUE CHECK (
    length(code) BETWEEN 2 AND 40
    AND code=upper(code)
    AND code NOT GLOB '*[^A-Z0-9_-]*'
  ),
  channel_type TEXT NOT NULL CHECK (channel_type IN (
    'XIAOHONGSHU','PRIVATE_WECHAT','REFERRAL','OTHER'
  )),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  version INTEGER NOT NULL CHECK (version>=1),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  disabled_at INTEGER, platform_name TEXT NOT NULL DEFAULT '其他'
  CHECK (length(platform_name) BETWEEN 1 AND 100), lead_type TEXT NOT NULL DEFAULT 'BUYER'
  CHECK (lead_type IN ('BUYER','SELLER','BOTH')), marketplace_code TEXT NOT NULL DEFAULT 'AMAZON_JP'
  CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR'
  )),
  CHECK (
    (status='ACTIVE' AND disabled_at IS NULL)
    OR (status='DISABLED' AND disabled_at IS NOT NULL)
  )
) STRICT;
INSERT INTO acquisition_channels_stage4_new (id, code, channel_type, display_name, status, version, created_by_staff_id, created_at, updated_at, disabled_at, platform_name, lead_type, marketplace_code)
SELECT id, code, channel_type, display_name, status, version, created_by_staff_id, created_at, updated_at, disabled_at, platform_name, lead_type, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END
FROM acquisition_channels;
DROP TABLE acquisition_channels;
ALTER TABLE acquisition_channels_stage4_new RENAME TO acquisition_channels;
CREATE INDEX idx_acquisition_channel_audience_market
ON acquisition_channels(lead_type,marketplace_code,status,display_name);

-- ===== acquisition_leads =====
CREATE TABLE acquisition_leads_stage4_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  lead_type TEXT NOT NULL CHECK (lead_type IN ('BUYER','SELLER')),
  identity_hash TEXT CHECK (
    identity_hash IS NULL OR (
      length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  identity_ciphertext TEXT,
  identity_iv TEXT,
  wechat_masked TEXT NOT NULL CHECK (length(wechat_masked) BETWEEN 1 AND 32),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name)<=100),
  note TEXT CHECK (note IS NULL OR length(note)<=1000),
  origin_channel_id TEXT NOT NULL REFERENCES acquisition_channels(id),
  origin_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  current_owner_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','INVALIDATED','ANONYMIZED')),
  invalidation_reason TEXT CHECK (
    invalidation_reason IS NULL OR length(invalidation_reason) BETWEEN 1 AND 1000
  ),
  retention_hold_reason TEXT CHECK (retention_hold_reason IN (
    'SECURITY','DISPUTE','LEGAL'
  )),
  version INTEGER NOT NULL CHECK (version>=1),
  created_business_date TEXT NOT NULL CHECK (
    created_business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(created_business_date)=created_business_date
  ),
  latest_followup_at INTEGER NOT NULL CHECK (latest_followup_at>=0),
  retention_due_at INTEGER NOT NULL CHECK (retention_due_at>latest_followup_at),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  invalidated_at INTEGER,
  anonymized_at INTEGER, marketplace_code TEXT NOT NULL
  DEFAULT 'AMAZON_JP' CHECK (marketplace_code IN (
    'AMAZON_JP','AMAZON_US','COUPANG_KR'
  )), prospect_id TEXT, origin_mode TEXT NOT NULL DEFAULT 'HUMAN'
  CHECK (origin_mode IN ('HUMAN','CODEX')), origin_source_url TEXT
  CHECK (origin_source_url IS NULL OR length(origin_source_url)<=2000),
  CHECK (
    (status='ACTIVE' AND identity_hash IS NOT NULL
      AND identity_ciphertext IS NOT NULL AND identity_iv IS NOT NULL
      AND invalidation_reason IS NULL AND invalidated_at IS NULL
      AND anonymized_at IS NULL)
    OR (status='INVALIDATED' AND identity_hash IS NOT NULL
      AND identity_ciphertext IS NOT NULL AND identity_iv IS NOT NULL
      AND invalidation_reason IS NOT NULL AND invalidated_at IS NOT NULL
      AND anonymized_at IS NULL)
    OR (status='ANONYMIZED' AND identity_hash IS NULL
      AND identity_ciphertext IS NULL AND identity_iv IS NULL
      AND invalidation_reason IS NULL AND invalidated_at IS NULL
      AND anonymized_at IS NOT NULL)
  )
) STRICT;
INSERT INTO acquisition_leads_stage4_new (id, lead_type, identity_hash, identity_ciphertext, identity_iv, wechat_masked, display_name, note, origin_channel_id, origin_staff_id, current_owner_staff_id, status, invalidation_reason, retention_hold_reason, version, created_business_date, latest_followup_at, retention_due_at, created_at, updated_at, invalidated_at, anonymized_at, marketplace_code, prospect_id, origin_mode, origin_source_url)
SELECT id, lead_type, identity_hash, identity_ciphertext, identity_iv, wechat_masked, display_name, note, origin_channel_id, origin_staff_id, current_owner_staff_id, status, invalidation_reason, retention_hold_reason, version, created_business_date, latest_followup_at, retention_due_at, created_at, updated_at, invalidated_at, anonymized_at, CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, prospect_id, origin_mode, origin_source_url
FROM acquisition_leads;
DROP TABLE acquisition_leads;
ALTER TABLE acquisition_leads_stage4_new RENAME TO acquisition_leads;
CREATE INDEX idx_acquisition_lead_identity_market
ON acquisition_leads(lead_type,marketplace_code,identity_hash,status,created_at,id);
CREATE INDEX idx_acquisition_lead_market_source
ON acquisition_leads(lead_type,marketplace_code,origin_channel_id,created_at,id);
CREATE INDEX idx_acquisition_leads_origin_date
ON acquisition_leads(origin_channel_id,lead_type,created_business_date,status);
CREATE INDEX idx_acquisition_leads_owner
ON acquisition_leads(current_owner_staff_id,lead_type,status,created_at,id);
CREATE INDEX idx_acquisition_leads_retention
ON acquisition_leads(status,retention_due_at,id);
CREATE INDEX idx_acquisition_leads_type_created
ON acquisition_leads (lead_type, created_at, id);
CREATE UNIQUE INDEX uq_acquisition_lead_active_identity_market
ON acquisition_leads(lead_type,marketplace_code,identity_hash)
WHERE status='ACTIVE';

-- ===== marketplace_runtime_config (dropped: legacy_order_code) =====
CREATE TABLE marketplace_runtime_config_stage4_new (
  marketplace_code TEXT PRIMARY KEY REFERENCES marketplace_registry(code),
  business_timezone TEXT NOT NULL CHECK (length(business_timezone) BETWEEN 3 AND 80),
  reporting_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai'
    CHECK (length(reporting_timezone) BETWEEN 3 AND 80),
  currency_code TEXT NOT NULL CHECK (length(currency_code)=3 AND currency_code=upper(currency_code)),
  currency_exponent INTEGER NOT NULL CHECK (currency_exponent BETWEEN 0 AND 4),
  seller_portal_status TEXT NOT NULL CHECK (seller_portal_status IN ('ACTIVE','PREPARED','DISABLED')),
  buyer_portal_status TEXT NOT NULL CHECK (buyer_portal_status IN ('ACTIVE','PREPARED','DISABLED')),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at)
) STRICT;
INSERT INTO marketplace_runtime_config_stage4_new (marketplace_code, business_timezone, reporting_timezone, currency_code, currency_exponent, seller_portal_status, buyer_portal_status, created_at, updated_at)
SELECT CASE marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE marketplace_code END, business_timezone, reporting_timezone, currency_code, currency_exponent, seller_portal_status, buyer_portal_status, created_at, updated_at
FROM marketplace_runtime_config;
DROP TABLE marketplace_runtime_config;
ALTER TABLE marketplace_runtime_config_stage4_new RENAME TO marketplace_runtime_config;

-- ===== retire the legacy alias layer =====
DROP TABLE marketplace_legacy_aliases;
DROP TABLE marketplaces;

-- ===== effective dates view without dead Rakuten/TikTok arms =====
CREATE VIEW formal_order_effective_dates AS
SELECT formal_order.id AS formal_order_id,
  formal_order.marketplace_code AS canonical_marketplace_code,
  formal_order.confirmed_business_date AS reporting_business_date,
  COALESCE(
    formal_order.marketplace_business_date,
    CASE formal_order.marketplace_code
      WHEN 'AMAZON_JP' THEN date(formal_order.confirmed_at/1000,'unixepoch','+9 hours')
      WHEN 'COUPANG_KR' THEN date(formal_order.confirmed_at/1000,'unixepoch','+9 hours')
      ELSE NULL
    END
  ) AS marketplace_business_date,
  runtime.business_timezone,
  runtime.reporting_timezone
FROM formal_orders formal_order
JOIN marketplace_runtime_config runtime
  ON runtime.marketplace_code=formal_order.marketplace_code;


UPDATE app_schema_state
SET
  schema_version=20,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
