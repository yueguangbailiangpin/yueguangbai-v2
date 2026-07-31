PRAGMA foreign_keys = ON;

-- Formal migration 0013: only advances schema_version from 12 to 13.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM app_schema_state
  WHERE singleton_id=1
    AND schema_version=12
) THEN 1 ELSE 0 END;

CREATE TABLE order_evidence_submissions (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  reservation_id TEXT NOT NULL UNIQUE
    REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code)
    CHECK (marketplace_code='JP'),
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
    CHECK (created_at = submitted_at),
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

CREATE INDEX idx_order_evidence_submission_queue
ON order_evidence_submissions (
  status,
  updated_at,
  id
);

CREATE INDEX idx_order_evidence_submission_buyer
ON order_evidence_submissions (
  buyer_customer_id,
  updated_at,
  id
);

CREATE TRIGGER trg_order_evidence_submission_reservation_guard
BEFORE INSERT ON order_evidence_submissions
WHEN NOT EXISTS (
  SELECT 1
  FROM product_reservations reservation
  WHERE reservation.id=NEW.reservation_id
    AND reservation.buyer_customer_id=NEW.buyer_customer_id
    AND reservation.marketplace_code=NEW.marketplace_code
    AND reservation.status='APPROVED'
)
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_reservation_not_approved');
END;

CREATE TRIGGER trg_order_evidence_submission_identity_immutable
BEFORE UPDATE OF
  reservation_id,
  buyer_customer_id,
  marketplace_code,
  submitted_at,
  created_at
ON order_evidence_submissions
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_submission_identity_immutable');
END;

CREATE TABLE order_evidence_versions (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL
    REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL
    REFERENCES marketplaces(code)
    CHECK (marketplace_code='JP'),
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
    CHECK (created_at >= 0),
  UNIQUE (submission_id, version_no)
) STRICT;

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

