PRAGMA foreign_keys = ON;

-- Formal migration 0016: only advances schema_version from 15 to 16.
-- Any other preceding schema version must fail before any DDL is applied.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM app_schema_state
  WHERE singleton_id=1
    AND schema_version=15
) THEN 1 ELSE 0 END;

CREATE TABLE review_cases (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  formal_order_id TEXT NOT NULL UNIQUE
    REFERENCES formal_orders(id),
  buyer_customer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  seller_organization_id TEXT NOT NULL
    REFERENCES seller_organizations(id),
  review_type TEXT NOT NULL
    CHECK (review_type IN ('RATING', 'TEXT', 'IMAGE', 'VIDEO')),
  status TEXT NOT NULL
    CHECK (status IN (
      'PENDING_REVIEW',
      'CHANGES_REQUESTED',
      'REJECTED',
      'WITHDRAWN',
      'APPROVED'
    )),
  current_evidence_version_no INTEGER NOT NULL
    CHECK (current_evidence_version_no >= 1),
  version INTEGER NOT NULL
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
  decided_by_staff_id TEXT
    REFERENCES staff_users(id),
  decided_at INTEGER
    CHECK (decided_at IS NULL OR decided_at >= submitted_at),
  withdrawn_at INTEGER
    CHECK (withdrawn_at IS NULL OR withdrawn_at >= submitted_at),
  created_at INTEGER NOT NULL
    CHECK (created_at=submitted_at),
  CHECK (
    (status='PENDING_REVIEW'
      AND public_change_reason IS NULL
      AND decided_by_staff_id IS NULL
      AND decided_at IS NULL
      AND withdrawn_at IS NULL)
    OR
    (status='CHANGES_REQUESTED'
      AND public_change_reason IS NOT NULL
      AND decided_by_staff_id IS NOT NULL
      AND decided_at IS NOT NULL
      AND withdrawn_at IS NULL)
    OR
    (status='REJECTED'
      AND public_change_reason IS NOT NULL
      AND decided_by_staff_id IS NOT NULL
      AND decided_at IS NOT NULL
      AND withdrawn_at IS NULL)
    OR
    (status='APPROVED'
      AND public_change_reason IS NULL
      AND decided_by_staff_id IS NOT NULL
      AND decided_at IS NOT NULL
      AND withdrawn_at IS NULL)
    OR
    (status='WITHDRAWN'
      AND decided_by_staff_id IS NULL
      AND decided_at IS NULL
      AND withdrawn_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_review_cases_buyer_status
ON review_cases (
  buyer_customer_id,
  status,
  updated_at,
  id
);

CREATE INDEX idx_review_cases_seller_status
ON review_cases (
  seller_organization_id,
  status,
  updated_at,
  id
);

CREATE TRIGGER trg_review_case_source_guard
BEFORE INSERT ON review_cases
WHEN NOT EXISTS (
  SELECT 1
  FROM formal_orders formal_order
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.status='CONFIRMED'
    AND formal_order.buyer_customer_id=NEW.buyer_customer_id
    AND formal_order.seller_organization_id=NEW.seller_organization_id
    AND formal_order.review_type=NEW.review_type
    AND NEW.status='PENDING_REVIEW'
    AND NEW.current_evidence_version_no=1
    AND NEW.version=1
)
BEGIN
  SELECT RAISE(ABORT, 'review_case_source_mismatch');
END;

CREATE TRIGGER trg_review_case_transition_guard
BEFORE UPDATE ON review_cases
WHEN
  NOT (NEW.id IS OLD.id)
  OR NOT (NEW.formal_order_id IS OLD.formal_order_id)
  OR NOT (NEW.buyer_customer_id IS OLD.buyer_customer_id)
  OR NOT (NEW.seller_organization_id IS OLD.seller_organization_id)
  OR NOT (NEW.review_type IS OLD.review_type)
  OR NOT (NEW.submitted_at IS OLD.submitted_at)
  OR NOT (NEW.created_at IS OLD.created_at)
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<=OLD.updated_at
  OR NOT (
    (OLD.status='PENDING_REVIEW' AND NEW.status IN (
      'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN', 'APPROVED'
    ) AND NEW.current_evidence_version_no=OLD.current_evidence_version_no)
    OR
    (OLD.status='CHANGES_REQUESTED'
      AND NEW.status='PENDING_REVIEW'
      AND NEW.current_evidence_version_no=OLD.current_evidence_version_no+1)
    OR
    (OLD.status='CHANGES_REQUESTED'
      AND NEW.status='WITHDRAWN'
      AND NEW.current_evidence_version_no=OLD.current_evidence_version_no)
  )
BEGIN
  SELECT RAISE(ABORT, 'review_case_invalid_transition');
END;

CREATE TRIGGER trg_review_cases_no_delete
BEFORE DELETE ON review_cases
BEGIN
  SELECT RAISE(ABORT, 'review_cases_are_immutable');
END;

CREATE TABLE review_evidence_versions (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  review_case_id TEXT NOT NULL
    REFERENCES review_cases(id),
  formal_order_id TEXT NOT NULL
    REFERENCES formal_orders(id),
  version_no INTEGER NOT NULL
    CHECK (version_no >= 1),
  review_type TEXT NOT NULL
    CHECK (review_type IN ('RATING', 'TEXT', 'IMAGE', 'VIDEO')),
  submitted_by_buyer_id TEXT NOT NULL
    REFERENCES buyer_customers(id),
  buyer_note TEXT
    CHECK (buyer_note IS NULL OR length(buyer_note) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (review_case_id, version_no)
) STRICT;

CREATE INDEX idx_review_evidence_versions_order
ON review_evidence_versions (
  formal_order_id,
  version_no,
  id
);

CREATE TRIGGER trg_review_evidence_version_guard
BEFORE INSERT ON review_evidence_versions
WHEN
  NOT EXISTS (
    SELECT 1
    FROM review_cases review_case
    WHERE review_case.id=NEW.review_case_id
      AND review_case.formal_order_id=NEW.formal_order_id
      AND review_case.buyer_customer_id=NEW.submitted_by_buyer_id
      AND review_case.review_type=NEW.review_type
  )
  OR NEW.version_no<>(
    SELECT COALESCE(MAX(existing.version_no), 0)+1
    FROM review_evidence_versions existing
    WHERE existing.review_case_id=NEW.review_case_id
  )
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_version_source_mismatch');
END;

CREATE TRIGGER trg_review_evidence_versions_no_update
BEFORE UPDATE ON review_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_versions_are_immutable');
END;

CREATE TRIGGER trg_review_evidence_versions_no_delete
BEFORE DELETE ON review_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_versions_are_immutable');
END;

CREATE TABLE review_evidence_version_files (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 120),
  review_case_id TEXT NOT NULL
    REFERENCES review_cases(id),
  evidence_version_id TEXT NOT NULL
    REFERENCES review_evidence_versions(id),
  formal_order_id TEXT NOT NULL
    REFERENCES formal_orders(id),
  file_object_id TEXT NOT NULL UNIQUE
    REFERENCES file_objects(id),
  file_entity_link_id TEXT NOT NULL UNIQUE
    REFERENCES file_entity_links(id),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  UNIQUE (evidence_version_id, file_object_id)
) STRICT;

CREATE INDEX idx_review_evidence_files_version
ON review_evidence_version_files (
  evidence_version_id,
  created_at,
  id
);

CREATE TRIGGER trg_review_evidence_version_file_guard
BEFORE INSERT ON review_evidence_version_files
WHEN NOT EXISTS (
  SELECT 1
  FROM review_cases review_case
  JOIN review_evidence_versions evidence
    ON evidence.id=NEW.evidence_version_id
    AND evidence.review_case_id=review_case.id
    AND evidence.formal_order_id=review_case.formal_order_id
  JOIN file_objects object
    ON object.id=NEW.file_object_id
  JOIN file_upload_intents intent
    ON intent.id=object.upload_intent_id
  JOIN file_entity_links link
    ON link.id=NEW.file_entity_link_id
    AND link.file_object_id=object.id
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
      SELECT COUNT(*)
      FROM file_entity_audience_grants grant
      WHERE grant.file_entity_link_id=link.id
        AND grant.revoked_at IS NULL
        AND (grant.expires_at IS NULL OR grant.expires_at>NEW.created_at)
    )=3
    AND EXISTS (
      SELECT 1
      FROM file_entity_audience_grants buyer_grant
      WHERE buyer_grant.file_entity_link_id=link.id
        AND buyer_grant.subject_type='BUYER'
        AND buyer_grant.buyer_customer_id=review_case.buyer_customer_id
        AND buyer_grant.revoked_at IS NULL
        AND (
          buyer_grant.expires_at IS NULL
          OR buyer_grant.expires_at>NEW.created_at
        )
    )
    AND EXISTS (
      SELECT 1
      FROM file_entity_audience_grants seller_grant
      WHERE seller_grant.file_entity_link_id=link.id
        AND seller_grant.subject_type='SELLER_ORGANIZATION'
        AND seller_grant.seller_organization_id=
          review_case.seller_organization_id
        AND seller_grant.revoked_at IS NULL
        AND (
          seller_grant.expires_at IS NULL
          OR seller_grant.expires_at>NEW.created_at
        )
    )
    AND EXISTS (
      SELECT 1
      FROM file_entity_audience_grants staff_grant
      WHERE staff_grant.file_entity_link_id=link.id
        AND staff_grant.subject_type='STAFF_INTERNAL'
        AND staff_grant.staff_permission_code='REVIEW_VIEW'
        AND staff_grant.staff_scope_type='GLOBAL'
        AND staff_grant.staff_team_id IS NULL
        AND staff_grant.revoked_at IS NULL
        AND (
          staff_grant.expires_at IS NULL
          OR staff_grant.expires_at>NEW.created_at
        )
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

CREATE TABLE review_events (
  id TEXT PRIMARY KEY
    CHECK (length(id) BETWEEN 1 AND 200),
  review_case_id TEXT NOT NULL
    REFERENCES review_cases(id),
  formal_order_id TEXT NOT NULL
    REFERENCES formal_orders(id),
  evidence_version_id TEXT NOT NULL
    REFERENCES review_evidence_versions(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'REVIEW_EVIDENCE_SUBMITTED',
      'REVIEW_EVIDENCE_RESUBMITTED',
      'REVIEW_CHANGES_REQUESTED',
      'REVIEW_REJECTED',
      'REVIEW_WITHDRAWN',
      'REVIEW_APPROVED',
      'BUYER_REFUND_BECAME_DUE',
      'SELLER_SERVICE_FEE_ACCRUED'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('BUYER_CUSTOMER', 'STAFF')),
  actor_id TEXT NOT NULL
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT
    CHECK (previous_status IS NULL OR previous_status IN (
      'PENDING_REVIEW',
      'CHANGES_REQUESTED',
      'REJECTED',
      'WITHDRAWN',
      'APPROVED'
    )),
  next_status TEXT NOT NULL
    CHECK (next_status IN (
      'PENDING_REVIEW',
      'CHANGES_REQUESTED',
      'REJECTED',
      'WITHDRAWN',
      'APPROVED'
    )),
  case_version INTEGER NOT NULL
    CHECK (case_version >= 1),
  amount_cny_fen INTEGER
    CHECK (
      amount_cny_fen IS NULL
      OR amount_cny_fen BETWEEN 0 AND 9007199254740991
    ),
  formal_order_financial_snapshot_id TEXT
    REFERENCES formal_order_financial_snapshots(id),
  public_reason TEXT
    CHECK (public_reason IS NULL OR length(public_reason) BETWEEN 1 AND 2000),
  internal_note TEXT
    CHECK (internal_note IS NULL OR length(internal_note) BETWEEN 1 AND 4000),
  metadata_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at INTEGER NOT NULL
    CHECK (created_at >= 0),
  CHECK (
    (event_type IN (
      'BUYER_REFUND_BECAME_DUE',
      'SELLER_SERVICE_FEE_ACCRUED'
    )
      AND amount_cny_fen IS NOT NULL
      AND formal_order_financial_snapshot_id IS NOT NULL
      AND previous_status='PENDING_REVIEW'
      AND next_status='APPROVED')
    OR
    (event_type NOT IN (
      'BUYER_REFUND_BECAME_DUE',
      'SELLER_SERVICE_FEE_ACCRUED'
    )
      AND amount_cny_fen IS NULL
      AND formal_order_financial_snapshot_id IS NULL)
  )
) STRICT;

CREATE INDEX idx_review_events_case
ON review_events (
  review_case_id,
  created_at,
  id
);

CREATE UNIQUE INDEX uq_review_approval_events_once
ON review_events (review_case_id, event_type)
WHERE event_type IN (
  'REVIEW_APPROVED',
  'BUYER_REFUND_BECAME_DUE',
  'SELLER_SERVICE_FEE_ACCRUED'
);

CREATE TRIGGER trg_review_event_identity_guard
BEFORE INSERT ON review_events
WHEN
  NOT EXISTS (
    SELECT 1
    FROM review_cases review_case
    JOIN review_evidence_versions evidence
      ON evidence.id=NEW.evidence_version_id
      AND evidence.review_case_id=review_case.id
      AND evidence.formal_order_id=review_case.formal_order_id
    WHERE review_case.id=NEW.review_case_id
      AND review_case.formal_order_id=NEW.formal_order_id
      AND review_case.status=NEW.next_status
      AND review_case.version=NEW.case_version
      AND evidence.version_no=review_case.current_evidence_version_no
  )
  OR (
    NEW.event_type='BUYER_REFUND_BECAME_DUE'
    AND NOT EXISTS (
      SELECT 1
      FROM formal_order_financial_snapshots snapshot
      WHERE snapshot.id=NEW.formal_order_financial_snapshot_id
        AND snapshot.formal_order_id=NEW.formal_order_id
        AND snapshot.buyer_expected_principal_cny_fen=NEW.amount_cny_fen
    )
  )
  OR (
    NEW.event_type='SELLER_SERVICE_FEE_ACCRUED'
    AND NOT EXISTS (
      SELECT 1
      FROM formal_order_financial_snapshots snapshot
      WHERE snapshot.id=NEW.formal_order_financial_snapshot_id
        AND snapshot.formal_order_id=NEW.formal_order_id
        AND snapshot.service_fee_cny_fen=NEW.amount_cny_fen
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'review_event_identity_mismatch');
END;

CREATE TRIGGER trg_review_events_no_update
BEFORE UPDATE ON review_events
BEGIN
  SELECT RAISE(ABORT, 'review_events_are_immutable');
END;

CREATE TRIGGER trg_review_events_no_delete
BEFORE DELETE ON review_events
BEGIN
  SELECT RAISE(ABORT, 'review_events_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=16,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=15;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
