PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Formal migration 0019: only advances schema_version from 18 to 19.
-- Cloudflare D1 runs migrations in an implicit transaction and keeps foreign
-- keys enabled. The dependency tables are therefore copied, dropped leaf-first,
-- and recreated parent-first instead of relying on foreign_keys=OFF.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=18
) THEN 1 ELSE 0 END;

-- Historical rows remain readable with NULL ordering-profile fields. New rows
-- are required to provide a JavaScript-safe JPY integer and a frozen mode.
ALTER TABLE product_versions
ADD COLUMN ordering_guide_expected_amount_jpy INTEGER
  CHECK (
    ordering_guide_expected_amount_jpy IS NULL
    OR ordering_guide_expected_amount_jpy
      BETWEEN 0 AND 9007199254740991
  );

ALTER TABLE product_versions
ADD COLUMN color_spec_mode TEXT
  CHECK (
    color_spec_mode IS NULL
    OR color_spec_mode IN ('MAIN_IMAGE_VARIANT', 'ANY_VARIANT')
  );

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

-- Preserve every table that directly depends on the file purpose/entity CHECK
-- constraints. Backup tables intentionally have no foreign keys or triggers.
CREATE TABLE phase3e2_backup_file_upload_intents AS
SELECT * FROM file_upload_intents;
CREATE TABLE phase3e2_backup_file_objects AS
SELECT * FROM file_objects;
CREATE TABLE phase3e2_backup_file_entity_links AS
SELECT * FROM file_entity_links;
CREATE TABLE phase3e2_backup_file_read_intents AS
SELECT * FROM file_read_intents;
CREATE TABLE phase3e2_backup_file_events AS
SELECT * FROM file_events;
CREATE TABLE phase3e2_backup_file_entity_audience_grants AS
SELECT * FROM file_entity_audience_grants;
CREATE TABLE phase3e2_backup_file_audience_events AS
SELECT * FROM file_audience_events;
CREATE TABLE phase3e2_backup_order_evidence_version_files AS
SELECT * FROM order_evidence_version_files;
CREATE TABLE phase3e2_backup_review_evidence_version_files AS
SELECT * FROM review_evidence_version_files;
CREATE TABLE phase3e2_backup_buyer_refund_payment_entry_files AS
SELECT * FROM buyer_refund_payment_entry_files;

-- Drop the dependency graph leaf-first. D1 keeps foreign keys enabled, so no
-- parent table is dropped while a live child table still references it.
DROP TABLE order_evidence_version_files;
DROP TABLE review_evidence_version_files;
DROP TABLE buyer_refund_payment_entry_files;
DROP TABLE file_audience_events;
DROP TABLE file_read_intents;
DROP TABLE file_entity_audience_grants;
DROP TABLE file_events;
DROP TABLE file_entity_links;
DROP TABLE file_objects;
DROP TABLE file_upload_intents;

