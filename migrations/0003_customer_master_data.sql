-- Baseline 0003 customer_master_data (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=2 THEN 1 ELSE 0 END;

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

CREATE TABLE customer_login_accounts (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  identity_subject_id TEXT NOT NULL UNIQUE
    REFERENCES customer_identity_subjects(id),
  account_type TEXT NOT NULL
    CHECK (account_type IN ('BUYER', 'SELLER_MEMBER')),
  login_identifier_display TEXT NOT NULL
    CHECK (length(login_identifier_display) BETWEEN 3 AND 160),
  login_identifier_normalized TEXT NOT NULL UNIQUE
    CHECK (length(login_identifier_normalized) BETWEEN 3 AND 160),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  session_version INTEGER NOT NULL DEFAULT 1
    CHECK (session_version >= 1),
  password_change_required INTEGER NOT NULL DEFAULT 1
    CHECK (password_change_required IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  activated_at INTEGER,
  disabled_at INTEGER, registration_source TEXT
  CHECK (
    registration_source IS NULL
    OR registration_source IN (
      'STAFF_ACTIVATION',
      'SELF_REGISTRATION_NEW',
      'SELF_REGISTRATION_CLAIM',
      'RECOVERY_REBIND'
    )
  ),
  CHECK (
    (status='ACTIVE'
      AND activated_at IS NOT NULL
      AND disabled_at IS NULL)
    OR
    (status='DISABLED'
      AND disabled_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE buyer_marketplace_assignments (
  buyer_customer_id TEXT PRIMARY KEY REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE buyer_marketplace_correction_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  previous_marketplace_code TEXT NOT NULL,
  next_marketplace_code TEXT NOT NULL,
  previous_version INTEGER NOT NULL CHECK (previous_version >= 1),
  next_version INTEGER NOT NULL CHECK (next_version=previous_version+1),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (previous_marketplace_code<>next_marketplace_code)
) STRICT;

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

CREATE TABLE customer_access_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  account_id TEXT NOT NULL
    REFERENCES customer_login_accounts(id),
  identity_subject_id TEXT NOT NULL
    REFERENCES customer_identity_subjects(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'ACCOUNT_ACTIVATED',
      'PASSWORD_CHANGED',
      'SESSIONS_REVOKED',
      'ACCOUNT_DISABLED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('STAFF', 'CUSTOMER_ACCOUNT')),
  actor_id TEXT,
  previous_state_json TEXT,
  next_state_json TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE TABLE customer_account_personas (
  account_id TEXT NOT NULL REFERENCES customer_login_accounts(id),
  identity_subject_id TEXT NOT NULL REFERENCES customer_identity_subjects(id),
  persona_type TEXT NOT NULL CHECK (persona_type IN ('BUYER','SELLER_MEMBER')),
  buyer_customer_id TEXT REFERENCES buyer_customers(id),
  seller_member_id TEXT REFERENCES seller_organization_members(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (account_id, persona_type),
  UNIQUE (identity_subject_id, persona_type),
  UNIQUE (buyer_customer_id),
  UNIQUE (seller_member_id),
  CHECK (
    (persona_type='BUYER' AND buyer_customer_id IS NOT NULL
      AND seller_member_id IS NULL)
    OR
    (persona_type='SELLER_MEMBER' AND seller_member_id IS NOT NULL
      AND buyer_customer_id IS NULL)
  )
) STRICT;

CREATE TABLE "customer_auth_security_events" (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGIN_RATE_LIMITED',
    'SESSION_REJECTED','PASSWORD_CHANGED','PASSWORD_CHANGE_RATE_LIMITED','LOGOUT'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE','BLOCKED')),
  account_id TEXT REFERENCES customer_login_accounts(id),
  login_identifier_hash TEXT CHECK (
    login_identifier_hash IS NULL OR (
      length(login_identifier_hash)=64
      AND login_identifier_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  network_source_hash TEXT CHECK (
    network_source_hash IS NULL OR (
      length(network_source_hash)=64
      AND network_source_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE customer_buyer_invitations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  wechat_display TEXT NOT NULL CHECK (length(wechat_display) BETWEEN 3 AND 128),
  normalized_wechat TEXT NOT NULL CHECK (length(normalized_wechat) BETWEEN 3 AND 128),
  wechat_hash TEXT NOT NULL CHECK (
    length(wechat_hash)=64 AND wechat_hash NOT GLOB '*[^0-9a-f]*'
  ),
  marketplace_code TEXT NOT NULL,
  issued_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at=issued_at+604800000),
  consumed_at INTEGER,
  consumed_by_account_id TEXT REFERENCES customer_login_accounts(id),
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at=issued_at),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (status='ACTIVE' AND consumed_at IS NULL AND consumed_by_account_id IS NULL
      AND revoked_at IS NULL AND revoked_by_staff_id IS NULL)
    OR
    (status='CONSUMED' AND consumed_at IS NOT NULL
      AND consumed_by_account_id IS NOT NULL
      AND revoked_at IS NULL AND revoked_by_staff_id IS NULL)
    OR
    (status='REVOKED' AND consumed_at IS NULL AND consumed_by_account_id IS NULL
      AND revoked_at IS NOT NULL AND revoked_by_staff_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE customer_buyer_invitation_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  invitation_id TEXT NOT NULL REFERENCES customer_buyer_invitations(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('ISSUED','REVOKED','CONSUMED','REJECTED')
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE','BLOCKED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','CUSTOMER','SYSTEM')),
  actor_id TEXT,
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  idempotency_key TEXT,
  token_hash TEXT CHECK (
    token_hash IS NULL OR (
      length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE customer_buyer_invitation_lead_links (
  invitation_id TEXT PRIMARY KEY REFERENCES customer_buyer_invitations(id),
  acquisition_lead_id TEXT NOT NULL UNIQUE REFERENCES acquisition_leads(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

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
    CHECK (updated_at >= created_at), identity_subject_type TEXT
CHECK (
  identity_subject_type IS NULL
  OR identity_subject_type IN ('BUYER_CUSTOMER', 'SELLER_ORG_MEMBER')
),
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

CREATE TABLE customer_identity_manual_bindings (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  identity_hash TEXT NOT NULL CHECK (
    length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
  ),
  customer_type TEXT NOT NULL CHECK (customer_type IN ('BUYER','SELLER')),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  resolved_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  revoked_at INTEGER,
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE customer_identity_resolution_cases (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  identity_hash TEXT NOT NULL CHECK (
    length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
  ),
  identity_masked TEXT NOT NULL CHECK (length(identity_masked) BETWEEN 1 AND 80),
  customer_type TEXT NOT NULL CHECK (customer_type IN ('BUYER','SELLER')),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'AMBIGUOUS_HISTORY','IDENTITY_CONFLICT','LEGACY_MISSING_IDENTITY','STAFF_REPORTED'
  )),
  staff_note TEXT CHECK (staff_note IS NULL OR length(staff_note)<=1000),
  status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED','CANCELLED')),
  reported_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  resolved_subject_id TEXT,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note)<=1000),
  resolved_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  resolved_at INTEGER,
  CHECK (
    (status='OPEN' AND resolved_subject_id IS NULL AND resolved_by_staff_id IS NULL AND resolved_at IS NULL)
    OR (status='RESOLVED' AND resolved_subject_id IS NOT NULL AND resolved_by_staff_id IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status='CANCELLED' AND resolved_subject_id IS NULL AND resolved_by_staff_id IS NOT NULL AND resolved_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE customer_identity_resolution_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  case_id TEXT NOT NULL REFERENCES customer_identity_resolution_cases(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('REPORTED','RESOLVED','CANCELLED')),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  subject_id TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason)<=1000),
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

CREATE TABLE customer_login_identifier_change_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  account_id TEXT NOT NULL REFERENCES customer_login_accounts(id),
  identity_subject_id TEXT NOT NULL REFERENCES customer_identity_subjects(id),
  previous_wechat_normalized TEXT NOT NULL CHECK (length(previous_wechat_normalized) BETWEEN 1 AND 200),
  next_wechat_normalized TEXT NOT NULL CHECK (length(next_wechat_normalized) BETWEEN 1 AND 200),
  previous_wechat_display TEXT NOT NULL CHECK (length(previous_wechat_display) BETWEEN 1 AND 200),
  next_wechat_display TEXT NOT NULL CHECK (length(next_wechat_display) BETWEEN 1 AND 200),
  verification_note TEXT NOT NULL CHECK (length(verification_note) BETWEEN 8 AND 2000),
  actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  CHECK (previous_wechat_normalized<>next_wechat_normalized)
) STRICT;

CREATE TABLE customer_login_rate_limits (
  scope_type TEXT NOT NULL
    CHECK (scope_type IN (
      'LOGIN_IDENTIFIER',
      'NETWORK_SOURCE'
    )),
  scope_hash TEXT NOT NULL
    CHECK (
      length(scope_hash)=64
      AND scope_hash NOT GLOB '*[^0-9a-f]*'
    ),
  window_started_at INTEGER NOT NULL
    CHECK (window_started_at >= 0),
  window_expires_at INTEGER NOT NULL
    CHECK (window_expires_at > window_started_at),
  attempt_count INTEGER NOT NULL
    CHECK (attempt_count >= 1),
  blocked_until INTEGER,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  PRIMARY KEY (
    scope_type,
    scope_hash,
    window_started_at
  ),
  CHECK (
    blocked_until IS NULL
    OR blocked_until >= window_started_at
  )
) STRICT;

CREATE TABLE customer_password_credentials (
  account_id TEXT PRIMARY KEY
    REFERENCES customer_login_accounts(id),
  algorithm TEXT NOT NULL
    CHECK (algorithm='PBKDF2_SHA256'),
  iterations INTEGER NOT NULL
    CHECK (iterations BETWEEN 10000 AND 1000000),
  salt_base64url TEXT NOT NULL
    CHECK (
      length(salt_base64url) BETWEEN 20 AND 40
      AND salt_base64url NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  hash_base64url TEXT NOT NULL
    CHECK (
      length(hash_base64url) BETWEEN 40 AND 80
      AND hash_base64url NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  password_version INTEGER NOT NULL DEFAULT 1
    CHECK (password_version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE customer_password_reset_tokens (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  account_id TEXT NOT NULL REFERENCES customer_login_accounts(id),
  identity_subject_id TEXT NOT NULL REFERENCES customer_identity_subjects(id),
  wechat_hash TEXT NOT NULL CHECK (
    length(wechat_hash)=64 AND wechat_hash NOT GLOB '*[^0-9a-f]*'
  ),
  issued_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  verification_note TEXT NOT NULL CHECK (length(verification_note) BETWEEN 8 AND 1000),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at=issued_at+1800000),
  consumed_at INTEGER,
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at=issued_at),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (status='ACTIVE' AND consumed_at IS NULL AND revoked_at IS NULL
      AND revoked_by_staff_id IS NULL)
    OR
    (status='CONSUMED' AND consumed_at IS NOT NULL AND revoked_at IS NULL
      AND revoked_by_staff_id IS NULL)
    OR
    (status='REVOKED' AND consumed_at IS NULL AND revoked_at IS NOT NULL
      AND revoked_by_staff_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE customer_password_reset_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  reset_token_id TEXT NOT NULL REFERENCES customer_password_reset_tokens(id),
  account_id TEXT NOT NULL REFERENCES customer_login_accounts(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('ISSUED','REVOKED','CONSUMED','REJECTED','SESSIONS_REVOKED')
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','FAILURE','BLOCKED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','CUSTOMER','SYSTEM')),
  actor_id TEXT,
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  idempotency_key TEXT,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE "customer_security_rate_limits" (
  operation TEXT NOT NULL CHECK (
    operation IN ('INVITATION','PASSWORD_RESET','PASSWORD_CHANGE')
  ),
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('NETWORK_SOURCE','DEVICE','TOKEN','WECHAT_ID','ACCOUNT_ID')
  ),
  scope_hash TEXT NOT NULL CHECK (
    length(scope_hash)=64 AND scope_hash NOT GLOB '*[^0-9a-f]*'
  ),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
  window_expires_at INTEGER NOT NULL CHECK (window_expires_at > window_started_at),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
  blocked_until INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (operation, scope_type, scope_hash, window_started_at),
  CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
) STRICT;

CREATE TABLE customer_seller_invitations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
  normalized_wechat TEXT NOT NULL CHECK (length(normalized_wechat) BETWEEN 3 AND 128),
  wechat_display TEXT NOT NULL CHECK (length(wechat_display) BETWEEN 3 AND 128),
  marketplace_code TEXT NOT NULL REFERENCES marketplace_registry(code),
  acquisition_lead_id TEXT REFERENCES acquisition_leads(id),
  seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
  -- NEW_CUSTOMER and imported historical organizations may not have a member
  -- identity yet. The OWNER member is created only after the customer proves
  -- the invitation + WeChat/password boundary. This avoids granting a Seller
  -- persona to an existing Buyer account before customer confirmation.
  seller_member_id TEXT REFERENCES seller_organization_members(id),
  onboarding_kind TEXT NOT NULL CHECK (onboarding_kind IN ('NEW_CUSTOMER','HISTORICAL_ACCOUNT_ONLY')),
  issued_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED','EXPIRED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  issued_at INTEGER NOT NULL CHECK (issued_at>=0),
  expires_at INTEGER NOT NULL CHECK (expires_at>issued_at),
  consumed_at INTEGER,
  consumed_by_account_id TEXT REFERENCES customer_login_accounts(id),
  revoked_at INTEGER,
  revoked_by_staff_id TEXT REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  CHECK (
    (status='ACTIVE' AND consumed_at IS NULL AND consumed_by_account_id IS NULL AND revoked_at IS NULL)
    OR (status='CONSUMED' AND consumed_at IS NOT NULL AND consumed_by_account_id IS NOT NULL AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL AND consumed_at IS NULL)
    OR status='EXPIRED'
  )
) STRICT;

CREATE TABLE customer_seller_invitation_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 120),
  invitation_id TEXT NOT NULL REFERENCES customer_seller_invitations(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STAFF','CUSTOMER','SYSTEM')),
  actor_id TEXT,
  request_id TEXT,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL CHECK (created_at>=0)
) STRICT;

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

CREATE INDEX idx_buyer_customer_status_channel
ON buyer_customers (
  access_status,
  buyer_channel_id,
  created_at,
  id
);

CREATE INDEX idx_buyer_marketplace_correction_events
ON buyer_marketplace_correction_events (
  buyer_customer_id, created_at, id
);

CREATE INDEX idx_buyer_marketplace_scope
ON buyer_marketplace_assignments (marketplace_code, buyer_customer_id);

CREATE INDEX idx_customer_access_events_account
ON customer_access_events (
  account_id,
  created_at,
  id
);

CREATE INDEX idx_customer_account_personas_subject
ON customer_account_personas (identity_subject_id, persona_type, account_id);

CREATE INDEX idx_customer_auth_security_events_account
ON customer_auth_security_events (account_id,created_at,id);

CREATE INDEX idx_customer_auth_security_events_identifier
ON customer_auth_security_events (login_identifier_hash,created_at,id)
WHERE login_identifier_hash IS NOT NULL;

CREATE INDEX idx_customer_auth_security_events_network
ON customer_auth_security_events (network_source_hash,created_at,id)
WHERE network_source_hash IS NOT NULL;

CREATE INDEX idx_customer_buyer_invitation_events_invitation
ON customer_buyer_invitation_events (invitation_id, created_at, id);

CREATE INDEX idx_customer_buyer_invitations_expiry
ON customer_buyer_invitations (status, expires_at, id);

CREATE INDEX idx_customer_buyer_invitations_staff
ON customer_buyer_invitations (issued_by_staff_id, issued_at DESC, id);

CREATE INDEX idx_customer_buyer_invitations_wechat_marketplace
ON customer_buyer_invitations (wechat_hash, marketplace_code, status, expires_at);

CREATE INDEX idx_customer_identity_claim_events_claim
ON customer_identity_claim_events (
  claim_id,
  created_at,
  id
);

CREATE INDEX idx_customer_identity_manual_binding_subject
ON customer_identity_manual_bindings(customer_type,subject_id,marketplace_code,status);

CREATE INDEX idx_customer_identity_resolution_open
ON customer_identity_resolution_cases(status,marketplace_code,customer_type,created_at,id);

CREATE INDEX idx_customer_login_account_status
ON customer_login_accounts (
  status,
  account_type,
  id
);

CREATE INDEX idx_customer_login_identifier_change_account
ON customer_login_identifier_change_events(account_id,created_at DESC,id DESC);

CREATE INDEX idx_customer_login_rate_limits_blocked
ON customer_login_rate_limits (
  blocked_until,
  scope_type,
  scope_hash
)
WHERE blocked_until IS NOT NULL;

CREATE INDEX idx_customer_login_rate_limits_expiry
ON customer_login_rate_limits (
  window_expires_at,
  scope_type,
  scope_hash
);

CREATE INDEX idx_customer_password_reset_events_account
ON customer_password_reset_events (account_id, created_at, id);

CREATE INDEX idx_customer_password_reset_expiry
ON customer_password_reset_tokens (status, expires_at, id);

CREATE INDEX idx_customer_security_rate_limits_expiry
ON customer_security_rate_limits (window_expires_at, operation, scope_type);

CREATE INDEX idx_customer_seller_invitation_events
ON customer_seller_invitation_events(invitation_id,created_at,id);

CREATE INDEX idx_customer_seller_invitation_lead
ON customer_seller_invitations(acquisition_lead_id,status,id);

CREATE INDEX idx_customer_seller_invitation_wechat
ON customer_seller_invitations(normalized_wechat,status,expires_at,id);

CREATE INDEX idx_seller_channel_events_org
ON seller_organization_channel_events (
  organization_id,
  created_at,
  id
);

CREATE INDEX idx_seller_org_members_org_status
ON seller_organization_members (
  organization_id,
  status,
  member_number
);

CREATE INDEX idx_seller_org_status_channel
ON seller_organizations (
  status,
  current_channel_id,
  created_at,
  id
);

CREATE INDEX idx_wechat_claim_seller_normalized
ON wechat_identity_claims (
  normalized_wechat,
  identity_subject_type,
  status,
  identity_subject_id
);

CREATE INDEX idx_wechat_claim_subject_history
ON wechat_identity_claims (
  identity_subject_id,
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

CREATE UNIQUE INDEX uq_customer_identity_manual_binding_active
ON customer_identity_manual_bindings(identity_hash,customer_type,marketplace_code)
WHERE status='ACTIVE';

CREATE UNIQUE INDEX uq_customer_identity_resolution_one_open
ON customer_identity_resolution_cases(identity_hash,customer_type,marketplace_code)
WHERE status='OPEN';

CREATE UNIQUE INDEX uq_customer_password_reset_active_account
ON customer_password_reset_tokens (account_id) WHERE status='ACTIVE';

CREATE UNIQUE INDEX uq_customer_seller_invitation_active_org
ON customer_seller_invitations(seller_organization_id)
WHERE status='ACTIVE';

CREATE UNIQUE INDEX uq_seller_member_id_org
ON seller_organization_members (
  id,
  organization_id
);

CREATE UNIQUE INDEX uq_seller_org_primary_owner
ON seller_organization_members (
  organization_id
)
WHERE primary_owner=1;

CREATE UNIQUE INDEX uq_wechat_claim_buyer_active_or_reserved
ON wechat_identity_claims (normalized_wechat)
WHERE status IN ('ACTIVE', 'RESERVED')
  AND identity_subject_type='BUYER_CUSTOMER';

CREATE UNIQUE INDEX uq_wechat_claim_subject_active
ON wechat_identity_claims (
  identity_subject_id
)
WHERE status='ACTIVE';

CREATE TRIGGER trg_buyer_customer_marketplace_default
AFTER INSERT ON buyer_customers
BEGIN
  INSERT INTO buyer_marketplace_assignments (
    buyer_customer_id, marketplace_code, version, created_at, updated_at
  ) VALUES (NEW.id, 'AMAZON_JP', 1, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER trg_buyer_marketplace_correction_events_no_delete
BEFORE DELETE ON buyer_marketplace_correction_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_marketplace_correction_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_marketplace_correction_events_no_update
BEFORE UPDATE ON buyer_marketplace_correction_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_marketplace_correction_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_number_events_no_delete
BEFORE DELETE ON buyer_number_allocation_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_number_events_are_immutable');
END;

CREATE TRIGGER trg_buyer_number_events_no_update
BEFORE UPDATE ON buyer_number_allocation_events
BEGIN
  SELECT RAISE(ABORT, 'buyer_number_events_are_immutable');
END;

CREATE TRIGGER trg_customer_access_events_no_delete
BEFORE DELETE ON customer_access_events
BEGIN
  SELECT RAISE(ABORT, 'customer_access_events_are_immutable');
END;

CREATE TRIGGER trg_customer_access_events_no_update
BEFORE UPDATE ON customer_access_events
BEGIN
  SELECT RAISE(ABORT, 'customer_access_events_are_immutable');
END;

CREATE TRIGGER trg_customer_account_identity_rebind_guard
BEFORE UPDATE OF identity_subject_id ON customer_login_accounts
WHEN OLD.identity_subject_id<>NEW.identity_subject_id AND NOT (
  (SELECT COUNT(*) FROM customer_account_personas
    WHERE account_id=OLD.id)=1
  AND EXISTS (
    SELECT 1 FROM customer_account_personas
    WHERE account_id=OLD.id AND persona_type='BUYER'
  )
  AND EXISTS (
    SELECT 1 FROM buyer_customers
    WHERE identity_subject_id=NEW.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_rebind_requires_owner_conflict_workflow');
END;

CREATE TRIGGER trg_customer_account_identity_rebind_persona_sync
AFTER UPDATE OF identity_subject_id ON customer_login_accounts
WHEN OLD.identity_subject_id<>NEW.identity_subject_id
BEGIN
  UPDATE customer_account_personas
  SET identity_subject_id=NEW.identity_subject_id,
    buyer_customer_id=(
      SELECT id FROM buyer_customers
      WHERE identity_subject_id=NEW.identity_subject_id
    )
  WHERE account_id=NEW.id AND persona_type='BUYER';
END;

CREATE TRIGGER trg_customer_account_persona_after_account_buyer
AFTER INSERT ON customer_login_accounts
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT NEW.id, NEW.identity_subject_id, 'BUYER', buyer.id, NULL, NEW.created_at
  FROM buyer_customers buyer
  WHERE buyer.identity_subject_id=NEW.identity_subject_id;
END;

CREATE TRIGGER trg_customer_account_persona_after_account_seller
AFTER INSERT ON customer_login_accounts
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT NEW.id, NEW.identity_subject_id, 'SELLER_MEMBER', NULL, member.id,
    NEW.created_at
  FROM seller_organization_members member
  WHERE member.identity_subject_id=NEW.identity_subject_id;
END;

CREATE TRIGGER trg_customer_account_persona_after_buyer
AFTER INSERT ON buyer_customers
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT account.id, NEW.identity_subject_id, 'BUYER', NEW.id, NULL, NEW.created_at
  FROM customer_login_accounts account
  WHERE account.identity_subject_id=NEW.identity_subject_id;
END;

CREATE TRIGGER trg_customer_account_persona_after_seller_member
AFTER INSERT ON seller_organization_members
BEGIN
  INSERT OR IGNORE INTO customer_account_personas (
    account_id, identity_subject_id, persona_type,
    buyer_customer_id, seller_member_id, created_at
  )
  SELECT account.id, NEW.identity_subject_id, 'SELLER_MEMBER', NULL, NEW.id,
    NEW.created_at
  FROM customer_login_accounts account
  WHERE account.identity_subject_id=NEW.identity_subject_id;
END;

CREATE TRIGGER trg_customer_account_persona_source_guard
BEFORE INSERT ON customer_account_personas
WHEN NOT EXISTS (
  SELECT 1 FROM customer_login_accounts account
  WHERE account.id=NEW.account_id
    AND account.identity_subject_id=NEW.identity_subject_id
)
OR (
  NEW.persona_type='BUYER' AND NOT EXISTS (
    SELECT 1 FROM buyer_customers buyer
    WHERE buyer.id=NEW.buyer_customer_id
      AND buyer.identity_subject_id=NEW.identity_subject_id
  )
)
OR (
  NEW.persona_type='SELLER_MEMBER' AND NOT EXISTS (
    SELECT 1 FROM seller_organization_members member
    WHERE member.id=NEW.seller_member_id
      AND member.identity_subject_id=NEW.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_persona_source_mismatch');
END;

CREATE TRIGGER trg_customer_account_personas_no_delete
BEFORE DELETE ON customer_account_personas
BEGIN
  SELECT RAISE(ABORT, 'customer_account_personas_are_immutable');
END;

CREATE TRIGGER trg_customer_account_personas_no_update
BEFORE UPDATE ON customer_account_personas
WHEN NOT (
  OLD.persona_type='BUYER'
  AND NEW.account_id=OLD.account_id
  AND NEW.persona_type=OLD.persona_type
  AND NEW.seller_member_id IS NULL
  AND NEW.created_at=OLD.created_at
  AND EXISTS (
    SELECT 1 FROM customer_login_accounts account
    JOIN buyer_customers buyer
      ON buyer.identity_subject_id=account.identity_subject_id
    WHERE account.id=NEW.account_id
      AND buyer.id=NEW.buyer_customer_id
      AND NEW.identity_subject_id=account.identity_subject_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'customer_account_personas_are_immutable');
END;

CREATE TRIGGER trg_customer_auth_security_events_no_delete
BEFORE DELETE ON customer_auth_security_events
BEGIN
  SELECT RAISE(ABORT,'customer_auth_security_events_are_immutable');
END;

CREATE TRIGGER trg_customer_auth_security_events_no_update
BEFORE UPDATE ON customer_auth_security_events
BEGIN
  SELECT RAISE(ABORT,'customer_auth_security_events_are_immutable');
END;

CREATE TRIGGER trg_customer_buyer_invitation_events_no_delete
BEFORE DELETE ON customer_buyer_invitation_events
BEGIN
  SELECT RAISE(ABORT, 'customer_buyer_invitation_events_are_immutable');
END;

CREATE TRIGGER trg_customer_buyer_invitation_events_no_update
BEFORE UPDATE ON customer_buyer_invitation_events
BEGIN
  SELECT RAISE(ABORT, 'customer_buyer_invitation_events_are_immutable');
END;

CREATE TRIGGER trg_customer_buyer_invitation_transition_guard
BEFORE UPDATE ON customer_buyer_invitations
WHEN NEW.id<>OLD.id OR NEW.token_hash<>OLD.token_hash
  OR NEW.wechat_display<>OLD.wechat_display
  OR NEW.normalized_wechat<>OLD.normalized_wechat
  OR NEW.wechat_hash<>OLD.wechat_hash
  OR NEW.marketplace_code<>OLD.marketplace_code
  OR NEW.issued_by_staff_id<>OLD.issued_by_staff_id
  OR NEW.issued_at<>OLD.issued_at OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
  OR OLD.status<>'ACTIVE' OR NEW.status NOT IN ('CONSUMED','REVOKED')
BEGIN
  SELECT RAISE(ABORT, 'customer_buyer_invitation_invalid_transition');
END;

CREATE TRIGGER trg_customer_buyer_invitations_no_delete
BEFORE DELETE ON customer_buyer_invitations
BEGIN
  SELECT RAISE(ABORT, 'customer_buyer_invitations_are_immutable');
END;

CREATE TRIGGER trg_customer_identity_claim_events_no_delete
BEFORE DELETE ON customer_identity_claim_events
BEGIN
  SELECT RAISE(ABORT, 'customer_identity_claim_events_are_immutable');
END;

CREATE TRIGGER trg_customer_identity_claim_events_no_update
BEFORE UPDATE ON customer_identity_claim_events
BEGIN
  SELECT RAISE(ABORT, 'customer_identity_claim_events_are_immutable');
END;

CREATE TRIGGER trg_customer_identity_resolution_events_no_delete
BEFORE DELETE ON customer_identity_resolution_events
BEGIN SELECT RAISE(ABORT,'customer_identity_resolution_events_are_immutable'); END;

CREATE TRIGGER trg_customer_identity_resolution_events_no_update
BEFORE UPDATE ON customer_identity_resolution_events
BEGIN SELECT RAISE(ABORT,'customer_identity_resolution_events_are_immutable'); END;

CREATE TRIGGER trg_customer_login_identifier_change_events_no_delete
BEFORE DELETE ON customer_login_identifier_change_events
BEGIN SELECT RAISE(ABORT,'customer_login_identifier_change_events_are_immutable'); END;

CREATE TRIGGER trg_customer_login_identifier_change_events_no_update
BEFORE UPDATE ON customer_login_identifier_change_events
BEGIN SELECT RAISE(ABORT,'customer_login_identifier_change_events_are_immutable'); END;

CREATE TRIGGER trg_customer_password_reset_events_no_delete
BEFORE DELETE ON customer_password_reset_events
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_events_are_immutable');
END;

CREATE TRIGGER trg_customer_password_reset_events_no_update
BEFORE UPDATE ON customer_password_reset_events
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_events_are_immutable');
END;

CREATE TRIGGER trg_customer_password_reset_source_guard
BEFORE INSERT ON customer_password_reset_tokens
WHEN NOT EXISTS (
  SELECT 1 FROM customer_login_accounts account
  WHERE account.id=NEW.account_id
    AND account.identity_subject_id=NEW.identity_subject_id
)
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_source_mismatch');
END;

CREATE TRIGGER trg_customer_password_reset_tokens_no_delete
BEFORE DELETE ON customer_password_reset_tokens
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_tokens_are_immutable');
END;

CREATE TRIGGER trg_customer_password_reset_transition_guard
BEFORE UPDATE ON customer_password_reset_tokens
WHEN NEW.id<>OLD.id OR NEW.token_hash<>OLD.token_hash
  OR NEW.account_id<>OLD.account_id
  OR NEW.identity_subject_id<>OLD.identity_subject_id
  OR NEW.wechat_hash<>OLD.wechat_hash
  OR NEW.issued_by_staff_id<>OLD.issued_by_staff_id
  OR NEW.verification_note<>OLD.verification_note
  OR NEW.issued_at<>OLD.issued_at OR NEW.expires_at<>OLD.expires_at
  OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
  OR OLD.status<>'ACTIVE' OR NEW.status NOT IN ('CONSUMED','REVOKED')
BEGIN
  SELECT RAISE(ABORT, 'customer_password_reset_invalid_transition');
END;

CREATE TRIGGER trg_customer_persona_privilege_session_bump
AFTER INSERT ON customer_account_personas
WHEN EXISTS(
  SELECT 1 FROM customer_account_personas existing
  WHERE existing.account_id=NEW.account_id
    AND existing.persona_type<>NEW.persona_type
)
BEGIN
  UPDATE customer_login_accounts
  SET session_version=session_version+1,
      version=version+1,
      updated_at=MAX(updated_at,NEW.created_at)
  WHERE id=NEW.account_id AND identity_subject_id=NEW.identity_subject_id
    AND status='ACTIVE';
  INSERT INTO transaction_assertions(assertion_value) VALUES(changes());
END;

CREATE TRIGGER trg_seller_channel_events_no_delete
BEFORE DELETE ON seller_organization_channel_events
BEGIN
  SELECT RAISE(ABORT, 'seller_channel_events_are_immutable');
END;

CREATE TRIGGER trg_seller_channel_events_no_update
BEFORE UPDATE ON seller_organization_channel_events
BEGIN
  SELECT RAISE(ABORT, 'seller_channel_events_are_immutable');
END;

INSERT INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version, created_at, updated_at, disabled_at
) VALUES (
  'seller-channel-ido-mango', 'ido-mango', 'ido-mango', 'ido-mango', 'ACTIVE', 1, 1, 1787661494000, 1787661494000, NULL
);

INSERT INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version, created_at, updated_at, disabled_at
) VALUES (
  'seller-channel-ygbceping', 'ygbceping', 'ygbceping', 'ygbceping', 'ACTIVE', 1, 1, 1787661494000, 1787661494000, NULL
);

INSERT INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version, created_at, updated_at, disabled_at
) VALUES (
  'seller-channel-yueguangbaiai', 'yueguangbaiai', 'yueguangbaiai', 'yueguangbaiai', 'ACTIVE', 1, 1, 1787661494000, 1787661494000, NULL
);

INSERT INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version, created_at, updated_at, disabled_at
) VALUES (
  'seller-channel-yinghua1942', 'yinghua1942', 'yinghua1942', 'yinghua1942', 'ACTIVE', 1, 1, 1787661495000, 1787661495000, NULL
);

INSERT INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version, created_at, updated_at, disabled_at
) VALUES (
  'seller-channel-queshengai', 'queshengai', 'queshengai', 'queshengai', 'ACTIVE', 1, 1, 1787661495000, 1787661495000, NULL
);

INSERT INTO seller_channels (
  id, code, prefix, name, status, next_sequence, version, created_at, updated_at, disabled_at
) VALUES (
  'seller-channel-portal-onboarding', 'portal-onboarding', 'portal', '新系统卖家账号开通', 'ACTIVE', 1, 1, 1787661495000, 1787661495000, NULL
);

UPDATE app_schema_state
SET
  schema_version=3,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
