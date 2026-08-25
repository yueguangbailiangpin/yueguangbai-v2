-- Baseline 0016 order_instructions (stage 3 clean rebuild; provenance: legacy 0001-0075 final state, D-054)

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=15 THEN 1 ELSE 0 END;

CREATE TABLE order_instructions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  reservation_id TEXT NOT NULL UNIQUE REFERENCES product_reservations(id),
  buyer_customer_id TEXT NOT NULL REFERENCES buyer_customers(id),
  marketplace_code TEXT NOT NULL REFERENCES marketplaces(code)
    CHECK (marketplace_code='JP'),
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

CREATE TABLE order_instruction_versions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  instruction_id TEXT NOT NULL REFERENCES order_instructions(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  reservation_id TEXT NOT NULL REFERENCES product_reservations(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_version_id TEXT NOT NULL REFERENCES product_versions(id),
  product_version_no INTEGER NOT NULL CHECK (product_version_no >= 1),
  main_image_file_entity_link_id TEXT NOT NULL REFERENCES file_entity_links(id),
  store_display_name_snapshot TEXT NOT NULL
    CHECK (length(store_display_name_snapshot) BETWEEN 1 AND 200),
  demand_buyer_visible_notes_snapshot TEXT CHECK (
    demand_buyer_visible_notes_snapshot IS NULL
    OR length(demand_buyer_visible_notes_snapshot) BETWEEN 1 AND 2000
  ),
  staff_public_note TEXT CHECK (
    staff_public_note IS NULL OR length(staff_public_note) BETWEEN 1 AND 2000
  ),
  reference_order_amount_jpy INTEGER NOT NULL CHECK (
    reference_order_amount_jpy BETWEEN 0 AND 9007199254740991
  ),
  buyer_self_pay_bps INTEGER NOT NULL CHECK (buyer_self_pay_bps BETWEEN 0 AND 10000),
  estimated_self_pay_jpy INTEGER NOT NULL CHECK (
    estimated_self_pay_jpy BETWEEN 0 AND 9007199254740991
  ),
  estimated_refundable_principal_jpy INTEGER NOT NULL CHECK (
    estimated_refundable_principal_jpy BETWEEN 0 AND 9007199254740991
  ),
  color_spec_mode TEXT NOT NULL CHECK (
    color_spec_mode IN ('MAIN_IMAGE_VARIANT', 'ANY_VARIANT')
  ),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  generator_version TEXT NOT NULL CHECK (length(generator_version) BETWEEN 1 AND 100),
  published_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  initial_deadline_at INTEGER NOT NULL CHECK (
    initial_deadline_at>published_at
  ),
  created_at INTEGER NOT NULL CHECK (created_at=published_at),
  UNIQUE (instruction_id, version_no),
  CHECK (
    estimated_self_pay_jpy + estimated_refundable_principal_jpy
      = reference_order_amount_jpy
  )
) STRICT;

CREATE TABLE order_instruction_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  instruction_id TEXT NOT NULL REFERENCES order_instructions(id),
  reservation_id TEXT NOT NULL REFERENCES product_reservations(id),
  instruction_version_id TEXT REFERENCES order_instruction_versions(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'INSTRUCTION_CREATED',
    'ASSET_PREPARATION_STARTED',
    'ASSET_PREPARATION_READY',
    'ASSET_PREPARATION_FAILED',
    'INSTRUCTION_PUBLISHED',
    'INSTRUCTION_REPUBLISHED',
    'EVIDENCE_CHANGES_REQUESTED',
    'EVIDENCE_RESUBMITTED',
    'INSTRUCTION_EXPIRED',
    'INSTRUCTION_CANCELLED',
    'INSTRUCTION_COMPLETED',
    'INSTRUCTION_RECONCILED'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'STAFF','BUYER_CUSTOMER','SYSTEM'
  )),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  previous_status TEXT CHECK (
    previous_status IS NULL OR previous_status IN (
      'UNPUBLISHED','ACTIVE','EXPIRED','CANCELLED','COMPLETED'
    )
  ),
  next_status TEXT NOT NULL CHECK (next_status IN (
    'UNPUBLISHED','ACTIVE','EXPIRED','CANCELLED','COMPLETED'
  )),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  metadata_json TEXT NOT NULL CHECK (
    json_valid(metadata_json) AND json_type(metadata_json)='object'
  ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE order_instruction_expiry_scan_cursors (
  marketplace_code TEXT PRIMARY KEY REFERENCES marketplaces(code),
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

CREATE TABLE order_instruction_reconciliation_markers (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  reservation_id TEXT NOT NULL UNIQUE REFERENCES product_reservations(id),
  instruction_id TEXT REFERENCES order_instructions(id),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'FORMAL_ORDER_EXISTS_SKIPPED',
    'HISTORICAL_EVIDENCE_CONTEXT',
    'UNPUBLISHED_CREATED',
    'INSUFFICIENT_PUBLISH_WINDOW'
  )),
  metadata_json TEXT NOT NULL CHECK (
    json_valid(metadata_json) AND json_type(metadata_json)='object'
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_order_instruction_events_instruction
ON order_instruction_events (instruction_id, created_at, id);

CREATE INDEX idx_order_instruction_events_reservation
ON order_instruction_events (reservation_id, created_at, id);

CREATE INDEX idx_order_instruction_reconciliation_markers_disposition
ON order_instruction_reconciliation_markers (disposition, created_at, id);

CREATE INDEX idx_order_instruction_versions_instruction
ON order_instruction_versions (instruction_id, version_no DESC, id);

CREATE INDEX idx_order_instruction_versions_product_version
ON order_instruction_versions (product_version_id, instruction_id, version_no);

CREATE INDEX idx_order_instructions_buyer_status
ON order_instructions (buyer_customer_id, status, updated_at, id);

CREATE INDEX idx_order_instructions_expiry
ON order_instructions (
  marketplace_code, status,
  initial_deadline_at, resubmission_deadline_at, id
);

CREATE TRIGGER trg_formal_order_financial_self_pay_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    JOIN order_evidence_versions evidence
      ON evidence.id=formal_order.order_evidence_version_id
    WHERE formal_order.id=NEW.formal_order_id
      AND NEW.buyer_self_pay_bps=evidence.buyer_self_pay_bps_snapshot
      AND NEW.buyer_self_pay_jpy=evidence.buyer_self_pay_jpy
      AND NEW.buyer_refundable_principal_jpy=
        evidence.buyer_refundable_principal_jpy
      AND NEW.buyer_gross_principal_cny_fen>=
        NEW.buyer_expected_principal_cny_fen
      AND NEW.buyer_self_pay_contribution_cny_fen=
        NEW.buyer_gross_principal_cny_fen-
        NEW.buyer_expected_principal_cny_fen
  )
  OR (
    NEW.buyer_self_pay_bps IS NULL
    AND NEW.buyer_self_pay_jpy IS NULL
    AND NEW.buyer_refundable_principal_jpy IS NULL
    AND NEW.buyer_gross_principal_cny_fen IS NULL
    AND NEW.buyer_self_pay_contribution_cny_fen IS NULL
    AND EXISTS (
      SELECT 1
      FROM formal_orders formal_order
      JOIN order_instruction_reconciliation_markers marker
        ON marker.reservation_id=formal_order.reservation_id
        AND marker.disposition='HISTORICAL_EVIDENCE_CONTEXT'
      WHERE formal_order.id=NEW.formal_order_id
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_self_pay_snapshot_mismatch');
END;

CREATE TRIGGER trg_formal_order_instruction_guard
BEFORE INSERT ON formal_orders
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM order_instructions instruction
    JOIN order_instruction_versions instruction_version
      ON instruction_version.id=NEW.order_instruction_version_id
      AND instruction_version.instruction_id=instruction.id
    JOIN order_evidence_versions evidence
      ON evidence.id=NEW.order_evidence_version_id
      AND evidence.order_instruction_id=instruction.id
      AND evidence.order_instruction_version_id=instruction_version.id
    WHERE instruction.id=NEW.order_instruction_id
      AND instruction.reservation_id=NEW.reservation_id
      AND instruction.status='ACTIVE'
      AND instruction.current_version_no=instruction_version.version_no
  )
  OR (
    NEW.order_instruction_id IS NULL
    AND NEW.order_instruction_version_id IS NULL
    AND EXISTS (
      SELECT 1 FROM order_instruction_reconciliation_markers marker
      WHERE marker.reservation_id=NEW.reservation_id
        AND marker.disposition='HISTORICAL_EVIDENCE_CONTEXT'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_instruction_mismatch');
END;

CREATE TRIGGER trg_order_evidence_instruction_snapshot_guard
BEFORE INSERT ON order_evidence_versions
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM order_instructions instruction
    JOIN order_instruction_versions instruction_version
      ON instruction_version.id=NEW.order_instruction_version_id
      AND instruction_version.instruction_id=instruction.id
      AND instruction_version.version_no=instruction.current_version_no
    WHERE instruction.id=NEW.order_instruction_id
      AND instruction.reservation_id=NEW.reservation_id
      AND instruction.buyer_customer_id=NEW.buyer_customer_id
      AND instruction.marketplace_code=NEW.marketplace_code
      AND instruction.status='ACTIVE'
      AND NEW.instruction_deadline_snapshot IS NOT NULL
      AND NEW.submitted_before_deadline=1
      AND NEW.created_at<NEW.instruction_deadline_snapshot
      AND NEW.reference_order_amount_jpy_snapshot=
        instruction_version.reference_order_amount_jpy
      AND NEW.buyer_self_pay_bps_snapshot=instruction_version.buyer_self_pay_bps
      AND NEW.buyer_self_pay_jpy IS NOT NULL
      AND NEW.buyer_refundable_principal_jpy IS NOT NULL
      AND NEW.buyer_self_pay_jpy+NEW.buyer_refundable_principal_jpy=
        NEW.final_paid_jpy
      AND NEW.price_difference_jpy=
        NEW.final_paid_jpy-NEW.reference_order_amount_jpy_snapshot
      AND NEW.price_mismatch=CASE
        WHEN NEW.price_difference_jpy=0 THEN 0 ELSE 1 END
      AND NEW.evidence_file_object_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM file_objects object
        JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
        WHERE object.id=NEW.evidence_file_object_id
          AND object.status='VERIFIED' AND intent.status='VERIFIED'
          AND object.purpose='ORDER_EVIDENCE'
          AND intent.purpose='ORDER_EVIDENCE'
          AND object.detected_mime IN ('image/jpeg','image/png','image/webp')
          AND intent.owner_actor_type='BUYER_CUSTOMER'
          AND intent.owner_actor_id=NEW.buyer_customer_id
      )
  )
  OR (
    NEW.order_instruction_id IS NULL
    AND NEW.order_instruction_version_id IS NULL
    AND NEW.instruction_deadline_snapshot IS NULL
    AND NEW.reference_order_amount_jpy_snapshot IS NULL
    AND NEW.buyer_self_pay_bps_snapshot IS NULL
    AND NEW.buyer_self_pay_jpy IS NULL
    AND NEW.buyer_refundable_principal_jpy IS NULL
    AND NEW.price_mismatch IS NULL
    AND NEW.price_difference_jpy IS NULL
    AND NEW.submitted_before_deadline IS NULL
    AND NEW.evidence_file_object_id IS NULL
    AND EXISTS (
      SELECT 1 FROM order_instruction_reconciliation_markers marker
      WHERE marker.reservation_id=NEW.reservation_id
        AND marker.disposition='HISTORICAL_EVIDENCE_CONTEXT'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_instruction_snapshot_mismatch');
END;

CREATE TRIGGER trg_order_instruction_events_no_delete
BEFORE DELETE ON order_instruction_events
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_events_are_immutable');
END;

CREATE TRIGGER trg_order_instruction_events_no_update
BEFORE UPDATE ON order_instruction_events
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_events_are_immutable');
END;

CREATE TRIGGER trg_order_instruction_historical_marker_guard
BEFORE INSERT ON order_instruction_reconciliation_markers
WHEN NEW.disposition='HISTORICAL_EVIDENCE_CONTEXT' AND NOT (
  EXISTS (
    SELECT 1 FROM order_evidence_versions evidence
    WHERE evidence.reservation_id=NEW.reservation_id
      AND evidence.order_instruction_id IS NULL
      AND evidence.order_instruction_version_id IS NULL
      AND evidence.instruction_deadline_snapshot IS NULL
      AND evidence.reference_order_amount_jpy_snapshot IS NULL
      AND evidence.buyer_self_pay_bps_snapshot IS NULL
      AND evidence.buyer_self_pay_jpy IS NULL
      AND evidence.buyer_refundable_principal_jpy IS NULL
      AND evidence.price_mismatch IS NULL
      AND evidence.price_difference_jpy IS NULL
      AND evidence.submitted_before_deadline IS NULL
      AND evidence.evidence_file_object_id IS NULL
  )
  OR (
    NEW.instruction_id IS NULL
    AND json_extract(NEW.metadata_json,'$.controlled_reconciliation')=1
    AND json_extract(NEW.metadata_json,'$.schema_version')=21
    AND EXISTS (
      SELECT 1
      FROM product_reservations reservation
      JOIN app_schema_state schema_state ON schema_state.singleton_id=1
      WHERE reservation.id=NEW.reservation_id
        AND reservation.status='APPROVED'
        AND reservation.submitted_at<schema_state.installed_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_instructions instruction
      WHERE instruction.reservation_id=NEW.reservation_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM order_evidence_versions evidence
      WHERE evidence.reservation_id=NEW.reservation_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM formal_orders formal_order
      WHERE formal_order.reservation_id=NEW.reservation_id
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'historical_evidence_marker_requires_existing_context');
END;

CREATE TRIGGER trg_order_instruction_identity_immutable
BEFORE UPDATE OF id, reservation_id, buyer_customer_id,
  marketplace_code, created_at
ON order_instructions
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_identity_immutable');
END;

CREATE TRIGGER trg_order_instruction_reconciliation_markers_no_delete
BEFORE DELETE ON order_instruction_reconciliation_markers
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_reconciliation_markers_are_immutable');
END;

CREATE TRIGGER trg_order_instruction_reconciliation_markers_no_update
BEFORE UPDATE ON order_instruction_reconciliation_markers
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_reconciliation_markers_are_immutable');
END;

CREATE TRIGGER trg_order_instruction_reservation_guard
BEFORE INSERT ON order_instructions
WHEN NOT EXISTS (
  SELECT 1 FROM product_reservations reservation
  WHERE reservation.id=NEW.reservation_id
    AND reservation.buyer_customer_id=NEW.buyer_customer_id
    AND reservation.marketplace_code=NEW.marketplace_code
    AND reservation.status='APPROVED'
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_reservation_not_approved');
END;

CREATE TRIGGER trg_order_instruction_transition_guard
BEFORE UPDATE ON order_instructions
WHEN NOT (
  NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND (
    (OLD.status='UNPUBLISHED' AND NEW.status IN ('ACTIVE','CANCELLED'))
    OR (OLD.status='ACTIVE' AND NEW.status IN (
      'ACTIVE','EXPIRED','CANCELLED','COMPLETED'
    ))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_invalid_transition');
END;

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

CREATE TRIGGER trg_order_instruction_version_source_guard
BEFORE INSERT ON order_instruction_versions
WHEN NOT EXISTS (
  SELECT 1
  FROM order_instructions instruction
  JOIN product_reservations reservation
    ON reservation.id=instruction.reservation_id
  JOIN product_versions version
    ON version.id=NEW.product_version_id
    AND version.product_id=reservation.product_id
    AND version.version_no=reservation.product_version_no
  WHERE instruction.id=NEW.instruction_id
    AND instruction.reservation_id=NEW.reservation_id
    AND reservation.id=NEW.reservation_id
    AND reservation.product_id=NEW.product_id
    AND reservation.product_version_no=NEW.product_version_no
    AND reservation.buyer_self_pay_bps_snapshot=NEW.buyer_self_pay_bps
    AND reservation.reference_order_amount_jpy_snapshot=
      NEW.reference_order_amount_jpy
    AND reservation.estimated_self_pay_jpy_snapshot=NEW.estimated_self_pay_jpy
    AND reservation.estimated_refundable_principal_jpy_snapshot=
      NEW.estimated_refundable_principal_jpy
    AND NEW.version_no=instruction.current_version_no+1
    AND (
      (instruction.current_version_no=0
        AND NEW.initial_deadline_at=NEW.published_at+21600000)
      OR
      (instruction.current_version_no>=1
        AND NEW.initial_deadline_at=instruction.initial_deadline_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_version_source_mismatch');
END;

CREATE TRIGGER trg_order_instruction_versions_no_delete
BEFORE DELETE ON order_instruction_versions
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_versions_are_immutable');
END;

CREATE TRIGGER trg_order_instruction_versions_no_update
BEFORE UPDATE ON order_instruction_versions
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_versions_are_immutable');
END;

CREATE TRIGGER trg_order_instructions_no_delete
BEFORE DELETE ON order_instructions
BEGIN
  SELECT RAISE(ABORT, 'order_instructions_are_immutable');
END;

UPDATE app_schema_state
SET
  schema_version=16,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