CREATE TABLE file_upload_intents (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  owner_actor_type TEXT NOT NULL CHECK (owner_actor_type IN (
    'STAFF', 'BUYER_CUSTOMER', 'SELLER_MEMBER', 'SYSTEM'
  )),
  owner_actor_id TEXT NOT NULL CHECK (length(owner_actor_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE', 'PRODUCT_IMAGE', 'ORDER_EVIDENCE',
    'REVIEW_EVIDENCE', 'BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF', 'SUPPORT_ATTACHMENT'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY', 'BUYER_VISIBLE', 'SELLER_VISIBLE'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'ISSUED', 'VERIFYING', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELLED'
  )),
  requested_file_count INTEGER NOT NULL
    CHECK (requested_file_count BETWEEN 1 AND 10),
  manifest_hash TEXT NOT NULL CHECK (
    length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  failure_code TEXT CHECK (
    failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (
    (status IN ('ISSUED', 'VERIFYING')
      AND completed_at IS NULL AND failure_code IS NULL)
    OR (status='VERIFIED'
      AND completed_at IS NOT NULL AND failure_code IS NULL)
    OR (status IN ('FAILED', 'EXPIRED', 'CANCELLED')
      AND completed_at IS NOT NULL)
  )
) STRICT;

INSERT INTO file_upload_intents (
  id, owner_actor_type, owner_actor_id, purpose, visibility, status,
  requested_file_count, manifest_hash, version, expires_at, failure_code,
  created_at, updated_at, completed_at
)
SELECT
  id, owner_actor_type, owner_actor_id, purpose, visibility, status,
  requested_file_count, manifest_hash, version, expires_at, failure_code,
  created_at, updated_at, completed_at
FROM phase3e2_backup_file_upload_intents;

CREATE INDEX idx_file_upload_intents_owner_status
ON file_upload_intents (
  owner_actor_type, owner_actor_id, status, created_at, id
);
CREATE INDEX idx_file_upload_intents_expiry
ON file_upload_intents (status, expires_at, id);

CREATE TABLE file_objects (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  upload_intent_id TEXT NOT NULL REFERENCES file_upload_intents(id),
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 1 AND 10),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE', 'PRODUCT_IMAGE', 'ORDER_EVIDENCE',
    'REVIEW_EVIDENCE', 'BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF', 'SUPPORT_ATTACHMENT'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY', 'BUYER_VISIBLE', 'SELLER_VISIBLE'
  )),
  object_key TEXT NOT NULL UNIQUE CHECK (
    length(object_key) BETWEEN 40 AND 300
    AND object_key GLOB 'files/v1/*'
    AND object_key NOT GLOB '*[^a-z0-9/_-]*'
  ),
  client_file_name TEXT NOT NULL CHECK (length(client_file_name) BETWEEN 3 AND 180),
  extension TEXT NOT NULL CHECK (extension IN ('jpg', 'jpeg', 'png', 'webp', 'pdf')),
  declared_mime TEXT NOT NULL CHECK (declared_mime IN (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  )),
  expected_byte_size INTEGER NOT NULL CHECK (expected_byte_size BETWEEN 1 AND 26214400),
  status TEXT NOT NULL CHECK (status IN (
    'RESERVED', 'UPLOADED', 'VERIFIED', 'REJECTED',
    'DELETION_PENDING', 'DELETED'
  )),
  upload_token_hash TEXT NOT NULL CHECK (
    length(upload_token_hash)=64
    AND upload_token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  upload_expires_at INTEGER NOT NULL CHECK (upload_expires_at >= 0),
  uploaded_byte_size INTEGER CHECK (
    uploaded_byte_size IS NULL OR uploaded_byte_size >= 1
  ),
  detected_mime TEXT CHECK (detected_mime IS NULL OR detected_mime IN (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  )),
  uploaded_sha256 TEXT CHECK (
    uploaded_sha256 IS NULL OR (
      length(uploaded_sha256)=64
      AND uploaded_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  failure_code TEXT CHECK (
    failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100
  ),
  delete_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (delete_attempt_count >= 0),
  next_delete_at INTEGER CHECK (next_delete_at IS NULL OR next_delete_at >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  uploaded_at INTEGER,
  verified_at INTEGER,
  deleted_at INTEGER,
  UNIQUE (upload_intent_id, slot_no),
  CHECK (upload_expires_at >= created_at),
  CHECK (
    (status='RESERVED'
      AND uploaded_byte_size IS NULL
      AND detected_mime IS NULL
      AND uploaded_sha256 IS NULL
      AND uploaded_at IS NULL
      AND verified_at IS NULL
      AND deleted_at IS NULL)
    OR (status='REJECTED'
      AND verified_at IS NULL
      AND deleted_at IS NULL
      AND failure_code IS NOT NULL)
    OR (status IN ('UPLOADED', 'VERIFIED', 'DELETION_PENDING', 'DELETED')
      AND uploaded_byte_size IS NOT NULL
      AND detected_mime IS NOT NULL
      AND uploaded_sha256 IS NOT NULL
      AND uploaded_at IS NOT NULL)
  ),
  CHECK (
    (status='VERIFIED' AND verified_at IS NOT NULL AND deleted_at IS NULL)
    OR (status<>'VERIFIED' AND verified_at IS NULL)
  ),
  CHECK (
    (status='DELETION_PENDING'
      AND failure_code IS NOT NULL
      AND next_delete_at IS NOT NULL
      AND deleted_at IS NULL)
    OR (status='DELETED'
      AND failure_code IS NOT NULL
      AND next_delete_at IS NULL
      AND deleted_at IS NOT NULL)
    OR (status NOT IN ('DELETION_PENDING', 'DELETED'))
  ),
  CHECK (
    (declared_mime='image/jpeg' AND extension IN ('jpg', 'jpeg'))
    OR (declared_mime='image/png' AND extension='png')
    OR (declared_mime='image/webp' AND extension='webp')
    OR (declared_mime='application/pdf' AND extension='pdf')
  )
) STRICT;

INSERT INTO file_objects (
  id, upload_intent_id, slot_no, purpose, visibility, object_key,
  client_file_name, extension, declared_mime, expected_byte_size,
  status, upload_token_hash, upload_expires_at, uploaded_byte_size,
  detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
  next_delete_at, version, created_at, updated_at, uploaded_at,
  verified_at, deleted_at
)
SELECT
  id, upload_intent_id, slot_no, purpose, visibility, object_key,
  client_file_name, extension, declared_mime, expected_byte_size,
  status, upload_token_hash, upload_expires_at, uploaded_byte_size,
  detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
  next_delete_at, version, created_at, updated_at, uploaded_at,
  verified_at, deleted_at
FROM phase3e2_backup_file_objects;

CREATE INDEX idx_file_objects_intent_status
ON file_objects (upload_intent_id, status, slot_no, id);
CREATE INDEX idx_file_objects_cleanup
ON file_objects (status, next_delete_at, delete_attempt_count, id);

CREATE TABLE file_entity_links (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'PRODUCT_APPLICATION', 'PRODUCT_VERSION', 'ORDER', 'REVIEW',
    'BUYER_REFUND', 'SELLER_SETTLEMENT', 'SUPPORT_CASE'
  )),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE', 'PRODUCT_IMAGE', 'ORDER_EVIDENCE',
    'REVIEW_EVIDENCE', 'BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF', 'SUPPORT_ATTACHMENT'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY', 'BUYER_VISIBLE', 'SELLER_VISIBLE'
  )),
  linked_by_actor_type TEXT NOT NULL CHECK (linked_by_actor_type IN (
    'STAFF', 'BUYER_CUSTOMER', 'SELLER_MEMBER', 'SYSTEM'
  )),
  linked_by_actor_id TEXT NOT NULL
    CHECK (length(linked_by_actor_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  authorization_mode TEXT NOT NULL DEFAULT 'LEGACY_VISIBILITY'
    CHECK (authorization_mode IN ('LEGACY_VISIBILITY', 'EXPLICIT_AUDIENCES')),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= created_at),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (file_object_id, entity_type, entity_id),
  CHECK (
    (purpose='PRODUCT_APPLICATION_IMAGE' AND entity_type='PRODUCT_APPLICATION')
    OR (purpose='PRODUCT_IMAGE' AND entity_type='PRODUCT_VERSION')
    OR (purpose='ORDER_EVIDENCE' AND entity_type='ORDER')
    OR (purpose='REVIEW_EVIDENCE' AND entity_type='REVIEW')
    OR (purpose='BUYER_REFUND_PROOF' AND entity_type='BUYER_REFUND')
    OR (purpose='SELLER_SETTLEMENT_PROOF' AND entity_type='SELLER_SETTLEMENT')
    OR (purpose='SUPPORT_ATTACHMENT' AND entity_type='SUPPORT_CASE')
  )
) STRICT;

