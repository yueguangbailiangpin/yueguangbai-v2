PRAGMA foreign_keys = ON;

CREATE TABLE file_upload_intents (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  owner_actor_type TEXT NOT NULL
    CHECK (owner_actor_type IN (
      'STAFF',
      'BUYER_CUSTOMER',
      'SELLER_MEMBER',
      'SYSTEM'
    )),
  owner_actor_id TEXT NOT NULL
    CHECK (length(owner_actor_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL
    CHECK (purpose IN (
      'PRODUCT_APPLICATION_IMAGE',
      'ORDER_EVIDENCE',
      'REVIEW_EVIDENCE',
      'BUYER_REFUND_PROOF',
      'SELLER_SETTLEMENT_PROOF',
      'SUPPORT_ATTACHMENT'
    )),
  visibility TEXT NOT NULL
    CHECK (visibility IN (
      'INTERNAL_ONLY',
      'BUYER_VISIBLE',
      'SELLER_VISIBLE'
    )),
  status TEXT NOT NULL
    CHECK (status IN (
      'ISSUED',
      'VERIFYING',
      'VERIFIED',
      'FAILED',
      'EXPIRED',
      'CANCELLED'
    )),
  requested_file_count INTEGER NOT NULL
    CHECK (requested_file_count BETWEEN 1 AND 10),
  manifest_hash TEXT NOT NULL
    CHECK (
      length(manifest_hash)=64
      AND manifest_hash NOT GLOB '*[^0-9a-f]*'
    ),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  expires_at INTEGER NOT NULL
    CHECK (expires_at >= 0),
  failure_code TEXT
    CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  completed_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (
    (status IN ('ISSUED', 'VERIFYING')
      AND completed_at IS NULL
      AND failure_code IS NULL)
    OR
    (status='VERIFIED'
      AND completed_at IS NOT NULL
      AND failure_code IS NULL)
    OR
    (status IN ('FAILED', 'EXPIRED', 'CANCELLED')
      AND completed_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_file_upload_intents_owner_status
ON file_upload_intents (
  owner_actor_type,
  owner_actor_id,
  status,
  created_at,
  id
);

CREATE INDEX idx_file_upload_intents_expiry
ON file_upload_intents (
  status,
  expires_at,
  id
);

CREATE TABLE file_objects (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  upload_intent_id TEXT NOT NULL
    REFERENCES file_upload_intents(id),
  slot_no INTEGER NOT NULL
    CHECK (slot_no BETWEEN 1 AND 10),
  purpose TEXT NOT NULL
    CHECK (purpose IN (
      'PRODUCT_APPLICATION_IMAGE',
      'ORDER_EVIDENCE',
      'REVIEW_EVIDENCE',
      'BUYER_REFUND_PROOF',
      'SELLER_SETTLEMENT_PROOF',
      'SUPPORT_ATTACHMENT'
    )),
  visibility TEXT NOT NULL
    CHECK (visibility IN (
      'INTERNAL_ONLY',
      'BUYER_VISIBLE',
      'SELLER_VISIBLE'
    )),
  object_key TEXT NOT NULL UNIQUE
    CHECK (
      length(object_key) BETWEEN 40 AND 300
      AND object_key GLOB 'files/v1/*'
      AND object_key NOT GLOB '*[^a-z0-9/_-]*'
    ),
  client_file_name TEXT NOT NULL
    CHECK (length(client_file_name) BETWEEN 3 AND 180),
  extension TEXT NOT NULL
    CHECK (extension IN ('jpg', 'jpeg', 'png', 'webp', 'pdf')),
  declared_mime TEXT NOT NULL
    CHECK (declared_mime IN (
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    )),
  expected_byte_size INTEGER NOT NULL
    CHECK (expected_byte_size BETWEEN 1 AND 26214400),
  status TEXT NOT NULL
    CHECK (status IN (
      'RESERVED',
      'UPLOADED',
      'VERIFIED',
      'REJECTED',
      'DELETION_PENDING',
      'DELETED'
    )),
  upload_token_hash TEXT NOT NULL
    CHECK (
      length(upload_token_hash)=64
      AND upload_token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  upload_expires_at INTEGER NOT NULL
    CHECK (upload_expires_at >= 0),
  uploaded_byte_size INTEGER
    CHECK (uploaded_byte_size IS NULL OR uploaded_byte_size >= 1),
  detected_mime TEXT
    CHECK (detected_mime IS NULL OR detected_mime IN (
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    )),
  uploaded_sha256 TEXT
    CHECK (
      uploaded_sha256 IS NULL
      OR (
        length(uploaded_sha256)=64
        AND uploaded_sha256 NOT GLOB '*[^0-9a-f]*'
      )
    ),
  failure_code TEXT
    CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
  delete_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (delete_attempt_count >= 0),
  next_delete_at INTEGER
    CHECK (next_delete_at IS NULL OR next_delete_at >= 0),
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
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
    OR
    (status='REJECTED'
      AND verified_at IS NULL
      AND deleted_at IS NULL
      AND failure_code IS NOT NULL)
    OR
    (status IN ('UPLOADED', 'VERIFIED', 'DELETION_PENDING', 'DELETED')
      AND uploaded_byte_size IS NOT NULL
      AND detected_mime IS NOT NULL
      AND uploaded_sha256 IS NOT NULL
      AND uploaded_at IS NOT NULL)
  ),
  CHECK (
    (status='VERIFIED' AND verified_at IS NOT NULL AND deleted_at IS NULL)
    OR
    (status<>'VERIFIED' AND verified_at IS NULL)
  ),
  CHECK (
    (status='DELETION_PENDING'
      AND failure_code IS NOT NULL
      AND next_delete_at IS NOT NULL
      AND deleted_at IS NULL)
    OR
    (status='DELETED'
      AND failure_code IS NOT NULL
      AND next_delete_at IS NULL
      AND deleted_at IS NOT NULL)
    OR
    (status NOT IN ('DELETION_PENDING', 'DELETED'))
  ),
  CHECK (
    (declared_mime='image/jpeg' AND extension IN ('jpg', 'jpeg'))
    OR (declared_mime='image/png' AND extension='png')
    OR (declared_mime='image/webp' AND extension='webp')
    OR (declared_mime='application/pdf' AND extension='pdf')
  )
) STRICT;

CREATE INDEX idx_file_objects_intent_status
ON file_objects (
  upload_intent_id,
  status,
  slot_no,
  id
);

CREATE INDEX idx_file_objects_cleanup
ON file_objects (
  status,
  next_delete_at,
  delete_attempt_count,
  id
);

CREATE TRIGGER trg_file_objects_intent_guard
BEFORE INSERT ON file_objects
WHEN NOT EXISTS (
  SELECT 1
  FROM file_upload_intents intent
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
  SELECT 1
  FROM file_upload_intents intent
  WHERE intent.id=NEW.upload_intent_id
    AND intent.status='VERIFIED'
)
BEGIN
  SELECT RAISE(ABORT, 'file_intent_not_verified');
END;

CREATE TABLE file_entity_links (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  file_object_id TEXT NOT NULL
    REFERENCES file_objects(id),
  entity_type TEXT NOT NULL
    CHECK (entity_type IN (
      'PRODUCT_APPLICATION',
      'ORDER',
      'REVIEW',
      'BUYER_REFUND',
      'SELLER_SETTLEMENT',
      'SUPPORT_CASE'
    )),
  entity_id TEXT NOT NULL
    CHECK (length(entity_id) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL
    CHECK (purpose IN (
      'PRODUCT_APPLICATION_IMAGE',
      'ORDER_EVIDENCE',
      'REVIEW_EVIDENCE',
      'BUYER_REFUND_PROOF',
      'SELLER_SETTLEMENT_PROOF',
      'SUPPORT_ATTACHMENT'
    )),
  visibility TEXT NOT NULL
    CHECK (visibility IN (
      'INTERNAL_ONLY',
      'BUYER_VISIBLE',
      'SELLER_VISIBLE'
    )),
  linked_by_actor_type TEXT NOT NULL
    CHECK (linked_by_actor_type IN (
      'STAFF',
      'BUYER_CUSTOMER',
      'SELLER_MEMBER',
      'SYSTEM'
    )),
  linked_by_actor_id TEXT NOT NULL
    CHECK (length(linked_by_actor_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (file_object_id, entity_type, entity_id),
  CHECK (
    (purpose='PRODUCT_APPLICATION_IMAGE'
      AND entity_type='PRODUCT_APPLICATION')
    OR (purpose='ORDER_EVIDENCE' AND entity_type='ORDER')
    OR (purpose='REVIEW_EVIDENCE' AND entity_type='REVIEW')
    OR (purpose='BUYER_REFUND_PROOF' AND entity_type='BUYER_REFUND')
    OR (purpose='SELLER_SETTLEMENT_PROOF'
      AND entity_type='SELLER_SETTLEMENT')
    OR (purpose='SUPPORT_ATTACHMENT' AND entity_type='SUPPORT_CASE')
  )
) STRICT;

CREATE INDEX idx_file_entity_links_entity
ON file_entity_links (
  entity_type,
  entity_id,
  purpose,
  created_at,
  id
);

CREATE TRIGGER trg_file_entity_links_verified_guard
BEFORE INSERT ON file_entity_links
WHEN NOT EXISTS (
  SELECT 1
  FROM file_objects object
  JOIN file_upload_intents intent
    ON intent.id=object.upload_intent_id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
    AND object.purpose=NEW.purpose
    AND object.visibility=NEW.visibility
)
BEGIN
  SELECT RAISE(ABORT, 'file_object_not_verified');
END;

CREATE TABLE file_read_intents (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  file_object_id TEXT NOT NULL
    REFERENCES file_objects(id),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN (
      'STAFF',
      'BUYER_CUSTOMER',
      'SELLER_MEMBER',
      'SYSTEM'
    )),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  token_hash TEXT NOT NULL UNIQUE
    CHECK (
      length(token_hash)=64
      AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  status TEXT NOT NULL
    CHECK (status IN (
      'ISSUED',
      'CONSUMED',
      'EXPIRED',
      'REVOKED'
    )),
  use_count INTEGER NOT NULL DEFAULT 0
    CHECK (use_count IN (0, 1)),
  expires_at INTEGER NOT NULL
    CHECK (expires_at >= 0),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (updated_at >= created_at),
  consumed_at INTEGER,
  revoked_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (
    (status='ISSUED'
      AND use_count=0
      AND consumed_at IS NULL
      AND revoked_at IS NULL)
    OR
    (status='CONSUMED'
      AND use_count=1
      AND consumed_at IS NOT NULL
      AND revoked_at IS NULL)
    OR
    (status='EXPIRED'
      AND use_count=0
      AND consumed_at IS NULL
      AND revoked_at IS NULL)
    OR
    (status='REVOKED'
      AND use_count=0
      AND consumed_at IS NULL
      AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_file_read_intents_actor_status
ON file_read_intents (
  actor_type,
  actor_id,
  status,
  expires_at,
  id
);

CREATE INDEX idx_file_read_intents_file_status
ON file_read_intents (
  file_object_id,
  status,
  created_at,
  id
);

CREATE TRIGGER trg_file_read_intents_verified_guard
BEFORE INSERT ON file_read_intents
WHEN NOT EXISTS (
  SELECT 1
  FROM file_objects object
  JOIN file_upload_intents intent
    ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.file_object_id=object.id
  WHERE object.id=NEW.file_object_id
    AND object.status='VERIFIED'
    AND intent.status='VERIFIED'
)
BEGIN
  SELECT RAISE(ABORT, 'file_object_not_readable');
END;

CREATE TABLE file_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  upload_intent_id TEXT
    REFERENCES file_upload_intents(id),
  file_object_id TEXT
    REFERENCES file_objects(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'UPLOAD_INTENT_ISSUED',
      'FILE_OBJECT_UPLOADED',
      'FILE_UPLOAD_VERIFIED',
      'FILE_UPLOAD_FAILED',
      'FILE_OBJECT_LINKED',
      'FILE_READ_INTENT_ISSUED',
      'FILE_READ_INTENT_CONSUMED',
      'FILE_COMPENSATION_SCHEDULED',
      'FILE_OBJECT_DELETED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN (
      'STAFF',
      'BUYER_CUSTOMER',
      'SELLER_MEMBER',
      'SYSTEM'
    )),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT,
  next_status TEXT NOT NULL
    CHECK (length(next_status) BETWEEN 1 AND 40),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  CHECK (upload_intent_id IS NOT NULL OR file_object_id IS NOT NULL)
) STRICT;

CREATE INDEX idx_file_events_intent
ON file_events (
  upload_intent_id,
  created_at,
  id
);

CREATE INDEX idx_file_events_object
ON file_events (
  file_object_id,
  created_at,
  id
);

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

UPDATE app_schema_state
SET
  schema_version=10,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
