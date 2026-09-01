-- Stage 7.5R: SERVICE_CHANNEL_QR file purpose for company service channel
-- QR codes. Rebuilds the three file-chain tables (0028 pattern) to extend
-- the purpose/entity CHECK constraints, restoring every dependent index and
-- trigger verbatim (self-owned first, then the eleven cross-table guards in
-- dependency order). Append-only; historical migrations untouched.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=33 THEN 1 ELSE 0 END;

-- Cross-table guards referencing the rebuilt tables come out first (0028
-- pattern) and return verbatim at the end of this migration.
DROP TRIGGER IF EXISTS trg_archive_bundle_files_insert_guard;
DROP TRIGGER IF EXISTS trg_buyer_advance_principal_entry_files_guard;
DROP TRIGGER IF EXISTS trg_buyer_refund_payment_entry_file_guard;
DROP TRIGGER IF EXISTS trg_file_audience_grant_link_guard;
DROP TRIGGER IF EXISTS trg_file_read_intent_link_guard;
DROP TRIGGER IF EXISTS trg_file_read_intents_verified_guard;
DROP TRIGGER IF EXISTS trg_order_evidence_version_file_guard;
DROP TRIGGER IF EXISTS trg_order_instruction_version_main_image_guard;
DROP TRIGGER IF EXISTS trg_product_version_main_image_guard;
DROP TRIGGER IF EXISTS trg_review_evidence_version_file_guard;
DROP TRIGGER IF EXISTS trg_seller_payment_proof_guard;
DROP TRIGGER IF EXISTS trg_file_objects_intent_guard;
DROP TRIGGER IF EXISTS trg_file_objects_verified_guard;
DROP TRIGGER IF EXISTS trg_explicit_file_link_revoke_only;
DROP TRIGGER IF EXISTS trg_file_entity_links_verified_guard;
DROP TRIGGER IF EXISTS trg_product_image_file_links_no_delete;
DROP TRIGGER IF EXISTS trg_product_image_file_links_no_update;