INSERT INTO file_entity_links (
  id, file_object_id, entity_type, entity_id, purpose, visibility,
  linked_by_actor_type, linked_by_actor_id, created_at,
  authorization_mode, expires_at, revoked_at
)
SELECT
  id, file_object_id, entity_type, entity_id, purpose, visibility,
  linked_by_actor_type, linked_by_actor_id, created_at,
  authorization_mode, expires_at, revoked_at
FROM phase3e2_backup_file_entity_links;

CREATE INDEX idx_file_entity_links_entity
ON file_entity_links (entity_type, entity_id, purpose, created_at, id);
CREATE INDEX idx_file_entity_links_authorization
ON file_entity_links (
  authorization_mode, file_object_id, revoked_at, expires_at, created_at, id
);
CREATE UNIQUE INDEX uq_product_image_file_object
ON file_entity_links (file_object_id)
WHERE purpose='PRODUCT_IMAGE';

CREATE TABLE file_entity_audience_grants (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  file_entity_link_id TEXT NOT NULL REFERENCES file_entity_links(id),
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'BUYER', 'SELLER_ORGANIZATION', 'STAFF_INTERNAL'
  )),
  buyer_customer_id TEXT REFERENCES buyer_customers(id),
  seller_organization_id TEXT REFERENCES seller_organizations(id),
  staff_permission_code TEXT CHECK (
    staff_permission_code IS NULL
    OR length(staff_permission_code) BETWEEN 1 AND 100
  ),
  staff_scope_type TEXT CHECK (
    staff_scope_type IS NULL OR staff_scope_type IN ('GLOBAL', 'TEAM')
  ),
  staff_team_id TEXT REFERENCES staff_teams(id),
  granted_by_actor_type TEXT NOT NULL CHECK (granted_by_actor_type IN (
    'STAFF', 'BUYER_CUSTOMER', 'SELLER_MEMBER', 'SYSTEM'
  )),
  granted_by_actor_id TEXT NOT NULL
    CHECK (length(granted_by_actor_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at > created_at),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (
    (subject_type='BUYER'
      AND buyer_customer_id IS NOT NULL
      AND seller_organization_id IS NULL
      AND staff_permission_code IS NULL
      AND staff_scope_type IS NULL
      AND staff_team_id IS NULL)
    OR (subject_type='SELLER_ORGANIZATION'
      AND buyer_customer_id IS NULL
      AND seller_organization_id IS NOT NULL
      AND staff_permission_code IS NULL
      AND staff_scope_type IS NULL
      AND staff_team_id IS NULL)
    OR (subject_type='STAFF_INTERNAL'
      AND buyer_customer_id IS NULL
      AND seller_organization_id IS NULL
      AND staff_permission_code IS NOT NULL
      AND staff_scope_type IS NOT NULL
      AND (
        (staff_scope_type='GLOBAL' AND staff_team_id IS NULL)
        OR (staff_scope_type='TEAM' AND staff_team_id IS NOT NULL)
      ))
  )
) STRICT;

