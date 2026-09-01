-- Stage 4 (D-054) marketplace canonical unification, part 2: table triggers.
-- Split from the single generated 0020 solely to stay under the D1 local
-- migration file size limit; apply order 0020 → 0021 → 0022 is mandatory and
-- the three files form one logical change set (see part 1 header for the full
-- rationale).

-- ===== recreate triggers on rebuilt tables =====
CREATE TRIGGER trg_acquisition_channel_no_new_both
BEFORE INSERT ON acquisition_channels
WHEN NEW.lead_type='BOTH'
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_both_is_legacy_only');
END;
CREATE TRIGGER trg_acquisition_channel_origin_guard
BEFORE UPDATE ON acquisition_channels
WHEN NOT (
  OLD.status='ACTIVE' AND NEW.status='DISABLED'
  AND NEW.id IS OLD.id AND NEW.code IS OLD.code
  AND NEW.channel_type IS OLD.channel_type
  AND NEW.display_name IS OLD.display_name
  AND NEW.created_by_staff_id IS OLD.created_by_staff_id
  AND NEW.created_at IS OLD.created_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND NEW.disabled_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_channel_invalid_update');
END;
CREATE TRIGGER trg_acquisition_channel_privacy_profile_after_insert
AFTER INSERT ON acquisition_channels
BEGIN
  INSERT INTO acquisition_channel_privacy_profiles (
    channel_id,marketplace_code,lead_type,staff_label,intake_wechat_label,
    version,updated_by_staff_id,created_at,updated_at
  ) VALUES (
    NEW.id,
    NEW.marketplace_code,
    NEW.lead_type,
    '渠道' || (
      1 + (
        SELECT COUNT(*)
        FROM acquisition_channel_privacy_profiles profile
        WHERE profile.marketplace_code=NEW.marketplace_code
          AND profile.lead_type=NEW.lead_type
      )
    ),
    NULL,
    1,
    NEW.created_by_staff_id,
    NEW.created_at,
    NEW.updated_at
  );
END;
CREATE TRIGGER trg_acquisition_channels_no_delete
BEFORE DELETE ON acquisition_channels
BEGIN SELECT RAISE(ABORT,'acquisition_channels_are_immutable'); END;
CREATE TRIGGER trg_acquisition_intake_fact_after_lead
AFTER INSERT ON acquisition_leads
BEGIN
  INSERT INTO acquisition_customer_intake_facts(
    id,lead_id,lead_type,marketplace_code,original_channel_id,business_date,
    recorded_at,created_by_staff_id
  ) VALUES(
    'intake-' || lower(hex(randomblob(16))),NEW.id,NEW.lead_type,
    NEW.marketplace_code,NEW.origin_channel_id,NEW.created_business_date,
    NEW.created_at,NEW.origin_staff_id
  );
END;
CREATE TRIGGER trg_acquisition_lead_immutable_origin
BEFORE UPDATE ON acquisition_leads
WHEN NEW.id IS NOT OLD.id
  OR NEW.lead_type IS NOT OLD.lead_type
  OR NEW.origin_channel_id IS NOT OLD.origin_channel_id
  OR NEW.origin_staff_id IS NOT OLD.origin_staff_id
  OR NEW.created_business_date IS NOT OLD.created_business_date
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'acquisition_lead_immutable_origin');
END;
CREATE TRIGGER trg_acquisition_lead_prospect_guard
BEFORE UPDATE OF prospect_id ON acquisition_leads
WHEN NEW.prospect_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM acquisition_prospects prospect
  WHERE prospect.id=NEW.prospect_id
    AND prospect.lead_type=NEW.lead_type
    AND prospect.marketplace_code=NEW.marketplace_code
    AND prospect.origin_channel_id=NEW.origin_channel_id
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_lead_prospect_source_mismatch');
END;
CREATE TRIGGER trg_acquisition_lead_prospect_insert_guard
BEFORE INSERT ON acquisition_leads
WHEN NEW.prospect_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM acquisition_prospects prospect
  WHERE prospect.id=NEW.prospect_id
    AND prospect.lead_type=NEW.lead_type
    AND prospect.marketplace_code=NEW.marketplace_code
    AND prospect.origin_channel_id=NEW.origin_channel_id
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_lead_prospect_source_mismatch');
END;
CREATE TRIGGER trg_acquisition_lead_prospect_source_update_guard
BEFORE UPDATE OF prospect_id,lead_type,marketplace_code,origin_channel_id ON acquisition_leads
WHEN NEW.prospect_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM acquisition_prospects prospect
  WHERE prospect.id=NEW.prospect_id
    AND prospect.lead_type=NEW.lead_type
    AND prospect.marketplace_code=NEW.marketplace_code
    AND prospect.origin_channel_id=NEW.origin_channel_id
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_lead_prospect_source_mismatch');
END;
CREATE TRIGGER trg_acquisition_leads_no_delete
BEFORE DELETE ON acquisition_leads
BEGIN SELECT RAISE(ABORT,'acquisition_leads_are_immutable'); END;
CREATE TRIGGER trg_buyer_customer_marketplace_default
AFTER INSERT ON buyer_customers
BEGIN
  INSERT INTO buyer_marketplace_assignments (
    buyer_customer_id, marketplace_code, version, created_at, updated_at
  ) VALUES (NEW.id, 'AMAZON_JP', 1, NEW.created_at, NEW.updated_at);
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
CREATE TRIGGER trg_demand_batch_capacity_guard_insert
BEFORE INSERT ON demand_batches
WHEN
  NEW.held_reservation_count < 0
  OR NEW.approved_reservation_count < 0
  OR (
    NEW.held_reservation_count
    + NEW.approved_reservation_count
  ) > NEW.target_quantity