CREATE TABLE "file_upload_intents_stage75r_new" (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  owner_actor_type TEXT NOT NULL CHECK (owner_actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  owner_actor_id TEXT NOT NULL CHECK (length(owner_actor_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE','PRODUCT_IMAGE','ORDER_EVIDENCE',
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_COMMUNICATION_SCREENSHOT',
    'REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF',
    'SUPPORT_ATTACHMENT','SERVICE_CHANNEL_QR'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'ISSUED','VERIFYING','VERIFIED','FAILED','EXPIRED','CANCELLED'
  )),
  requested_file_count INTEGER NOT NULL CHECK (requested_file_count BETWEEN 1 AND 10),
  manifest_hash TEXT NOT NULL CHECK (
    length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  completed_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (
    (status IN ('ISSUED','VERIFYING') AND completed_at IS NULL AND failure_code IS NULL)
    OR (status='VERIFIED' AND completed_at IS NOT NULL AND failure_code IS NULL)
    OR (status IN ('FAILED','EXPIRED','CANCELLED') AND completed_at IS NOT NULL)
  )
) STRICT;

INSERT INTO file_upload_intents_stage75r_new (
  id, owner_actor_type, owner_actor_id, purpose, visibility, status,
  requested_file_count, manifest_hash, version, expires_at, failure_code,
  created_at, updated_at, completed_at
) SELECT
  id, owner_actor_type, owner_actor_id, purpose, visibility, status,
  requested_file_count, manifest_hash, version, expires_at, failure_code,
  created_at, updated_at, completed_at
FROM file_upload_intents;
DROP TABLE file_upload_intents;
ALTER TABLE file_upload_intents_stage75r_new RENAME TO file_upload_intents;

CREATE TABLE "file_objects_stage75r_new" (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  upload_intent_id TEXT NOT NULL REFERENCES file_upload_intents(id),
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 1 AND 10),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE','PRODUCT_IMAGE','ORDER_EVIDENCE',
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_COMMUNICATION_SCREENSHOT',
    'REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF',
    'SUPPORT_ATTACHMENT','SERVICE_CHANNEL_QR'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  object_key TEXT NOT NULL UNIQUE CHECK (
    length(object_key) BETWEEN 40 AND 300
    AND object_key GLOB 'files/v1/*'
    AND object_key NOT GLOB '*[^a-z0-9/_-]*'
  ),
  client_file_name TEXT NOT NULL CHECK (length(client_file_name) BETWEEN 3 AND 180),
  extension TEXT NOT NULL CHECK (extension IN ('jpg','jpeg','png','webp','pdf')),
  declared_mime TEXT NOT NULL CHECK (declared_mime IN (
    'image/jpeg','image/png','image/webp','application/pdf'
  )),
  expected_byte_size INTEGER NOT NULL CHECK (expected_byte_size BETWEEN 1 AND 26214400),
  status TEXT NOT NULL CHECK (status IN (
    'RESERVED','UPLOADED','VERIFIED','REJECTED','DELETION_PENDING','DELETED'
  )),
  upload_token_hash TEXT NOT NULL CHECK (
    length(upload_token_hash)=64 AND upload_token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  upload_expires_at INTEGER NOT NULL CHECK (upload_expires_at >= 0),
  uploaded_byte_size INTEGER CHECK (uploaded_byte_size IS NULL OR uploaded_byte_size >= 1),
  detected_mime TEXT CHECK (detected_mime IS NULL OR detected_mime IN (
    'image/jpeg','image/png','image/webp','application/pdf'
  )),
  uploaded_sha256 TEXT CHECK (
    uploaded_sha256 IS NULL OR (
      length(uploaded_sha256)=64 AND uploaded_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
  delete_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (delete_attempt_count >= 0),
  next_delete_at INTEGER CHECK (next_delete_at IS NULL OR next_delete_at >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  uploaded_at INTEGER,
  verified_at INTEGER,
  deleted_at INTEGER,
  UNIQUE (upload_intent_id,slot_no),
  CHECK (upload_expires_at >= created_at),
  CHECK (
    (status='RESERVED' AND uploaded_byte_size IS NULL AND detected_mime IS NULL
      AND uploaded_sha256 IS NULL AND uploaded_at IS NULL
      AND verified_at IS NULL AND deleted_at IS NULL)
    OR (status='REJECTED' AND verified_at IS NULL AND deleted_at IS NULL
      AND failure_code IS NOT NULL)
    OR (status IN ('UPLOADED','VERIFIED','DELETION_PENDING','DELETED')
      AND uploaded_byte_size IS NOT NULL AND detected_mime IS NOT NULL
      AND uploaded_sha256 IS NOT NULL AND uploaded_at IS NOT NULL)
  ),
  CHECK (
    (status='VERIFIED' AND verified_at IS NOT NULL AND deleted_at IS NULL)
    OR (status<>'VERIFIED' AND verified_at IS NULL)
  ),
  CHECK (
    (status='DELETION_PENDING' AND failure_code IS NOT NULL
      AND next_delete_at IS NOT NULL AND deleted_at IS NULL)
    OR (status='DELETED' AND failure_code IS NOT NULL
      AND next_delete_at IS NULL AND deleted_at IS NOT NULL)
    OR (status NOT IN ('DELETION_PENDING','DELETED'))
  ),
  CHECK (
    (declared_mime='image/jpeg' AND extension IN ('jpg','jpeg'))
    OR (declared_mime='image/png' AND extension='png')
    OR (declared_mime='image/webp' AND extension='webp')
    OR (declared_mime='application/pdf' AND extension='pdf')
  ),
  CHECK (
    purpose<>'ORDER_INSTRUCTION_KEYWORD_IMAGE'
    OR (declared_mime='image/png' AND extension='png')
  ),
  CHECK (
    purpose<>'ORDER_COMMUNICATION_SCREENSHOT'
    OR declared_mime IN ('image/jpeg','image/png','image/webp')
  )
) STRICT;

INSERT INTO file_objects_stage75r_new (
  id, upload_intent_id, slot_no, purpose, visibility, object_key,
  client_file_name, extension, declared_mime, expected_byte_size, status,
  upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime,
  uploaded_sha256, failure_code, delete_attempt_count, next_delete_at,
  version, created_at, updated_at, uploaded_at, verified_at, deleted_at
) SELECT
  id, upload_intent_id, slot_no, purpose, visibility, object_key,
  client_file_name, extension, declared_mime, expected_byte_size, status,
  upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime,
  uploaded_sha256, failure_code, delete_attempt_count, next_delete_at,
  version, created_at, updated_at, uploaded_at, verified_at, deleted_at
FROM file_objects;
DROP TABLE file_objects;
ALTER TABLE file_objects_stage75r_new RENAME TO file_objects;

CREATE TABLE "file_entity_links_stage75r_new" (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  file_object_id TEXT NOT NULL REFERENCES file_objects(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'PRODUCT_APPLICATION','PRODUCT_VERSION','ORDER_INSTRUCTION_VERSION',
    'ORDER_EVIDENCE_SUBMISSION','ORDER','REVIEW','BUYER_REFUND',
    'SELLER_SETTLEMENT','SUPPORT_CASE','SERVICE_CHANNEL'
  )),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'PRODUCT_APPLICATION_IMAGE','PRODUCT_IMAGE','ORDER_EVIDENCE',
    'ORDER_INSTRUCTION_KEYWORD_IMAGE','ORDER_COMMUNICATION_SCREENSHOT',
    'REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF',
    'SUPPORT_ATTACHMENT','SERVICE_CHANNEL_QR'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'INTERNAL_ONLY','BUYER_VISIBLE','SELLER_VISIBLE'
  )),
  linked_by_actor_type TEXT NOT NULL CHECK (linked_by_actor_type IN (
    'STAFF','BUYER_CUSTOMER','SELLER_MEMBER','SYSTEM'
  )),
  linked_by_actor_id TEXT NOT NULL CHECK (length(linked_by_actor_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  authorization_mode TEXT NOT NULL DEFAULT 'LEGACY_VISIBILITY'
    CHECK (authorization_mode IN ('LEGACY_VISIBILITY','EXPLICIT_AUDIENCES')),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= created_at),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (file_object_id,entity_type,entity_id),
  CHECK (
    (purpose='PRODUCT_APPLICATION_IMAGE' AND entity_type='PRODUCT_APPLICATION')
    OR (purpose='PRODUCT_IMAGE'
      AND entity_type IN ('PRODUCT_VERSION','ORDER_INSTRUCTION_VERSION'))
    OR (purpose='ORDER_INSTRUCTION_KEYWORD_IMAGE'
      AND entity_type='ORDER_INSTRUCTION_VERSION')
    OR (purpose='ORDER_COMMUNICATION_SCREENSHOT'
      AND entity_type='ORDER')
    OR (purpose='ORDER_EVIDENCE' AND entity_type='ORDER')
    OR (purpose='REVIEW_EVIDENCE' AND entity_type='REVIEW')
    OR (purpose='BUYER_REFUND_PROOF' AND entity_type='BUYER_REFUND')
    OR (purpose='SELLER_SETTLEMENT_PROOF' AND entity_type='SELLER_SETTLEMENT')
    OR (purpose='SUPPORT_ATTACHMENT' AND entity_type='SUPPORT_CASE')
    OR (purpose='SERVICE_CHANNEL_QR' AND entity_type='SERVICE_CHANNEL')
  )
) STRICT;

INSERT INTO file_entity_links_stage75r_new (
  id, file_object_id, entity_type, entity_id, purpose, visibility,
  linked_by_actor_type, linked_by_actor_id, created_at, authorization_mode,
  expires_at, revoked_at
) SELECT
  id, file_object_id, entity_type, entity_id, purpose, visibility,
  linked_by_actor_type, linked_by_actor_id, created_at, authorization_mode,
  expires_at, revoked_at
FROM file_entity_links;
DROP TABLE file_entity_links;
ALTER TABLE file_entity_links_stage75r_new RENAME TO file_entity_links;

CREATE INDEX idx_file_upload_intents_expiry
ON file_upload_intents (status,expires_at,id);

CREATE INDEX idx_file_upload_intents_owner_status
ON file_upload_intents (owner_actor_type,owner_actor_id,status,created_at,id);

CREATE INDEX idx_file_objects_cleanup
ON file_objects (status,next_delete_at,delete_attempt_count,id);

CREATE INDEX idx_file_objects_intent_status
ON file_objects (upload_intent_id,status,slot_no,id);

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
BEGIN SELECT RAISE(ABORT,'file_object_intent_mismatch'); END;

CREATE TRIGGER trg_file_objects_verified_guard
BEFORE UPDATE OF status ON file_objects
WHEN NEW.status='VERIFIED' AND NOT EXISTS (
  SELECT 1 FROM file_upload_intents intent
  WHERE intent.id=NEW.upload_intent_id AND intent.status='VERIFIED'
)
BEGIN SELECT RAISE(ABORT,'file_intent_not_verified'); END;

CREATE INDEX idx_file_entity_links_authorization
ON file_entity_links (
  authorization_mode,file_object_id,revoked_at,expires_at,created_at,id
);

CREATE INDEX idx_file_entity_links_entity
ON file_entity_links (entity_type,entity_id,purpose,created_at,id);

CREATE UNIQUE INDEX uq_product_image_file_object
ON file_entity_links (file_object_id)
WHERE purpose='PRODUCT_IMAGE' AND entity_type='PRODUCT_VERSION';

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
BEGIN SELECT RAISE(ABORT,'explicit_file_link_is_immutable'); END;

CREATE TRIGGER trg_file_entity_links_verified_guard
BEFORE INSERT ON file_entity_links
WHEN NOT EXISTS (
  SELECT 1 FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED' AND intent.status='VERIFIED'
    AND object.purpose=NEW.purpose
    AND (
      object.visibility=NEW.visibility
      OR (NEW.entity_type='ORDER_INSTRUCTION_VERSION'
        AND NEW.purpose='PRODUCT_IMAGE'
        AND NEW.visibility='BUYER_VISIBLE')
      OR (NEW.entity_type='ORDER_INSTRUCTION_VERSION'
        AND NEW.purpose='ORDER_INSTRUCTION_KEYWORD_IMAGE'
        AND object.visibility='INTERNAL_ONLY'
        AND NEW.visibility='BUYER_VISIBLE')
    )
)
BEGIN SELECT RAISE(ABORT,'file_object_not_verified'); END;

CREATE TRIGGER trg_product_image_file_links_no_delete
BEFORE DELETE ON file_entity_links
WHEN OLD.purpose='PRODUCT_IMAGE' AND OLD.entity_type='PRODUCT_VERSION'
BEGIN SELECT RAISE(ABORT,'product_image_file_links_are_immutable'); END;

CREATE TRIGGER trg_product_image_file_links_no_update
BEFORE UPDATE ON file_entity_links
WHEN OLD.purpose='PRODUCT_IMAGE' AND OLD.entity_type='PRODUCT_VERSION'
BEGIN SELECT RAISE(ABORT,'product_image_file_links_are_immutable'); END;

CREATE TRIGGER trg_archive_bundle_files_insert_guard
BEFORE INSERT ON archive_bundle_files
WHEN NOT EXISTS (
  SELECT 1 FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN archive_bundles bundle ON bundle.id=NEW.bundle_id
  WHERE object.id=NEW.file_object_id AND object.status='VERIFIED'
    AND intent.status='VERIFIED' AND object.purpose=NEW.purpose
    AND object.visibility=NEW.visibility
    AND object.detected_mime=NEW.mime_type
    AND object.uploaded_byte_size=NEW.byte_size
    AND object.uploaded_sha256=NEW.sha256
    AND object.version=NEW.source_version
    AND bundle.sealed_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'archive_bundle_file_source_mismatch'); END;

CREATE TRIGGER trg_buyer_advance_principal_entry_files_guard
BEFORE INSERT ON buyer_advance_principal_entry_files
WHEN NOT EXISTS(
  SELECT 1 FROM buyer_advance_principal_entries entry
  JOIN file_entity_links link ON link.id=NEW.file_entity_link_id
  WHERE entry.id=NEW.advance_payment_entry_id
    AND entry.entry_type='PAYMENT'
    AND link.file_object_id=NEW.file_object_id
    AND link.entity_type='BUYER_REFUND'
    AND link.entity_id=NEW.advance_payment_entry_id
    AND link.purpose='BUYER_REFUND_PROOF'
    AND link.visibility='INTERNAL_ONLY'
    AND link.revoked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_proof_link_mismatch');
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

CREATE TRIGGER trg_file_audience_grant_link_guard
BEFORE INSERT ON file_entity_audience_grants
WHEN NOT EXISTS (
  SELECT 1 FROM file_entity_links link
  JOIN file_objects object ON object.id=link.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  WHERE link.id=NEW.file_entity_link_id
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND object.status='VERIFIED' AND intent.status='VERIFIED'
)
BEGIN SELECT RAISE(ABORT,'file_audience_grant_link_not_active'); END;

CREATE TRIGGER trg_file_read_intent_link_guard
BEFORE INSERT ON file_read_intents
WHEN NEW.file_entity_link_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM file_entity_links link
  WHERE link.id=NEW.file_entity_link_id
    AND link.file_object_id=NEW.file_object_id
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
)
BEGIN SELECT RAISE(ABORT,'file_entity_link_not_readable'); END;

CREATE TRIGGER trg_file_read_intents_verified_guard
BEFORE INSERT ON file_read_intents
WHEN NOT EXISTS (
  SELECT 1 FROM file_objects object
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link ON link.file_object_id=object.id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED' AND intent.status='VERIFIED'
)
BEGIN SELECT RAISE(ABORT,'file_object_not_readable'); END;

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
    SELECT 1 FROM file_objects object
    JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
    WHERE object.id=NEW.file_object_id
      AND object.status='VERIFIED' AND intent.status='VERIFIED'
      AND object.purpose='ORDER_EVIDENCE' AND intent.purpose='ORDER_EVIDENCE'
      AND object.visibility=NEW.visibility AND intent.visibility=NEW.visibility
      AND NEW.visibility<>'SELLER_VISIBLE'
      AND object.detected_mime IN ('image/jpeg','image/png','image/webp')
      AND intent.owner_actor_type='BUYER_CUSTOMER'
      AND intent.owner_actor_id=NEW.buyer_customer_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM file_entity_links link
    WHERE link.id=NEW.file_entity_link_id
      AND link.file_object_id=NEW.file_object_id
      AND link.entity_type='ORDER' AND link.entity_id=NEW.version_id
      AND link.purpose='ORDER_EVIDENCE' AND link.visibility=NEW.visibility
      AND link.linked_by_actor_type='BUYER_CUSTOMER'
      AND link.linked_by_actor_id=NEW.buyer_customer_id
  )
  OR EXISTS (
    SELECT 1 FROM order_evidence_version_files existing
    WHERE existing.file_object_id=NEW.file_object_id
      AND existing.submission_id<>NEW.submission_id
  )
BEGIN SELECT RAISE(ABORT,'order_evidence_file_conflict'); END;

CREATE TRIGGER trg_order_instruction_version_main_image_guard
BEFORE INSERT ON order_instruction_versions
WHEN NOT EXISTS (
  SELECT 1 FROM file_entity_links link
  JOIN file_objects object ON object.id=link.file_object_id
  WHERE link.id=NEW.main_image_file_entity_link_id
    AND link.entity_type='ORDER_INSTRUCTION_VERSION'
    AND link.entity_id=NEW.id
    AND link.purpose='PRODUCT_IMAGE'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND object.status='VERIFIED'
    AND object.purpose='PRODUCT_IMAGE'
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_main_image_mismatch');
END;

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
    AND link.revoked_at IS NULL AND link.expires_at IS NULL
    AND object.status='VERIFIED' AND object.purpose='PRODUCT_IMAGE'
    AND intent.status='VERIFIED' AND intent.purpose='PRODUCT_IMAGE'
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
        AND staff_grant.revoked_at IS NULL
        AND staff_grant.expires_at IS NULL
    )
)
BEGIN SELECT RAISE(ABORT,'product_version_main_image_mismatch'); END;

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

CREATE TRIGGER trg_seller_payment_proof_guard
BEFORE INSERT ON seller_payment_proofs
WHEN NOT EXISTS (
  SELECT 1
  FROM seller_payments payment
  JOIN file_objects object ON object.id=NEW.file_object_id
  JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id
    AND link.file_object_id=object.id
  WHERE payment.id=NEW.payment_id
    AND payment.seller_organization_id=NEW.seller_organization_id
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
    AND object.purpose='SELLER_SETTLEMENT_PROOF'
    AND intent.purpose='SELLER_SETTLEMENT_PROOF'
    AND object.visibility='INTERNAL_ONLY'
    AND intent.visibility='INTERNAL_ONLY'
    AND COALESCE(object.detected_mime, object.declared_mime)
      IN ('image/jpeg','image/png','image/webp')
    AND (
      (intent.owner_actor_type='STAFF'
        AND intent.owner_actor_id=payment.recorded_by_staff_id)
      OR intent.owner_actor_type='SYSTEM'
    )
    AND link.entity_type='SELLER_SETTLEMENT'
    AND link.entity_id=payment.id
    AND link.purpose='SELLER_SETTLEMENT_PROOF'
    AND link.visibility='INTERNAL_ONLY'
    AND link.authorization_mode='EXPLICIT_AUDIENCES'
    AND link.revoked_at IS NULL
    AND (link.expires_at IS NULL OR link.expires_at>NEW.created_at)
    AND (
      SELECT COUNT(*) FROM file_entity_audience_grants grant_row
      WHERE grant_row.file_entity_link_id=link.id
        AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL OR grant_row.expires_at>NEW.created_at)
    )=1
    AND EXISTS (
      SELECT 1 FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='SELLER_SETTLEMENT_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND (staff_grant.expires_at IS NULL OR staff_grant.expires_at>NEW.created_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'seller_payment_proof_authority_mismatch');
END;

UPDATE app_schema_state
SET
  schema_version=34,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=33;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=34 THEN 1 ELSE 0 END;