INSERT INTO file_entity_audience_grants (
  id, file_entity_link_id, subject_type, buyer_customer_id,
  seller_organization_id, staff_permission_code, staff_scope_type,
  staff_team_id, granted_by_actor_type, granted_by_actor_id,
  created_at, expires_at, revoked_at
)
SELECT
  id, file_entity_link_id, subject_type, buyer_customer_id,
  seller_organization_id, staff_permission_code, staff_scope_type,
  staff_team_id, granted_by_actor_type, granted_by_actor_id,
  created_at, expires_at, revoked_at
FROM phase3e2_backup_file_entity_audience_grants;

CREATE UNIQUE INDEX uq_file_audience_grant_subject
ON file_entity_audience_grants (
  file_entity_link_id, subject_type,
  ifnull(buyer_customer_id, ''), ifnull(seller_organization_id, '')
);
CREATE INDEX idx_file_audience_grants_buyer
ON file_entity_audience_grants (
  buyer_customer_id, file_entity_link_id, revoked_at, expires_at, id
) WHERE subject_type='BUYER';
CREATE INDEX idx_file_audience_grants_seller
ON file_entity_audience_grants (
  seller_organization_id, file_entity_link_id, revoked_at, expires_at, id
) WHERE subject_type='SELLER_ORGANIZATION';
CREATE INDEX idx_file_audience_grants_staff
ON file_entity_audience_grants (
  file_entity_link_id, staff_permission_code, staff_scope_type,
  staff_team_id, revoked_at, expires_at, id
) WHERE subject_type='STAFF_INTERNAL';

CREATE TABLE file_read_intents (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'STAFF', 'BUYER_CUSTOMER', 'SELLER_MEMBER', 'SYSTEM'
  )),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'ISSUED', 'CONSUMED', 'EXPIRED', 'REVOKED'
  )),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count IN (0, 1)),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  consumed_at INTEGER,
  revoked_at INTEGER,
  file_entity_link_id TEXT REFERENCES file_entity_links(id),
  CHECK (expires_at > created_at),
  CHECK (
    (status='ISSUED' AND use_count=0
      AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status='CONSUMED' AND use_count=1
      AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR (status='EXPIRED' AND use_count=0
      AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status='REVOKED' AND use_count=0
      AND consumed_at IS NULL AND revoked_at IS NOT NULL)
  )
) STRICT;

INSERT INTO file_read_intents (
  id, file_object_id, actor_type, actor_id, token_hash, status,
  use_count, expires_at, created_at, updated_at, consumed_at,
  revoked_at, file_entity_link_id
)
SELECT
  id, file_object_id, actor_type, actor_id, token_hash, status,
  use_count, expires_at, created_at, updated_at, consumed_at,
  revoked_at, file_entity_link_id
FROM phase3e2_backup_file_read_intents;

CREATE INDEX idx_file_read_intents_actor_status
ON file_read_intents (actor_type, actor_id, status, expires_at, id);
CREATE INDEX idx_file_read_intents_file_status
ON file_read_intents (file_object_id, status, created_at, id);

CREATE TABLE file_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  upload_intent_id TEXT REFERENCES file_upload_intents(id),
  file_object_id TEXT REFERENCES file_objects(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'UPLOAD_INTENT_ISSUED', 'FILE_OBJECT_UPLOADED',
    'FILE_UPLOAD_VERIFIED', 'FILE_UPLOAD_FAILED', 'FILE_OBJECT_LINKED',
    'FILE_READ_INTENT_ISSUED', 'FILE_READ_INTENT_CONSUMED',
    'FILE_COMPENSATION_SCHEDULED', 'FILE_OBJECT_DELETED'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'STAFF', 'BUYER_CUSTOMER', 'SELLER_MEMBER', 'SYSTEM'
  )),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT,
  next_status TEXT NOT NULL CHECK (length(next_status) BETWEEN 1 AND 40),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (upload_intent_id IS NOT NULL OR file_object_id IS NOT NULL)
) STRICT;

INSERT INTO file_events (
  id, upload_intent_id, file_object_id, event_type, actor_type, actor_id,
  previous_status, next_status, metadata_json, idempotency_key, created_at
)
SELECT
  id, upload_intent_id, file_object_id, event_type, actor_type, actor_id,
  previous_status, next_status, metadata_json, idempotency_key, created_at
FROM phase3e2_backup_file_events;

CREATE INDEX idx_file_events_intent
ON file_events (upload_intent_id, created_at, id);
CREATE INDEX idx_file_events_object
ON file_events (file_object_id, created_at, id);