CREATE TRIGGER trg_order_evidence_version_submission_guard
BEFORE INSERT ON order_evidence_versions
WHEN NOT EXISTS (
  SELECT 1
  FROM order_evidence_submissions submission
  WHERE submission.id=NEW.submission_id
    AND submission.reservation_id=NEW.reservation_id
    AND submission.buyer_customer_id=NEW.buyer_customer_id
    AND submission.marketplace_code=NEW.marketplace_code
    AND NEW.submitted_by_buyer_id=NEW.buyer_customer_id
    AND (
      (
        NEW.version_no=submission.current_version_no
        AND NEW.version_no=1
        AND submission.status='PENDING_VERIFICATION'
      )
      OR
      (
        NEW.version_no=submission.current_version_no+1
        AND submission.status='CHANGES_REQUESTED'
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_version_submission_mismatch');
END;

CREATE TRIGGER trg_order_evidence_versions_no_update
BEFORE UPDATE ON order_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_versions_are_immutable');
END;

CREATE TRIGGER trg_order_evidence_versions_no_delete
BEFORE DELETE ON order_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_versions_are_immutable');
END;

-- Phase 3C fixes ORDER_EVIDENCE to entity_type='ORDER'. Until Phase 3F creates
-- formal orders, entity_id below is the immutable order_evidence_versions.id.
-- This is a file read-gate namespace link, not a formal order fact.
CREATE TABLE order_evidence_version_files (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL
    REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  file_object_id TEXT NOT NULL
    REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE
    REFERENCES file_entity_links(id),
  visibility TEXT NOT NULL
    CHECK (visibility IN ('INTERNAL_ONLY', 'BUYER_VISIBLE')),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (version_id, file_object_id)
) STRICT;

CREATE INDEX idx_order_evidence_version_files_submission
ON order_evidence_version_files (
  submission_id,
  version_id,
  created_at,
  id
);

CREATE INDEX idx_order_evidence_version_files_object
ON order_evidence_version_files (
  file_object_id,
  submission_id,
  version_id,
  id
);

CREATE TRIGGER trg_order_evidence_version_file_guard
BEFORE INSERT ON order_evidence_version_files
WHEN
  NOT EXISTS (
    SELECT 1
    FROM order_evidence_versions evidence
    WHERE evidence.id=NEW.version_id
      AND evidence.submission_id=NEW.submission_id
      AND evidence.reservation_id=NEW.reservation_id
      AND evidence.buyer_customer_id=NEW.buyer_customer_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
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
    SELECT 1
    FROM file_entity_links link
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
    SELECT 1
    FROM order_evidence_version_files existing
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

CREATE TABLE order_evidence_duplicate_signals (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  source_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  conflicting_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  marketplace_code TEXT NOT NULL
    CHECK (marketplace_code='JP'),
  amazon_order_number_normalized TEXT NOT NULL
    CHECK (length(amazon_order_number_normalized)=19),
  detected_at INTEGER NOT NULL
    CHECK (detected_at >= 0),
  UNIQUE (source_version_id, conflicting_version_id),
  CHECK (source_version_id<>conflicting_version_id)
) STRICT;

CREATE INDEX idx_order_evidence_duplicate_signal_source
ON order_evidence_duplicate_signals (
  source_version_id,
  detected_at,
  id
);

CREATE TRIGGER trg_order_evidence_duplicate_signal_after_version
AFTER INSERT ON order_evidence_versions
BEGIN
  INSERT OR IGNORE INTO order_evidence_duplicate_signals (
    id,
    source_version_id,
    conflicting_version_id,
    marketplace_code,
    amazon_order_number_normalized,
    detected_at
  )
  SELECT
    'duplicate:' || lower(hex(randomblob(16))),
    NEW.id,
    other.id,
    NEW.marketplace_code,
    NEW.amazon_order_number_normalized,
    NEW.created_at
  FROM order_evidence_versions other
  JOIN order_evidence_submissions other_submission
    ON other_submission.id=other.submission_id
    AND other_submission.current_version_no=other.version_no
  JOIN order_evidence_submissions new_submission
    ON new_submission.id=NEW.submission_id
  WHERE other.submission_id<>NEW.submission_id
    AND other.marketplace_code=NEW.marketplace_code
    AND other.amazon_order_number_normalized=
      NEW.amazon_order_number_normalized
    AND other_submission.status<>'WITHDRAWN'
    AND new_submission.status<>'WITHDRAWN';

  INSERT OR IGNORE INTO order_evidence_duplicate_signals (
    id,
    source_version_id,
    conflicting_version_id,
    marketplace_code,
    amazon_order_number_normalized,
    detected_at
  )
  SELECT
    'duplicate:' || lower(hex(randomblob(16))),
    other.id,
    NEW.id,
    NEW.marketplace_code,
    NEW.amazon_order_number_normalized,
    NEW.created_at
  FROM order_evidence_versions other
  JOIN order_evidence_submissions other_submission
    ON other_submission.id=other.submission_id
    AND other_submission.current_version_no=other.version_no
  JOIN order_evidence_submissions new_submission
    ON new_submission.id=NEW.submission_id
  WHERE other.submission_id<>NEW.submission_id
    AND other.marketplace_code=NEW.marketplace_code
    AND other.amazon_order_number_normalized=
      NEW.amazon_order_number_normalized
    AND other_submission.status<>'WITHDRAWN'
    AND new_submission.status<>'WITHDRAWN';
END;

CREATE TRIGGER trg_order_evidence_duplicate_signals_no_update
BEFORE UPDATE ON order_evidence_duplicate_signals
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_duplicate_signals_are_immutable');
END;

CREATE TRIGGER trg_order_evidence_duplicate_signals_no_delete
BEFORE DELETE ON order_evidence_duplicate_signals
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_duplicate_signals_are_immutable');
END;

CREATE TABLE order_evidence_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  submission_id TEXT NOT NULL
    REFERENCES order_evidence_submissions(id),
  reservation_id TEXT NOT NULL
    REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  evidence_version_id TEXT NOT NULL
    REFERENCES order_evidence_versions(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'ORDER_EVIDENCE_SUBMITTED',
      'ORDER_EVIDENCE_RESUBMITTED',
      'ORDER_EVIDENCE_CHANGES_REQUESTED',
      'ORDER_EVIDENCE_VERIFIED',
      'ORDER_EVIDENCE_WITHDRAWN'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('BUYER_CUSTOMER', 'STAFF', 'SYSTEM')),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT
    CHECK (
      previous_status IS NULL
      OR previous_status IN (
        'PENDING_VERIFICATION',
        'CHANGES_REQUESTED',
        'VERIFIED',
        'WITHDRAWN',
        'CONSUMED'
      )
    ),
  next_status TEXT NOT NULL
    CHECK (next_status IN (
      'PENDING_VERIFICATION',
      'CHANGES_REQUESTED',
      'VERIFIED',
      'WITHDRAWN',
      'CONSUMED'
    )),
  aggregate_version INTEGER NOT NULL
    CHECK (aggregate_version >= 1),
  public_reason TEXT
    CHECK (public_reason IS NULL OR length(public_reason) BETWEEN 1 AND 2000),
  internal_note TEXT
    CHECK (internal_note IS NULL OR length(internal_note) BETWEEN 1 AND 4000),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_order_evidence_events_submission
ON order_evidence_events (
  submission_id,
  created_at,
  id
);

CREATE INDEX idx_order_evidence_events_reservation
ON order_evidence_events (
  reservation_id,
  created_at,
  id
);

CREATE TRIGGER trg_order_evidence_event_identity_guard
BEFORE INSERT ON order_evidence_events
WHEN NOT EXISTS (
  SELECT 1
  FROM order_evidence_versions evidence
  WHERE evidence.id=NEW.evidence_version_id
    AND evidence.submission_id=NEW.submission_id
    AND evidence.reservation_id=NEW.reservation_id
    AND evidence.buyer_customer_id=NEW.buyer_customer_id
)
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_event_identity_mismatch');
END;

CREATE TRIGGER trg_order_evidence_events_no_update
BEFORE UPDATE ON order_evidence_events
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_events_are_immutable');
END;

CREATE TRIGGER trg_order_evidence_events_no_delete
BEFORE DELETE ON order_evidence_events
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=13,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=12;