BEGIN
  SELECT RAISE(ABORT, 'demand_batch_capacity_exceeded');
END;
CREATE TRIGGER trg_demand_batch_capacity_guard_update
BEFORE UPDATE OF
  held_reservation_count,
  approved_reservation_count,
  target_quantity
ON demand_batches
WHEN
  NEW.held_reservation_count < 0
  OR NEW.approved_reservation_count < 0
  OR (
    NEW.held_reservation_count
    + NEW.approved_reservation_count
  ) > NEW.target_quantity
BEGIN
  SELECT RAISE(ABORT, 'demand_batch_capacity_exceeded');
END;
CREATE TRIGGER trg_demand_buyer_self_pay_publish_guard_insert
BEFORE INSERT ON demand_batches
WHEN NEW.status='PUBLISHED'
  AND NOT (
    (NEW.buyer_self_pay_bps_snapshot IS NULL
      AND NEW.buyer_self_pay_source IS NULL
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.buyer_self_pay_source IN ('PRODUCT_DEFAULT', 'STAFF_OVERRIDE')
  AND (
    (NEW.buyer_self_pay_source='PRODUCT_DEFAULT'
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR
    (NEW.buyer_self_pay_source='STAFF_OVERRIDE'
      AND NEW.buyer_self_pay_override_reason IS NOT NULL
      AND length(NEW.buyer_self_pay_override_reason) BETWEEN 1 AND 1000)
  )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'demand_buyer_self_pay_snapshot_required');
END;
CREATE TRIGGER trg_demand_buyer_self_pay_publish_guard_update
BEFORE UPDATE OF status, buyer_self_pay_bps_snapshot,
  buyer_self_pay_source, buyer_self_pay_override_reason
ON demand_batches
WHEN NEW.status='PUBLISHED' AND NOT (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.buyer_self_pay_source IN ('PRODUCT_DEFAULT', 'STAFF_OVERRIDE')
  AND (
    (NEW.buyer_self_pay_source='PRODUCT_DEFAULT'
      AND NEW.buyer_self_pay_override_reason IS NULL)
    OR
    (NEW.buyer_self_pay_source='STAFF_OVERRIDE'
      AND NEW.buyer_self_pay_override_reason IS NOT NULL
      AND length(NEW.buyer_self_pay_override_reason) BETWEEN 1 AND 1000)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'demand_buyer_self_pay_snapshot_required');
END;
CREATE TRIGGER trg_demand_buyer_self_pay_published_immutable
BEFORE UPDATE OF buyer_self_pay_bps_snapshot,
  buyer_self_pay_source, buyer_self_pay_override_reason
ON demand_batches
WHEN OLD.status='PUBLISHED' AND (
  NOT (NEW.buyer_self_pay_bps_snapshot IS OLD.buyer_self_pay_bps_snapshot)
  OR NOT (NEW.buyer_self_pay_source IS OLD.buyer_self_pay_source)
  OR NOT (NEW.buyer_self_pay_override_reason IS OLD.buyer_self_pay_override_reason)
)
BEGIN
  SELECT RAISE(ABORT, 'published_demand_buyer_self_pay_is_immutable');
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
CREATE TRIGGER trg_formal_order_non_jp_local_date_required
BEFORE INSERT ON formal_orders
WHEN COALESCE(NEW.marketplace_code,'AMAZON_JP')<>'AMAZON_JP'
  AND NEW.marketplace_business_date IS NULL
BEGIN
  SELECT RAISE(ABORT,'formal_order_marketplace_business_date_required');
END;
CREATE TRIGGER trg_formal_order_number_claim_source_guard
BEFORE INSERT ON formal_order_number_claims
WHEN NOT EXISTS (
  SELECT 1 FROM order_evidence_versions evidence
  WHERE evidence.id=NEW.current_evidence_version_id
    AND evidence.submission_id=NEW.evidence_submission_id
    AND evidence.marketplace_code=NEW.marketplace_code
    AND evidence.amazon_order_number_normalized=
      NEW.amazon_order_number_normalized
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claim_source_mismatch');
END;
CREATE TRIGGER trg_formal_order_number_claim_transition_guard
BEFORE UPDATE ON formal_order_number_claims
WHEN NOT (
  NEW.id=OLD.id
  AND NEW.marketplace_code=OLD.marketplace_code
  AND NEW.amazon_order_number_normalized=OLD.amazon_order_number_normalized
  AND NEW.evidence_submission_id=OLD.evidence_submission_id
  AND NEW.claimed_at=OLD.claimed_at
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND OLD.status='PROVISIONAL'
  AND (
    (NEW.status='PROVISIONAL'
      AND NEW.formal_order_id IS NULL
      AND NEW.finalized_at IS NULL AND NEW.released_at IS NULL)
    OR (NEW.status='FINAL'
      AND NEW.formal_order_id IS NOT NULL
      AND NEW.finalized_at IS NOT NULL AND NEW.released_at IS NULL)
    OR (NEW.status='RELEASED'
      AND NEW.formal_order_id IS NULL
      AND NEW.finalized_at IS NULL AND NEW.released_at IS NOT NULL)
  )
  AND EXISTS (
    SELECT 1 FROM order_evidence_versions evidence
    WHERE evidence.id=NEW.current_evidence_version_id
      AND evidence.submission_id=NEW.evidence_submission_id
      AND evidence.marketplace_code=NEW.marketplace_code
      AND evidence.amazon_order_number_normalized=
        NEW.amazon_order_number_normalized
  )
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claim_invalid_transition');
END;
CREATE TRIGGER trg_formal_order_number_claims_no_delete
BEFORE DELETE ON formal_order_number_claims
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_claims_are_immutable');
END;
CREATE TRIGGER trg_formal_order_number_conflicts_no_delete
BEFORE DELETE ON formal_order_number_conflicts
BEGIN
  SELECT RAISE(ABORT, 'formal_order_number_conflicts_are_immutable');
END;
CREATE TRIGGER trg_formal_order_source_guard
BEFORE INSERT ON formal_orders
WHEN
  NEW.amazon_order_date IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.id=NEW.order_evidence_version_id
      AND evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    WHERE submission.id=NEW.order_evidence_submission_id
      AND submission.reservation_id=NEW.reservation_id
      AND submission.buyer_customer_id=NEW.buyer_customer_id
      AND submission.marketplace_code=NEW.marketplace_code
      AND submission.status='VERIFIED'
      AND evidence.reservation_id=NEW.reservation_id
      AND evidence.buyer_customer_id=NEW.buyer_customer_id
      AND evidence.marketplace_code=NEW.marketplace_code
      AND evidence.amazon_order_number_raw=NEW.amazon_order_number_raw
      AND evidence.amazon_order_number_normalized=
        NEW.amazon_order_number_normalized
      AND evidence.final_paid_jpy=NEW.final_paid_jpy
      AND evidence.amazon_order_date=NEW.amazon_order_date
  )
  OR NOT EXISTS (
    SELECT 1
    FROM product_reservations reservation
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    WHERE reservation.id=NEW.reservation_id
      AND reservation.status='APPROVED'
      AND reservation.demand_batch_id=NEW.demand_batch_id
      AND reservation.buyer_customer_id=NEW.buyer_customer_id
      AND reservation.organization_id=NEW.seller_organization_id
      AND reservation.store_id=NEW.store_id
      AND reservation.product_id=NEW.product_id
      AND reservation.product_version_no=NEW.product_version_no
      AND reservation.marketplace_code=NEW.marketplace_code
      AND demand.organization_id=NEW.seller_organization_id
      AND demand.store_id=NEW.store_id
      AND demand.product_id=NEW.product_id
      AND demand.product_version_no=NEW.product_version_no
      AND demand.marketplace_code=NEW.marketplace_code
      AND demand.task_type=NEW.review_type
  )
  OR NOT EXISTS (
    SELECT 1
    FROM products product
    JOIN product_versions product_version
      ON product_version.id=NEW.product_version_id
      AND product_version.product_id=product.id
      AND product_version.version_no=NEW.product_version_no
    WHERE product.id=NEW.product_id
      AND product.organization_id=NEW.seller_organization_id
      AND product.store_id=NEW.store_id
      AND product.marketplace_code=NEW.marketplace_code
      AND product.asin_display=NEW.asin_display
      AND product.asin_normalized=NEW.asin_normalized
      AND product_version.product_name=NEW.product_name_snapshot
  )
  OR NOT EXISTS (
    SELECT 1
    FROM buyer_customers buyer
    WHERE buyer.id=NEW.buyer_customer_id
      AND buyer.marketplace_code=NEW.marketplace_code
      AND buyer.buyer_customer_no=NEW.buyer_customer_no
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_source_mismatch');
END;
CREATE TRIGGER trg_formal_orders_no_delete
BEFORE DELETE ON formal_orders
BEGIN
  SELECT RAISE(ABORT, 'formal_orders_are_immutable');
END;
CREATE TRIGGER trg_formal_orders_no_update
BEFORE UPDATE ON formal_orders
BEGIN
  SELECT RAISE(ABORT, 'formal_orders_are_immutable');
END;
CREATE TRIGGER trg_marketplace_runtime_config_no_delete
BEFORE DELETE ON marketplace_runtime_config
BEGIN SELECT RAISE(ABORT,'marketplace_runtime_config_requires_versioned_migration'); END;
CREATE TRIGGER trg_marketplace_runtime_config_no_update
BEFORE UPDATE ON marketplace_runtime_config
BEGIN SELECT RAISE(ABORT,'marketplace_runtime_config_requires_versioned_migration'); END;
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
CREATE TRIGGER trg_order_evidence_duplicate_signals_no_delete
BEFORE DELETE ON order_evidence_duplicate_signals
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_duplicate_signals_are_immutable');
END;
CREATE TRIGGER trg_order_evidence_duplicate_signals_no_update
BEFORE UPDATE ON order_evidence_duplicate_signals
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_duplicate_signals_are_immutable');
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
CREATE TRIGGER trg_order_evidence_marketplace_money_legacy_insert
AFTER INSERT ON order_evidence_versions
BEGIN
  INSERT INTO order_evidence_marketplace_money (
    order_evidence_version_id, marketplace_code,
    platform_order_identifier, platform_product_identifier,
    platform_order_date, payment_amount_minor,
    payment_currency_code, payment_currency_exponent, created_at
  ) VALUES (
    NEW.id, 'AMAZON_JP', NEW.amazon_order_number_normalized, NULL,
    NEW.amazon_order_date, NEW.final_paid_jpy, 'JPY', 0, NEW.created_at
  );
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
CREATE TRIGGER trg_order_evidence_version_submission_guard
BEFORE INSERT ON order_evidence_versions
WHEN NEW.amazon_order_date IS NULL OR NOT EXISTS (
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
CREATE TRIGGER trg_order_evidence_versions_no_delete
BEFORE DELETE ON order_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_versions_are_immutable');
END;
CREATE TRIGGER trg_order_evidence_versions_no_update
BEFORE UPDATE ON order_evidence_versions
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_versions_are_immutable');
END;
CREATE TRIGGER trg_order_instruction_identity_immutable
BEFORE UPDATE OF id, reservation_id, buyer_customer_id,
  marketplace_code, created_at
ON order_instructions
BEGIN
  SELECT RAISE(ABORT, 'order_instruction_identity_immutable');
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
CREATE TRIGGER trg_order_instructions_no_delete
BEFORE DELETE ON order_instructions
BEGIN
  SELECT RAISE(ABORT, 'order_instructions_are_immutable');
END;
CREATE TRIGGER trg_reservation_self_pay_snapshot_immutable
BEFORE UPDATE OF buyer_self_pay_bps_snapshot,
  reference_order_amount_jpy_snapshot,
  estimated_self_pay_jpy_snapshot,
  estimated_refundable_principal_jpy_snapshot,
  buyer_self_pay_accepted_at,
  buyer_self_pay_accepted_demand_version
ON product_reservations
BEGIN
  SELECT RAISE(ABORT, 'reservation_buyer_self_pay_snapshot_immutable');
END;
CREATE TRIGGER trg_reservation_self_pay_snapshot_insert_guard
BEFORE INSERT ON product_reservations
WHEN NOT (
  (
    NEW.buyer_self_pay_bps_snapshot IS NULL
    AND NEW.reference_order_amount_jpy_snapshot IS NULL
    AND NEW.estimated_self_pay_jpy_snapshot IS NULL
    AND NEW.estimated_refundable_principal_jpy_snapshot IS NULL
    AND NEW.buyer_self_pay_accepted_at IS NULL
    AND NEW.buyer_self_pay_accepted_demand_version IS NULL
  )
  OR (
  NEW.buyer_self_pay_bps_snapshot BETWEEN 0 AND 10000
  AND NEW.reference_order_amount_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_self_pay_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_refundable_principal_jpy_snapshot BETWEEN 0 AND 9007199254740991
  AND NEW.estimated_self_pay_jpy_snapshot
      + NEW.estimated_refundable_principal_jpy_snapshot
      = NEW.reference_order_amount_jpy_snapshot
  AND NEW.buyer_self_pay_accepted_at IS NOT NULL
  AND NEW.buyer_self_pay_accepted_demand_version >= 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'reservation_buyer_self_pay_snapshot_required');
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
    NEW.marketplace_code,
    NEW.id,NEW.created_at
  );
END;
CREATE TRIGGER trg_seller_store_marketplace_default
AFTER INSERT ON seller_stores
BEGIN
  INSERT INTO seller_store_marketplaces (
    store_id, seller_organization_id, marketplace_code, created_at
  ) VALUES (NEW.id, NEW.organization_id, 'AMAZON_JP', NEW.created_at);
END;
CREATE TRIGGER trg_staff_assignment_fallbacks_insert_guard
BEFORE INSERT ON staff_assignment_fallbacks
WHEN NOT EXISTS (
  SELECT 1 FROM staff_users staff
  WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
    AND EXISTS (SELECT 1 FROM staff_role_assignments role
      WHERE role.staff_id=staff.id AND role.role_code='owner'
        AND role.status='ACTIVE')
    AND 17=(SELECT COUNT(DISTINCT permission.permission_code)
      FROM staff_effective_assignment_permissions permission
      WHERE permission.staff_id=staff.id AND permission.permission_code IN (
        'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
        'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
        'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
        'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
        'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
        'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
        'ORDER_VIEW','ORDER_CONFIRM','REVIEW_VIEW','REVIEW_DECIDE',
        'BUYER_REFUND_VIEW','BUYER_REFUND_RECORD'))
)
BEGIN SELECT RAISE(ABORT,'staff_assignment_fallback_invalid'); END;
CREATE TRIGGER trg_staff_assignment_fallbacks_update_guard
BEFORE UPDATE ON staff_assignment_fallbacks
WHEN NOT (
  NEW.marketplace_code IS OLD.marketplace_code
  AND NEW.version=OLD.version+1
  AND NEW.updated_at>=OLD.updated_at
  AND EXISTS (
    SELECT 1 FROM staff_users staff
    WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
      AND EXISTS (SELECT 1 FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.role_code='owner'
          AND role.status='ACTIVE')
      AND 17=(SELECT COUNT(DISTINCT permission.permission_code)
        FROM staff_effective_assignment_permissions permission
        WHERE permission.staff_id=staff.id AND permission.permission_code IN (
          'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
          'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
          'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
          'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
          'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
          'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
          'ORDER_VIEW','ORDER_CONFIRM','REVIEW_VIEW','REVIEW_DECIDE',
          'BUYER_REFUND_VIEW','BUYER_REFUND_RECORD'))
  )
)
BEGIN SELECT RAISE(ABORT,'staff_assignment_fallback_invalid'); END;
CREATE TRIGGER trg_staff_work_item_marketplace_after_insert
AFTER INSERT ON staff_work_items
BEGIN
  UPDATE staff_work_items
  SET marketplace_code = COALESCE(
    (
      SELECT mapping.marketplace_code
      FROM seller_store_marketplaces mapping
      WHERE mapping.store_id=NEW.store_id
      ORDER BY mapping.marketplace_code
      LIMIT 1
    ),
    (
      SELECT assignment.marketplace_code
      FROM buyer_marketplace_assignments assignment
      WHERE assignment.buyer_customer_id=NEW.buyer_customer_id
      ORDER BY assignment.marketplace_code
      LIMIT 1
    ),
    NEW.marketplace_code
  )
  WHERE id=NEW.id;
END;
CREATE TRIGGER trg_staff_work_items_assignment_guard
BEFORE INSERT ON staff_work_items
WHEN NOT (
  (NEW.fixed_assignment_type='BUYER' AND EXISTS (
    SELECT 1 FROM buyer_staff_assignments assignment
    WHERE assignment.id=NEW.fixed_assignment_id
      AND assignment.buyer_customer_id=NEW.buyer_customer_id
      AND assignment.duty_code=NEW.duty_code
      AND assignment.staff_id=NEW.assigned_staff_id
      AND assignment.status='ACTIVE'
  ))
  OR
  (NEW.fixed_assignment_type='SELLER' AND EXISTS (
    SELECT 1 FROM seller_staff_assignments assignment
    WHERE assignment.id=NEW.fixed_assignment_id
      AND assignment.seller_organization_id=NEW.seller_organization_id
      AND assignment.duty_code=NEW.duty_code
      AND assignment.staff_id=NEW.assigned_staff_id
      AND assignment.status='ACTIVE'
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'staff_work_item_assignment_mismatch');
END;
CREATE TRIGGER trg_staff_work_items_no_delete
BEFORE DELETE ON staff_work_items
BEGIN
  SELECT RAISE(ABORT, 'staff_work_items_are_immutable');
END;
CREATE TRIGGER trg_staff_work_items_update_guard
BEFORE UPDATE ON staff_work_items
WHEN NOT (
  (
    OLD.status='OPEN'
    AND NEW.status IN ('OPEN','COMPLETED','CANCELLED')
    AND NEW.version=OLD.version+1
    AND NEW.updated_at>=OLD.updated_at
    AND NEW.id IS OLD.id
    AND NEW.work_type IS OLD.work_type
    AND NEW.source_entity_type IS OLD.source_entity_type
    AND NEW.source_entity_id IS OLD.source_entity_id
    AND NEW.buyer_customer_id IS OLD.buyer_customer_id
    AND NEW.seller_organization_id IS OLD.seller_organization_id
    AND NEW.store_id IS OLD.store_id
    AND NEW.duty_code IS OLD.duty_code
    AND NEW.fixed_assignment_type IS OLD.fixed_assignment_type
    AND NEW.marketplace_code IS OLD.marketplace_code
    AND NEW.created_at IS OLD.created_at
  )
  OR
  (
    NEW.id IS OLD.id
    AND NEW.work_type IS OLD.work_type
    AND NEW.source_entity_type IS OLD.source_entity_type
    AND NEW.source_entity_id IS OLD.source_entity_id
    AND NEW.buyer_customer_id IS OLD.buyer_customer_id
    AND NEW.seller_organization_id IS OLD.seller_organization_id
    AND NEW.store_id IS OLD.store_id
    AND NEW.duty_code IS OLD.duty_code
    AND NEW.fixed_assignment_type IS OLD.fixed_assignment_type
    AND NEW.fixed_assignment_id IS OLD.fixed_assignment_id
    AND NEW.assigned_staff_id IS OLD.assigned_staff_id
    AND NEW.status IS OLD.status
    AND NEW.version=OLD.version
    AND NEW.created_at IS OLD.created_at
    AND NEW.updated_at IS OLD.updated_at
    AND NEW.completed_at IS OLD.completed_at
    AND NEW.cancelled_at IS OLD.cancelled_at
    AND NEW.marketplace_code IS COALESCE(
      (
        SELECT mapping.marketplace_code
        FROM seller_store_marketplaces mapping
        WHERE mapping.store_id=NEW.store_id
        ORDER BY mapping.marketplace_code
        LIMIT 1
      ),
      (
        SELECT assignment.marketplace_code
        FROM buyer_marketplace_assignments assignment
        WHERE assignment.buyer_customer_id=NEW.buyer_customer_id
        ORDER BY assignment.marketplace_code
        LIMIT 1
      ),
      OLD.marketplace_code
    )
  )
)
BEGIN
  SELECT RAISE(ABORT,'staff_work_item_invalid_transition');
END;


UPDATE app_schema_state
SET
  schema_version=21,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