CREATE TABLE file_audience_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  file_entity_link_id TEXT NOT NULL REFERENCES file_entity_links(id),
  grant_id TEXT REFERENCES file_entity_audience_grants(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'EXPLICIT_LINK_CREATED', 'AUDIENCE_GRANT_CREATED',
    'AUDIENCE_GRANT_REVOKED', 'EXPLICIT_LINK_REVOKED'
  )),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'PRODUCT_APPLICATION', 'PRODUCT_VERSION', 'ORDER', 'REVIEW',
    'BUYER_REFUND', 'SELLER_SETTLEMENT', 'SUPPORT_CASE'
  )),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  subject_type TEXT CHECK (subject_type IS NULL OR subject_type IN (
    'BUYER', 'SELLER_ORGANIZATION', 'STAFF_INTERNAL'
  )),
  subject_authority_id TEXT CHECK (
    subject_authority_id IS NULL
    OR length(subject_authority_id) BETWEEN 1 AND 200
  ),
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'STAFF', 'BUYER_CUSTOMER', 'SELLER_MEMBER', 'SYSTEM'
  )),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  effective_at INTEGER NOT NULL CHECK (effective_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (
    (event_type IN ('EXPLICIT_LINK_CREATED', 'EXPLICIT_LINK_REVOKED')
      AND grant_id IS NULL
      AND subject_type IS NULL
      AND subject_authority_id IS NULL)
    OR (event_type IN ('AUDIENCE_GRANT_CREATED', 'AUDIENCE_GRANT_REVOKED')
      AND grant_id IS NOT NULL
      AND subject_type IS NOT NULL
      AND subject_authority_id IS NOT NULL)
  )
) STRICT;

INSERT INTO file_audience_events (
  id, file_entity_link_id, grant_id, event_type, file_object_id,
  entity_type, entity_id, subject_type, subject_authority_id,
  actor_type, actor_id, effective_at, created_at
)
SELECT
  id, file_entity_link_id, grant_id, event_type, file_object_id,
  entity_type, entity_id, subject_type, subject_authority_id,
  actor_type, actor_id, effective_at, created_at
FROM phase3e2_backup_file_audience_events;

CREATE INDEX idx_file_audience_events_link
ON file_audience_events (file_entity_link_id, created_at, id);

CREATE TABLE order_evidence_version_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  version_id TEXT NOT NULL REFERENCES order_evidence_versions(id),
  submission_id TEXT NOT NULL REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('INTERNAL_ONLY', 'BUYER_VISIBLE')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (version_id, file_object_id)
) STRICT;

INSERT INTO order_evidence_version_files (
  id, version_id, submission_id, reservation_id, buyer_customer_id,
  file_object_id, file_entity_link_id, visibility, created_at
)
SELECT
  id, version_id, submission_id, reservation_id, buyer_customer_id,
  file_object_id, file_entity_link_id, visibility, created_at
FROM phase3e2_backup_order_evidence_version_files;

CREATE INDEX idx_order_evidence_version_files_submission
ON order_evidence_version_files (
  submission_id, version_id, created_at, id
);
CREATE INDEX idx_order_evidence_version_files_object
ON order_evidence_version_files (
  file_object_id, submission_id, version_id, id
);

CREATE TABLE review_evidence_version_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  review_case_id TEXT NOT NULL REFERENCES review_cases(id),
  evidence_version_id TEXT NOT NULL REFERENCES review_evidence_versions(id),
  formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (evidence_version_id, file_object_id)
) STRICT;

INSERT INTO review_evidence_version_files (
  id, review_case_id, evidence_version_id, formal_order_id,
  file_object_id, file_entity_link_id, created_at
)
SELECT
  id, review_case_id, evidence_version_id, formal_order_id,
  file_object_id, file_entity_link_id, created_at
FROM phase3e2_backup_review_evidence_version_files;

CREATE INDEX idx_review_evidence_files_version
ON review_evidence_version_files (evidence_version_id, created_at, id);

CREATE TABLE buyer_refund_payment_entry_files (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  obligation_id TEXT NOT NULL REFERENCES buyer_refund_obligations(id),
  payment_entry_id TEXT NOT NULL REFERENCES buyer_refund_payment_entries(id),
  file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (payment_entry_id, file_object_id)
) STRICT;

INSERT INTO buyer_refund_payment_entry_files (
  id, obligation_id, payment_entry_id, file_object_id,
  file_entity_link_id, created_at
)
SELECT
  id, obligation_id, payment_entry_id, file_object_id,
  file_entity_link_id, created_at
FROM phase3e2_backup_buyer_refund_payment_entry_files;

CREATE INDEX idx_buyer_refund_payment_entry_files_payment
ON buyer_refund_payment_entry_files (payment_entry_id, created_at, id);

-- Restore all original guards and immutability rules only after historical rows
-- have been copied, so legacy states are preserved without weakening new writes.
CREATE TRIGGER trg_file_objects_intent_guard
BEFORE INSERT ON file_objects
WHEN NOT EXISTS (
  SELECT 1 FROM file_upload_intents intent
  WHERE intent.id=NEW.upload_intent_id
    AND intent.status='ISSUED'
    AND intent.purpose=NEW.purpose
    AND intent.visibility=NEW.visibility
    AND NEW.slot_no<=intent.requested_file_count
    AND NEW.upload_expires_at=intent.expires_at
)
BEGIN
  SELECT RAISE(ABORT, 'file_object_intent_mismatch');
END;

CREATE TRIGGER trg_file_objects_verified_guard
BEFORE UPDATE OF status ON file_objects
WHEN NEW.status='VERIFIED' AND NOT EXISTS (
  SELECT 1 FROM file_upload_intents intent
  WHERE intent.id=NEW.upload_intent_id AND intent.status='VERIFIED'
)
BEGIN
  SELECT RAISE(ABORT, 'file_intent_not_verified');
END;

CREATE TRIGGER trg_file_entity_links_verified_guard
BEFORE INSERT ON file_entity_links
WHEN NOT EXISTS (
  SELECT 1
  FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
    AND object.purpose=NEW.purpose
    AND object.visibility=NEW.visibility
)
BEGIN
  SELECT RAISE(ABORT, 'file_object_not_verified');
END;

CREATE TRIGGER trg_explicit_file_link_revoke_only
BEFORE UPDATE ON file_entity_links
WHEN OLD.authorization_mode='EXPLICIT_AUDIENCES' AND (
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.file_object_id IS OLD.file_object_id)
  OR NOT (NEW.entity_type IS OLD.entity_type)
  OR NOT (NEW.entity_id IS OLD.entity_id)
  OR NOT (NEW.purpose IS OLD.purpose)
  OR NOT (NEW.visibility IS OLD.visibility)
  OR NOT (NEW.linked_by_actor_type IS OLD.linked_by_actor_type)
  OR NOT (NEW.linked_by_actor_id IS OLD.linked_by_actor_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NOT (NEW.authorization_mode IS OLD.authorization_mode)
  OR NOT (NEW.expires_at IS OLD.expires_at)
  OR OLD.revoked_at IS NOT NULL
  OR NEW.revoked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'explicit_file_link_is_immutable');
END;

CREATE TRIGGER trg_product_image_file_links_no_update
BEFORE UPDATE ON file_entity_links
WHEN OLD.purpose='PRODUCT_IMAGE'
BEGIN
  SELECT RAISE(ABORT, 'product_image_file_links_are_immutable');
END;
CREATE TRIGGER trg_product_image_file_links_no_delete
BEFORE DELETE ON file_entity_links
WHEN OLD.purpose='PRODUCT_IMAGE'
BEGIN
  SELECT RAISE(ABORT, 'product_image_file_links_are_immutable');
END;

CREATE TRIGGER trg_file_audience_grant_link_guard
BEFORE INSERT ON file_entity_audience_grants
WHEN NOT EXISTS (
  SELECT 1
  FROM file_entity_links link
  JOIN file_objects object ON object.id=link.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  WHERE link.id=NEW.file_entity_link_id
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
)
BEGIN
  SELECT RAISE(ABORT, 'file_audience_grant_link_not_active');
END;

CREATE TRIGGER trg_file_audience_grants_revoke_only
BEFORE UPDATE ON file_entity_audience_grants
WHEN
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.file_entity_link_id IS OLD.file_entity_link_id)
  OR NOT (NEW.subject_type IS OLD.subject_type)
  OR NOT (NEW.buyer_customer_id IS OLD.buyer_customer_id)
  OR NOT (NEW.seller_organization_id IS OLD.seller_organization_id)
  OR NOT (NEW.staff_permission_code IS OLD.staff_permission_code)
  OR NOT (NEW.staff_scope_type IS OLD.staff_scope_type)
  OR NOT (NEW.staff_team_id IS OLD.staff_team_id)
  OR NOT (NEW.granted_by_actor_type IS OLD.granted_by_actor_type)
  OR NOT (NEW.granted_by_actor_id IS OLD.granted_by_actor_id)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NOT (NEW.expires_at IS OLD.expires_at)
  OR OLD.revoked_at IS NOT NULL
  OR NEW.revoked_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'file_audience_grant_is_immutable');
END;
CREATE TRIGGER trg_file_audience_grants_no_delete
BEFORE DELETE ON file_entity_audience_grants
BEGIN
  SELECT RAISE(ABORT, 'file_audience_grants_are_immutable');
END;

CREATE TRIGGER trg_file_read_intents_verified_guard
BEFORE INSERT ON file_read_intents
WHEN NOT EXISTS (
  SELECT 1
  FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link ON link.file_object_id=object.id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
)
BEGIN
  SELECT RAISE(ABORT, 'file_object_not_readable');
END;
CREATE TRIGGER trg_file_read_intent_link_guard
BEFORE INSERT ON file_read_intents
WHEN NEW.file_entity_link_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM file_entity_links link
  WHERE link.id=NEW.file_entity_link_id
    AND link.file_object_id=NEW.file_object_id
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
)
BEGIN
  SELECT RAISE(ABORT, 'file_entity_link_not_readable');
END;

CREATE TRIGGER trg_file_events_no_update
BEFORE UPDATE ON file_events
BEGIN
  SELECT RAISE(ABORT, 'file_events_are_immutable');
END;
CREATE TRIGGER trg_file_events_no_delete
BEFORE DELETE ON file_events
BEGIN
  SELECT RAISE(ABORT, 'file_events_are_immutable');
END;
CREATE TRIGGER trg_file_audience_events_no_update
BEFORE UPDATE ON file_audience_events
BEGIN
  SELECT RAISE(ABORT, 'file_audience_events_are_immutable');
END;
CREATE TRIGGER trg_file_audience_events_no_delete
BEFORE DELETE ON file_audience_events
BEGIN
  SELECT RAISE(ABORT, 'file_audience_events_are_immutable');
END;

CREATE TRIGGER trg_order_evidence_version_file_guard
BEFORE INSERT ON order_evidence_version_files
WHEN
  NOT EXISTS (
    SELECT 1 FROM order_evidence_versions evidence
    WHERE evidence.id=NEW.version_id
      AND evidence.submission_id=NEW.submission_id
      AND evidence.reservation_id=NEW.reservation_id
      AND evidence.buyer_customer_id=NEW.buyer_customer_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM file_objects object
    JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
    WHERE object.id=NEW.file_object_id
      AND object.status='VERIFIED'
      AND intent.status='VERIFIED'
      AND object.purpose='ORDER_EVIDENCE'
      AND intent.purpose='ORDER_EVIDENCE'
      AND object.visibility=NEW.visibility
      AND intent.visibility=NEW.visibility
      AND NEW.visibility<>'SELLER_VISIBLE'
      AND intent.owner_actor_type='BUYER_CUSTOMER'
      AND intent.owner_actor_id=NEW.buyer_customer_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM file_entity_links link
    WHERE link.id=NEW.file_entity_link_id
      AND link.file_object_id=NEW.file_object_id
      AND link.entity_type='ORDER'
      AND link.entity_id=NEW.version_id
      AND link.purpose='ORDER_EVIDENCE'
      AND link.visibility=NEW.visibility
      AND link.linked_by_actor_type='BUYER_CUSTOMER'
      AND link.linked_by_actor_id=NEW.buyer_customer_id
  )
  OR EXISTS (
    SELECT 1 FROM order_evidence_version_files existing
    WHERE existing.file_object_id=NEW.file_object_id
      AND existing.submission_id<>NEW.submission_id
  )
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_file_conflict');
END;
CREATE TRIGGER trg_order_evidence_version_files_no_update
BEFORE UPDATE ON order_evidence_version_files
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_version_files_are_immutable');
END;
CREATE TRIGGER trg_order_evidence_version_files_no_delete
BEFORE DELETE ON order_evidence_version_files
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_version_files_are_immutable');
END;

CREATE TRIGGER trg_review_evidence_version_file_guard
BEFORE INSERT ON review_evidence_version_files
WHEN NOT EXISTS (
  SELECT 1
  FROM review_cases review_case
  JOIN review_evidence_versions evidence
    ON evidence.id=NEW.evidence_version_id
    AND evidence.review_case_id=review_case.id
    AND evidence.formal_order_id=review_case.formal_order_id
  JOIN file_objects object ON object.id=NEW.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id AND link.file_object_id=object.id
  WHERE review_case.id=NEW.review_case_id
    AND review_case.formal_order_id=NEW.formal_order_id
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
    AND object.purpose='REVIEW_EVIDENCE'
    AND intent.purpose='REVIEW_EVIDENCE'
    AND intent.owner_actor_type='BUYER_CUSTOMER'
    AND intent.owner_actor_id=review_case.buyer_customer_id
    AND link.entity_type='REVIEW'
    AND link.entity_id=evidence.id
    AND link.purpose='REVIEW_EVIDENCE'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND (
      SELECT COUNT(*) FROM file_entity_audience_grants grant_row
      WHERE grant_row.file_entity_link_id=link.id
        AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL
          OR grant_row.expires_at>NEW.created_at)
    )=3
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants buyer_grant
      WHERE buyer_grant.file_entity_link_id=link.id
        AND buyer_grant.subject_type='BUYER'
        AND buyer_grant.buyer_customer_id=review_case.buyer_customer_id
        AND buyer_grant.revoked_at IS NULL
        AND (buyer_grant.expires_at IS NULL
          OR buyer_grant.expires_at>NEW.created_at)
    )
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants seller_grant
      WHERE seller_grant.file_entity_link_id=link.id
        AND seller_grant.subject_type='SELLER_ORGANIZATION'
        AND seller_grant.seller_organization_id=review_case.seller_organization_id
        AND seller_grant.revoked_at IS NULL
        AND (seller_grant.expires_at IS NULL
          OR seller_grant.expires_at>NEW.created_at)
    )
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='REVIEW_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND (staff_grant.expires_at IS NULL
          OR staff_grant.expires_at>NEW.created_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_file_authority_mismatch');
END;
CREATE TRIGGER trg_review_evidence_version_files_no_update
BEFORE UPDATE ON review_evidence_version_files
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_version_files_are_immutable');
END;
CREATE TRIGGER trg_review_evidence_version_files_no_delete
BEFORE DELETE ON review_evidence_version_files
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_version_files_are_immutable');
END;

CREATE TRIGGER trg_buyer_refund_payment_entry_file_guard
BEFORE INSERT ON buyer_refund_payment_entry_files
WHEN NOT EXISTS (
  SELECT 1
  FROM buyer_refund_payment_entries payment
  JOIN file_objects object ON object.id=NEW.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id AND link.file_object_id=object.id
  WHERE payment.id=NEW.payment_entry_id
    AND payment.obligation_id=NEW.obligation_id
    AND payment.entry_type='PAYMENT'
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
    AND object.purpose='BUYER_REFUND_PROOF'
    AND intent.purpose='BUYER_REFUND_PROOF'
    AND object.visibility='INTERNAL_ONLY'
    AND intent.visibility='INTERNAL_ONLY'
    AND intent.owner_actor_type='STAFF'
    AND intent.owner_actor_id=payment.recorded_by_staff_id
    AND link.entity_type='BUYER_REFUND'
    AND link.entity_id=payment.id
    AND link.purpose='BUYER_REFUND_PROOF'
    AND link.visibility='INTERNAL_ONLY'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND (
      SELECT COUNT(*) FROM file_entity_audience_grants grant_row
      WHERE grant_row.file_entity_link_id=link.id
        AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL
          OR grant_row.expires_at>NEW.created_at)
    )=1
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='BUYER_REFUND_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND (staff_grant.expires_at IS NULL
          OR staff_grant.expires_at>NEW.created_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_file_authority_mismatch');
END;
CREATE TRIGGER trg_buyer_refund_payment_entry_files_no_update
BEFORE UPDATE ON buyer_refund_payment_entry_files
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_entry_files_are_immutable');
END;
CREATE TRIGGER trg_buyer_refund_payment_entry_files_no_delete
BEFORE DELETE ON buyer_refund_payment_entry_files
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_payment_entry_files_are_immutable');
END;

CREATE TABLE product_version_main_images (
  product_version_id TEXT PRIMARY KEY REFERENCES product_versions(id),
  file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_product_version_main_images_link
ON product_version_main_images (file_entity_link_id, product_version_id);

CREATE TRIGGER trg_product_version_main_image_guard
BEFORE INSERT ON product_version_main_images
WHEN NOT EXISTS (
  SELECT 1
  FROM product_versions version
  JOIN products product ON product.id=version.product_id
  JOIN file_entity_links link ON link.id=NEW.file_entity_link_id
  JOIN file_objects object ON object.id=link.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN staff_users staff ON staff.id=NEW.created_by_staff_id
  WHERE version.id=NEW.product_version_id
    AND staff.status='ACTIVE'
    AND link.entity_type='PRODUCT_VERSION'
    AND link.entity_id=version.id
    AND link.purpose='PRODUCT_IMAGE'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND link.expires_at IS NULL
    AND object.status='VERIFIED'
    AND object.purpose='PRODUCT_IMAGE'
    AND intent.status='VERIFIED'
    AND intent.purpose='PRODUCT_IMAGE'
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants seller_grant
      WHERE seller_grant.file_entity_link_id=link.id
        AND seller_grant.subject_type='SELLER_ORGANIZATION'
        AND seller_grant.seller_organization_id=product.organization_id
        AND seller_grant.revoked_at IS NULL
        AND seller_grant.expires_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='PRODUCT_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.buyer_customer_id IS NULL
        AND staff_grant.seller_organization_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND staff_grant.expires_at IS NULL
    )
)
BEGIN
  SELECT RAISE(ABORT, 'product_version_main_image_link_invalid');
END;
CREATE TRIGGER trg_product_version_main_images_no_update
BEFORE UPDATE ON product_version_main_images
BEGIN
  SELECT RAISE(ABORT, 'product_version_main_images_are_immutable');
END;
CREATE TRIGGER trg_product_version_main_images_no_delete
BEFORE DELETE ON product_version_main_images
BEGIN
  SELECT RAISE(ABORT, 'product_version_main_images_are_immutable');
END;

-- Remove transient backups only after every constrained table and historical
-- row has been restored.
DROP TABLE phase3e2_backup_buyer_refund_payment_entry_files;
DROP TABLE phase3e2_backup_review_evidence_version_files;
DROP TABLE phase3e2_backup_order_evidence_version_files;
DROP TABLE phase3e2_backup_file_audience_events;
DROP TABLE phase3e2_backup_file_entity_audience_grants;
DROP TABLE phase3e2_backup_file_events;
DROP TABLE phase3e2_backup_file_read_intents;
DROP TABLE phase3e2_backup_file_entity_links;
DROP TABLE phase3e2_backup_file_objects;
DROP TABLE phase3e2_backup_file_upload_intents;

UPDATE app_schema_state
SET
  schema_version=19,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=18;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=19
) THEN 1 ELSE 0 END;
