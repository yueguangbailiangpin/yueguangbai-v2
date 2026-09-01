-- Stage 4 (D-054) marketplace canonical unification, part 3: external triggers and views.
-- Split from the single generated 0020 solely to stay under the D1 local
-- migration file size limit; apply order 0020 → 0021 → 0022 is mandatory and
-- the three files form one logical change set (see part 1 header for the full
-- rationale).

-- ===== recreate external triggers/views (one gets a stage-4 rewrite) =====
CREATE TRIGGER trg_acquisition_assignment_insert_guard
BEFORE INSERT ON acquisition_staff_channel_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM acquisition_channels channel
  WHERE channel.id=NEW.channel_id AND channel.status='ACTIVE'
) OR NOT EXISTS (
  SELECT 1 FROM staff_users staff
  JOIN staff_role_assignments role ON role.staff_id=staff.id
  WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
    AND role.status='ACTIVE'
    AND (
      role.role_code='owner'
      OR (NEW.lead_type='BUYER' AND role.role_code='pre_sales')
      OR (NEW.lead_type='SELLER' AND role.role_code='seller_ops')
    )
) OR EXISTS (
  SELECT 1 FROM acquisition_staff_channel_assignments existing
  WHERE existing.staff_id=NEW.staff_id
    AND existing.lead_type=NEW.lead_type
    AND existing.status='ACTIVE'
    AND NEW.effective_from<COALESCE(existing.effective_until,9223372036854775807)
    AND existing.effective_from<COALESCE(NEW.effective_until,9223372036854775807)
)
OR EXISTS (
  SELECT 1 FROM acquisition_staff_channel_assignments existing
  WHERE existing.channel_id=NEW.channel_id
    AND existing.lead_type<>NEW.lead_type
    AND existing.status='ACTIVE'
    AND NEW.effective_from<COALESCE(existing.effective_until,9223372036854775807)
    AND existing.effective_from<COALESCE(NEW.effective_until,9223372036854775807)
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_assignment_invalid_or_overlapping');
END;
CREATE TRIGGER trg_acquisition_lead_link_first_touch_attribution
AFTER INSERT ON acquisition_lead_links
WHEN NEW.link_type IN ('BUYER_CUSTOMER','SELLER_ORGANIZATION')
BEGIN
  INSERT OR IGNORE INTO acquisition_customer_attributions(
    id,subject_type,subject_id,marketplace_code,lead_id,origin_channel_id,
    origin_mode,attributed_at,created_at
  )
  SELECT 'm46-attribution-' || lower(hex(randomblob(16))),
    CASE NEW.link_type
      WHEN 'BUYER_CUSTOMER' THEN 'BUYER_CUSTOMER'
      ELSE 'SELLER_ORGANIZATION'
    END,
    NEW.target_id,
    lead.marketplace_code,
    lead.id,
    lead.origin_channel_id,
    lead.origin_mode,
    NEW.linked_at,
    CAST(unixepoch('now') AS INTEGER)*1000
  FROM acquisition_leads lead
  WHERE lead.id=NEW.lead_id;
END;
CREATE TRIGGER trg_acquisition_source_correction_guard
BEFORE INSERT ON acquisition_lead_source_corrections
WHEN NOT EXISTS(
  SELECT 1
  FROM acquisition_leads lead
  JOIN acquisition_channels channel ON channel.id=NEW.new_channel_id
  WHERE lead.id=NEW.lead_id
    AND channel.marketplace_code=lead.marketplace_code
    AND (channel.lead_type=lead.lead_type OR channel.lead_type='BOTH')
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_source_correction_channel_mismatch');
END;
CREATE TRIGGER trg_buyer_invitation_consumed_link_acquisition_lead
AFTER UPDATE OF status ON customer_buyer_invitations
WHEN NEW.status='CONSUMED' AND OLD.status='ACTIVE'
BEGIN
  INSERT OR IGNORE INTO acquisition_lead_links(
    id,lead_id,link_type,target_id,linked_at
  )
  SELECT 'm50-buyer-link-' || lower(hex(randomblob(16))),
    mapping.acquisition_lead_id,
    'BUYER_CUSTOMER',
    buyer.id,
    COALESCE(NEW.consumed_at,CAST(unixepoch('now') AS INTEGER)*1000)
  FROM customer_buyer_invitation_lead_links mapping
  JOIN customer_login_accounts account ON account.id=NEW.consumed_by_account_id
  JOIN buyer_customers buyer ON buyer.identity_subject_id=account.identity_subject_id
  JOIN acquisition_leads lead ON lead.id=mapping.acquisition_lead_id
  WHERE mapping.invitation_id=NEW.id
    AND lead.lead_type='BUYER'
    AND lead.status='ACTIVE';
END;
CREATE TRIGGER trg_buyer_marketplace_assignment_fact_guard
BEFORE UPDATE OF marketplace_code ON buyer_marketplace_assignments
WHEN NEW.marketplace_code<>OLD.marketplace_code AND (
  EXISTS (SELECT 1 FROM product_reservations WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM order_evidence_submissions WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM formal_orders WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (SELECT 1 FROM review_cases WHERE buyer_customer_id=OLD.buyer_customer_id)
  OR EXISTS (
    SELECT 1 FROM formal_order_marketplace_money_snapshots
    WHERE buyer_customer_id=OLD.buyer_customer_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_marketplace_has_formal_facts');
END;
CREATE TRIGGER trg_buyer_refund_obligation_source_guard
BEFORE INSERT ON buyer_refund_obligations
WHEN NOT EXISTS (
  SELECT 1
  FROM review_events source_event
  JOIN review_cases review_case
    ON review_case.id=source_event.review_case_id
    AND review_case.formal_order_id=source_event.formal_order_id
  JOIN formal_orders formal_order
    ON formal_order.id=source_event.formal_order_id
    AND formal_order.buyer_customer_id=review_case.buyer_customer_id
  WHERE source_event.id=NEW.source_review_event_id
    AND source_event.event_type='BUYER_REFUND_BECAME_DUE'
    AND source_event.next_status='APPROVED'
    AND source_event.amount_cny_fen=NEW.due_amount_cny_fen
    AND source_event.review_case_id=NEW.review_case_id
    AND source_event.formal_order_id=NEW.formal_order_id
    AND review_case.status='APPROVED'
    AND review_case.buyer_customer_id=NEW.buyer_customer_id
    AND NEW.version=1
    AND NEW.created_at=NEW.updated_at
)
BEGIN
  SELECT RAISE(ABORT, 'buyer_refund_obligation_source_mismatch');
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
CREATE TRIGGER trg_demand_order_schedule_insert_guard
BEFORE INSERT ON demand_order_schedule_versions
WHEN NOT EXISTS (
  SELECT 1
  FROM demand_batches demand
  JOIN product_versions version
    ON version.product_id=demand.product_id
    AND version.version_no=demand.product_version_no
  JOIN staff_users staff ON staff.id=NEW.changed_by_staff_id
  WHERE demand.id=NEW.demand_batch_id
    AND demand.status='PUBLISHED'
    AND demand.version=NEW.demand_version
    AND version.id=NEW.source_product_version_id
    AND staff.status='ACTIVE'
    AND NEW.version_no=COALESCE((
      SELECT MAX(existing.version_no)+1
      FROM demand_order_schedule_versions existing
      WHERE existing.demand_batch_id=NEW.demand_batch_id
    ),1)
    AND NEW.theoretical_last_order_date=date(
      NEW.first_order_date,
      printf(
        '+%d days',
        ((demand.target_quantity-1)/NEW.orders_per_run)
          * NEW.order_interval_days
      )
    )
    AND NEW.theoretical_last_order_date<=date(
      demand.order_deadline/1000,
      'unixepoch',
      '+8 hours'
    )
    AND NEW.affected_reservation_count<=(
      SELECT COUNT(*)
      FROM product_reservations reservation
      WHERE reservation.demand_batch_id=demand.id
        AND reservation.status IN ('PENDING_REVIEW','APPROVED')
    )
    AND (
      (
        NEW.version_no=1
        AND (
          (
            version.order_interval_days IS NULL
            AND version.orders_per_run IS NULL
          )
          OR (
            NEW.order_interval_days=version.order_interval_days
            AND NEW.orders_per_run=version.orders_per_run
          )
        )
      )
      OR
      (
        NEW.version_no>1
        AND EXISTS (
          SELECT 1
          FROM demand_order_schedule_versions previous
          WHERE previous.demand_batch_id=NEW.demand_batch_id
            AND previous.version_no=NEW.version_no-1
            AND previous.source_product_version_id
              =NEW.source_product_version_id
            AND previous.first_order_date=NEW.previous_first_order_date
            AND previous.theoretical_last_order_date
              =NEW.previous_theoretical_last_order_date
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT,'demand_order_schedule_source_invalid');
END;
CREATE TRIGGER trg_formal_order_event_identity_guard
BEFORE INSERT ON formal_order_events
WHEN NOT EXISTS (
  SELECT 1
  FROM formal_orders formal_order
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.order_evidence_submission_id=
      NEW.order_evidence_submission_id
    AND formal_order.reservation_id=NEW.reservation_id
    AND NEW.previous_status IS NULL
    AND NEW.next_status=formal_order.status
    AND NEW.order_version=formal_order.version
)
BEGIN
  SELECT RAISE(ABORT, 'formal_order_event_identity_mismatch');
END;
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
CREATE TRIGGER trg_formal_order_financial_snapshot_guard
BEFORE INSERT ON formal_order_financial_snapshots
WHEN
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND NEW.buyer_rate_business_date<=formal_order.amazon_order_date
      AND formal_order.confirmed_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_daily_exchange_rates rate
    WHERE rate.id=NEW.buyer_rate_version_id
      AND rate.business_date=NEW.buyer_rate_business_date
      AND rate.version_no=NEW.buyer_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.cny_per_jpy_e8=NEW.buyer_cny_per_jpy_e8
      AND rate.confirmed_at=NEW.buyer_rate_confirmed_at
      AND rate.confirmed_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    JOIN seller_service_fee_versions fee
      ON fee.organization_id=formal_order.seller_organization_id
      AND fee.review_type=formal_order.review_type
    WHERE formal_order.id=NEW.formal_order_id
      AND fee.id=NEW.service_fee_version_id
      AND fee.version_no=NEW.service_fee_version_no
      AND fee.status='CONFIRMED'
      AND fee.fee_cny_fen=NEW.service_fee_cny_fen
      AND fee.effective_from=NEW.service_fee_effective_from
      AND fee.confirmed_at=NEW.service_fee_confirmed_at
      AND fee.effective_from<=NEW.created_at
      AND fee.confirmed_at<=NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_financial_snapshot_source_mismatch');
END;
CREATE TRIGGER trg_formal_order_marketplace_money_source_guard
BEFORE INSERT ON formal_order_marketplace_money_snapshots
WHEN
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.buyer_customer_id=NEW.buyer_customer_id
      AND formal_order.seller_organization_id=NEW.seller_organization_id
      AND formal_order.store_id=NEW.store_id
      AND formal_order.review_type=NEW.review_type
      AND formal_order.amazon_order_number_normalized=NEW.platform_order_identifier
      AND formal_order.asin_normalized=NEW.platform_product_identifier
      AND formal_order.amazon_order_date=NEW.platform_order_date
      AND formal_order.final_paid_jpy=NEW.payment_amount_minor
      AND formal_order.confirmed_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_marketplace_assignments buyer
    WHERE buyer.buyer_customer_id=NEW.buyer_customer_id
      AND buyer.marketplace_code=NEW.marketplace_code
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_store_marketplaces store
    WHERE store.store_id=NEW.store_id
      AND store.seller_organization_id=NEW.seller_organization_id
      AND store.marketplace_code=NEW.marketplace_code
  )
  OR NOT EXISTS (
    SELECT 1 FROM marketplace_registry marketplace
    JOIN currencies currency ON currency.code=marketplace.transaction_currency_code
    WHERE marketplace.code=NEW.marketplace_code
      AND marketplace.status='ACTIVE'
      AND marketplace.adapter_status='AVAILABLE'
      AND marketplace.transaction_currency_code=NEW.payment_currency_code
      AND currency.exponent=NEW.payment_currency_exponent
  )
  OR NOT EXISTS (
    SELECT 1 FROM buyer_daily_currency_rate_versions rate
    WHERE rate.id=NEW.buyer_rate_version_id
      AND rate.business_date<=NEW.platform_order_date
      AND rate.version_no=NEW.buyer_rate_version_no
      AND rate.status='CONFIRMED'
      AND rate.source_currency_code=NEW.source_currency_code
      AND rate.quote_currency_code=NEW.quote_currency_code
      AND rate.rate_value=NEW.buyer_rate_value
      AND rate.rate_scale=NEW.buyer_rate_scale
      AND rate.rounding_rule=NEW.rounding_rule
      AND rate.confirmed_at=NEW.buyer_rate_confirmed_at
      AND rate.confirmed_at<=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_principal_rate_snapshots principal
    WHERE principal.formal_order_id=NEW.formal_order_id
      AND principal.platform_order_date=NEW.platform_order_date
      AND principal.payment_amount_minor=NEW.payment_amount_minor
      AND principal.payment_currency_code=NEW.payment_currency_code
      AND principal.rounding_rule=NEW.rounding_rule
      AND principal.seller_expected_principal_amount_minor=NEW.seller_expected_principal_amount_minor
      AND principal.created_at=NEW.created_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM seller_service_fee_rule_versions fee
    WHERE fee.id=NEW.service_fee_rule_version_id
      AND fee.seller_organization_id=NEW.seller_organization_id
      AND fee.marketplace_code=NEW.marketplace_code
      AND fee.review_type=NEW.review_type
      AND fee.version_no=NEW.service_fee_rule_version_no
      AND fee.status='CONFIRMED'
      AND fee.fee_amount_minor=NEW.service_fee_amount_minor
      AND fee.fee_currency_code=NEW.service_fee_currency_code
      AND fee.effective_from=NEW.service_fee_effective_from
      AND fee.confirmed_at=NEW.service_fee_confirmed_at
      AND fee.effective_from<=NEW.created_at
      AND fee.confirmed_at<=NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'formal_order_marketplace_money_source_mismatch');
END;
CREATE TRIGGER trg_order_archive_closure_insert_guard
BEFORE INSERT ON order_archive_closures
WHEN NEW.status<>'CLOSED' OR NEW.version<>1 OR NEW.created_at<>NEW.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.confirmed_at<=NEW.business_closed_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.closed_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  )
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED'
      AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id
          AND entry.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund
    WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;
CREATE TRIGGER trg_order_archive_closure_reclose_source_guard
BEFORE UPDATE ON order_archive_closures
WHEN OLD.status='REOPENED' AND NEW.status='CLOSED' AND (
  NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.confirmed_at<=NEW.business_closed_at
  )
  OR NOT EXISTS (
    SELECT 1 FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=NEW.closed_by_staff_id AND staff.status='ACTIVE'
      AND role.role_code='owner' AND role.status='ACTIVE'
  )
  OR (NEW.review_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
      AND review.status='APPROVED'
      AND review.decided_at<=NEW.business_closed_at
  ))
  OR (NEW.review_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM review_cases review
    WHERE review.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.buyer_refund_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM buyer_refund_ledger_balances refund
    WHERE refund.formal_order_id=NEW.formal_order_id AND refund.status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=refund.obligation_id
          AND entry.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.buyer_refund_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM buyer_refund_obligations refund
    WHERE refund.formal_order_id=NEW.formal_order_id
  ))
  OR (NEW.seller_principal_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_principal_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_PRINCIPAL'
  ))
  OR (NEW.seller_service_fee_state='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM seller_payable_balances payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
      AND payable.derived_status='PAID'
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=payable.payable_id
          AND allocation.created_at>NEW.business_closed_at
      )
  ))
  OR (NEW.seller_service_fee_state='NOT_APPLICABLE' AND EXISTS (
    SELECT 1 FROM seller_payables payable
    WHERE payable.formal_order_id=NEW.formal_order_id
      AND payable.payable_type='SELLER_SERVICE_FEE'
  ))
)
BEGIN
  SELECT RAISE(ABORT,'order_archive_closure_source_mismatch');
END;
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
CREATE TRIGGER trg_order_evidence_single_image_guard
BEFORE INSERT ON order_evidence_version_files
WHEN NOT EXISTS (
  SELECT 1 FROM order_evidence_versions evidence
  WHERE evidence.id=NEW.version_id
    AND evidence.evidence_file_object_id=NEW.file_object_id
)
OR (
  SELECT COUNT(*) FROM order_evidence_version_files existing
  WHERE existing.version_id=NEW.version_id
) >= 1
BEGIN
  SELECT RAISE(ABORT, 'order_evidence_exactly_one_image_required');
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
CREATE TRIGGER trg_seller_payable_source_guard
BEFORE INSERT ON seller_payables
WHEN
  (NEW.payable_type='SELLER_PRINCIPAL' AND NOT EXISTS (
    SELECT 1
    FROM formal_orders formal_order
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.id=NEW.financial_snapshot_id
      AND snapshot.formal_order_id=formal_order.id
    WHERE formal_order.id=NEW.formal_order_id
      AND formal_order.status='CONFIRMED'
      AND formal_order.seller_organization_id=NEW.seller_organization_id
      AND snapshot.seller_expected_principal_cny_fen=NEW.amount_cny_fen
      AND NEW.source_type='FORMAL_ORDER'
      AND NEW.source_id=formal_order.id
      AND NEW.due_at=formal_order.confirmed_at
  ))
  OR
  (NEW.payable_type='SELLER_SERVICE_FEE' AND NOT EXISTS (
    SELECT 1
    FROM review_cases review_case
    JOIN formal_orders formal_order
      ON formal_order.id=review_case.formal_order_id
    JOIN review_events approval
      ON approval.review_case_id=review_case.id
      AND approval.formal_order_id=formal_order.id
      AND approval.event_type='REVIEW_APPROVED'
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.id=NEW.financial_snapshot_id
      AND snapshot.formal_order_id=formal_order.id
    WHERE review_case.id=NEW.source_id
      AND review_case.status='APPROVED'
      AND review_case.seller_organization_id=NEW.seller_organization_id
      AND formal_order.id=NEW.formal_order_id
      AND formal_order.seller_organization_id=NEW.seller_organization_id
      AND snapshot.service_fee_cny_fen=NEW.amount_cny_fen
      AND NEW.source_type='REVIEW_APPROVAL'
      AND NEW.due_at=approval.created_at
  ))
BEGIN
  SELECT RAISE(ABORT, 'seller_payable_source_mismatch');
END;
CREATE TRIGGER trg_seller_principal_rate_snapshot_confirmation_guard
BEFORE INSERT ON seller_principal_rate_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM formal_orders formal_order
  JOIN formal_order_financial_snapshots financial_snapshot
    ON financial_snapshot.formal_order_id=formal_order.id
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.confirmed_at=NEW.created_at
    AND financial_snapshot.seller_expected_principal_cny_fen=
      NEW.seller_expected_principal_amount_minor
)
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshot_source_mismatch');
END;
CREATE TRIGGER trg_seller_principal_rate_snapshot_guard
BEFORE INSERT ON seller_principal_rate_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM formal_orders formal_order
  WHERE formal_order.id=NEW.formal_order_id
    AND formal_order.amazon_order_date=NEW.platform_order_date
    AND formal_order.final_paid_jpy=NEW.payment_amount_minor
    AND (
      (NEW.policy_scope_type='CURRENCY_PAIR_DEFAULT'
        AND NEW.policy_seller_organization_id IS NULL)
      OR (NEW.policy_scope_type='SELLER_ORGANIZATION'
        AND NEW.policy_seller_organization_id IS formal_order.seller_organization_id)
    )
)
OR NEW.base_rate_business_date>NEW.platform_order_date
OR NOT EXISTS (
  SELECT 1 FROM buyer_daily_currency_rate_versions rate
  WHERE rate.id=NEW.base_rate_version_id
    AND rate.business_date=NEW.base_rate_business_date
    AND rate.source_currency_code=NEW.payment_currency_code
    AND rate.quote_currency_code='CNY'
    AND rate.status='CONFIRMED'
    AND rate.rate_value=NEW.base_rate_value
    AND rate.rate_scale=NEW.base_rate_scale
    AND rate.confirmed_at=NEW.base_rate_confirmed_at
    AND rate.confirmed_at<=NEW.created_at
)
OR NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_versions policy
  WHERE policy.id=NEW.policy_version_id
    AND policy.scope_type=NEW.policy_scope_type
    AND policy.seller_organization_id IS NEW.policy_seller_organization_id
    AND policy.version_no=NEW.policy_version_no
    AND policy.source_currency_code=NEW.payment_currency_code
    AND policy.quote_currency_code='CNY'
    AND policy.status='CONFIRMED'
    AND policy.markup_rate_value=NEW.markup_rate_value
    AND policy.rate_scale=NEW.markup_rate_scale
    AND policy.effective_from=NEW.policy_effective_from
    AND policy.confirmed_at=NEW.policy_confirmed_at
    AND policy.effective_from<=NEW.created_at
    AND policy.confirmed_at<=NEW.created_at
)
OR NEW.final_rate_value<>NEW.base_rate_value+NEW.markup_rate_value
OR NEW.base_rate_value > 9007199254740991-NEW.markup_rate_value
OR CASE
  /*
   * HALF_UP(payment * final_rate / 1,000,000), without multiplying the two
   * large SQLite INTEGER operands directly.  Split both operands into
   * quotient/remainder parts and reject every intermediate overflow before
   * evaluating the corresponding product.
   */
  WHEN (NEW.payment_amount_minor / 1000000)
      > (9007199254740991 / NEW.final_rate_value) THEN 1
  WHEN (NEW.final_rate_value / 1000000) > 0
    AND (NEW.payment_amount_minor % 1000000)
      > (9007199254740991 / (NEW.final_rate_value / 1000000)) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
      > 9007199254740991
        - ((NEW.payment_amount_minor % 1000000)
          * (NEW.final_rate_value / 1000000)) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
    + ((NEW.payment_amount_minor % 1000000)
      * (NEW.final_rate_value / 1000000))
    > 9007199254740991
      - (((NEW.payment_amount_minor % 1000000)
        * (NEW.final_rate_value % 1000000) + 500000) / 1000000) THEN 1
  WHEN ((NEW.payment_amount_minor / 1000000) * NEW.final_rate_value)
    + ((NEW.payment_amount_minor % 1000000)
      * (NEW.final_rate_value / 1000000))
    + (((NEW.payment_amount_minor % 1000000)
      * (NEW.final_rate_value % 1000000) + 500000) / 1000000)
    <> NEW.seller_expected_principal_amount_minor THEN 1
  ELSE 0
END=1
BEGIN
  SELECT RAISE(ABORT, 'seller_principal_rate_snapshot_source_mismatch');
END;
CREATE TRIGGER trg_seller_staff_assignments_staff_guard
BEFORE INSERT ON seller_staff_assignments
WHEN NOT EXISTS (
  SELECT 1
  FROM staff_users staff
  JOIN seller_organizations organization
    ON organization.id=NEW.seller_organization_id
  JOIN staff_effective_assignment_permissions permission
    ON permission.staff_id=staff.id
    AND permission.permission_code='ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT'
  WHERE staff.id=NEW.staff_id AND staff.status='ACTIVE'
    AND (
      EXISTS (SELECT 1 FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE'
          AND role.role_code='owner')
      OR EXISTS (SELECT 1 FROM staff_marketplace_scopes scope
        WHERE scope.staff_id=staff.id AND scope.status='ACTIVE'
          AND scope.scope_kind='PRIMARY'
          AND scope.marketplace_code=organization.marketplace_code)
    )
    AND 4=(
      SELECT COUNT(DISTINCT required.permission_code)
      FROM staff_effective_assignment_permissions required
      WHERE required.staff_id=staff.id AND required.permission_code IN (
        'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH'))
)
BEGIN SELECT RAISE(ABORT,'seller_staff_assignment_target_ineligible'); END;
CREATE VIEW formal_order_effective_operational_state AS
SELECT formal_order.id AS formal_order_id,
  COALESCE((
    SELECT CASE event.event_type WHEN 'RESOLVED' THEN 'NORMAL' ELSE event.event_type END
    FROM formal_order_operational_events event
    WHERE event.formal_order_id=formal_order.id
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1
  ),'NORMAL') AS operational_state,
  (
    SELECT event.created_at FROM formal_order_operational_events event
    WHERE event.formal_order_id=formal_order.id
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1
  ) AS state_changed_at
FROM formal_orders formal_order;
CREATE VIEW internal_finance_cash_movements AS
SELECT
  payment.id AS movement_id,
  'SELLER_PAYMENT' AS movement_type,
  payment.seller_organization_id,
  NULL AS formal_order_id,
  payment.paid_at AS occurred_at,
  date(payment.paid_at / 1000, 'unixepoch', '+8 hours') AS cash_business_date,
  payment.amount_cny_fen AS amount_cny_fen
FROM seller_payments payment
UNION ALL
SELECT
  reversal.id,
  'SELLER_PAYMENT_REVERSAL',
  reversal.seller_organization_id,
  NULL,
  reversal.reversed_at,
  date(reversal.reversed_at / 1000, 'unixepoch', '+8 hours'),
  reversal.amount_cny_fen
FROM seller_payment_reversals reversal
UNION ALL
SELECT
  entry.id,
  CASE WHEN entry.entry_type='PAYMENT'
    THEN 'BUYER_REFUND_PAYMENT' ELSE 'BUYER_REFUND_REVERSAL' END,
  formal_order.seller_organization_id,
  obligation.formal_order_id,
  CASE WHEN entry.entry_type='PAYMENT' THEN entry.paid_at ELSE entry.reversed_at END,
  entry.china_business_date,
  entry.amount_cny_fen
FROM buyer_refund_payment_entries entry
JOIN buyer_refund_obligations obligation ON obligation.id=entry.obligation_id
JOIN formal_orders formal_order ON formal_order.id=obligation.formal_order_id
WHERE NOT EXISTS(
  SELECT 1
  FROM buyer_advance_principal_settlements settlement
  WHERE settlement.buyer_refund_payment_entry_id=CASE
    WHEN entry.entry_type='PAYMENT' THEN entry.id
    ELSE entry.original_payment_entry_id
  END
)
UNION ALL
SELECT
  entry.id,
  CASE WHEN entry.entry_type='PAYMENT'
    THEN 'BUYER_ADVANCE_PAYMENT' ELSE 'BUYER_ADVANCE_REVERSAL' END,
  formal_order.seller_organization_id,
  entry.formal_order_id,
  CASE WHEN entry.entry_type='PAYMENT' THEN entry.paid_at ELSE entry.reversed_at END,
  entry.china_business_date,
  entry.amount_cny_fen
FROM buyer_advance_principal_entries entry
JOIN formal_orders formal_order ON formal_order.id=entry.formal_order_id;
CREATE VIEW internal_order_finance_positions AS
WITH
snapshot_facts AS (
  SELECT
    formal_order_id,
    COUNT(*) AS snapshot_count,
    MIN(id) AS snapshot_id,
    MIN(buyer_self_pay_bps) AS buyer_self_pay_bps,
    MIN(buyer_self_pay_jpy) AS buyer_self_pay_jpy,
    MIN(buyer_expected_principal_cny_fen) AS buyer_expected_principal_cny_fen,
    MIN(seller_expected_principal_cny_fen) AS seller_expected_principal_cny_fen,
    MIN(service_fee_cny_fen) AS service_fee_cny_fen
  FROM formal_order_financial_snapshots
  GROUP BY formal_order_id
),
review_facts AS (
  SELECT
    formal_order.id AS formal_order_id,
    COUNT(review_case.id) AS review_case_count,
    MIN(review_case.id) AS review_case_id,
    COALESCE(SUM(CASE WHEN review_case.status='APPROVED' THEN 1 ELSE 0 END),0)
      AS approved_case_count,
    COALESCE(SUM(CASE
      WHEN review_case.seller_organization_id<>formal_order.seller_organization_id
        THEN 1 ELSE 0 END),0) AS organization_mismatch_count
  FROM formal_orders formal_order
  LEFT JOIN review_cases review_case
    ON review_case.formal_order_id=formal_order.id
  GROUP BY formal_order.id
),
approval_facts AS (
  SELECT
    formal_order_id,
    SUM(CASE WHEN event_type='REVIEW_APPROVED' THEN 1 ELSE 0 END)
      AS approval_event_count,
    MIN(CASE WHEN event_type='REVIEW_APPROVED' THEN id END)
      AS approval_event_id,
    MIN(CASE WHEN event_type='REVIEW_APPROVED' THEN review_case_id END)
      AS approval_review_case_id,
    MIN(CASE WHEN event_type='REVIEW_APPROVED' THEN created_at END)
      AS approved_at,
    MIN(CASE WHEN event_type='REVIEW_APPROVED'
      THEN date(created_at / 1000, 'unixepoch', '+8 hours') END)
      AS approved_business_date,
    SUM(CASE WHEN event_type='BUYER_REFUND_BECAME_DUE' THEN 1 ELSE 0 END)
      AS buyer_due_event_count,
    MIN(CASE WHEN event_type='BUYER_REFUND_BECAME_DUE' THEN id END)
      AS buyer_due_event_id,
    MIN(CASE WHEN event_type='BUYER_REFUND_BECAME_DUE' THEN review_case_id END)
      AS buyer_due_review_case_id,
    MIN(CASE WHEN event_type='BUYER_REFUND_BECAME_DUE'
      THEN formal_order_financial_snapshot_id END) AS buyer_due_snapshot_id,
    SUM(CASE WHEN event_type='SELLER_SERVICE_FEE_ACCRUED' THEN 1 ELSE 0 END)
      AS service_fee_event_count,
    MIN(CASE WHEN event_type='SELLER_SERVICE_FEE_ACCRUED' THEN id END)
      AS service_fee_event_id,
    MIN(CASE WHEN event_type='SELLER_SERVICE_FEE_ACCRUED' THEN review_case_id END)
      AS service_fee_review_case_id,
    MIN(CASE WHEN event_type='SELLER_SERVICE_FEE_ACCRUED'
      THEN formal_order_financial_snapshot_id END) AS service_fee_snapshot_id
  FROM review_events
  WHERE event_type IN (
    'REVIEW_APPROVED',
    'BUYER_REFUND_BECAME_DUE',
    'SELLER_SERVICE_FEE_ACCRUED'
  )
  GROUP BY formal_order_id
),
payable_facts AS (
  SELECT
    balance.formal_order_id,
    SUM(CASE WHEN balance.payable_type='SELLER_PRINCIPAL' THEN 1 ELSE 0 END)
      AS principal_count,
    SUM(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE' THEN 1 ELSE 0 END)
      AS service_fee_count,
    MIN(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.seller_organization_id END) AS principal_organization_id,
    MIN(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.financial_snapshot_id END) AS principal_snapshot_id,
    MIN(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.source_type END) AS principal_source_type,
    MIN(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.source_id END) AS principal_source_id,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.seller_organization_id END) AS service_fee_organization_id,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.financial_snapshot_id END) AS service_fee_payable_snapshot_id,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.source_type END) AS service_fee_source_type,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.source_id END) AS service_fee_source_id,
    MIN(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.due_at END) AS service_fee_due_at,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.amount_cny_fen ELSE 0 END),0) AS principal_due,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.paid_amount_cny_fen ELSE 0 END),0) AS principal_collected,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_PRINCIPAL'
      THEN balance.outstanding_amount_cny_fen ELSE 0 END),0) AS principal_outstanding,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.amount_cny_fen ELSE 0 END),0) AS service_fee_due,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.paid_amount_cny_fen ELSE 0 END),0) AS service_fee_collected,
    COALESCE(SUM(CASE WHEN balance.payable_type='SELLER_SERVICE_FEE'
      THEN balance.outstanding_amount_cny_fen ELSE 0 END),0) AS service_fee_outstanding
  FROM seller_payable_balances balance
  GROUP BY balance.formal_order_id
),
refund_facts AS (
  SELECT
    balance.formal_order_id,
    COUNT(*) AS refund_count,
    MIN(balance.source_review_event_id) AS refund_source_event_id,
    MIN(balance.review_case_id) AS refund_review_case_id,
    COALESCE(SUM(balance.due_amount_cny_fen),0) AS refund_due,
    COALESCE(SUM(balance.net_paid_cny_fen),0) AS refund_net_paid
  FROM buyer_refund_ledger_balances balance
  GROUP BY balance.formal_order_id
),
allocation_facts AS (
  SELECT
    payable.formal_order_id,
    COALESCE(SUM(net.net_amount_cny_fen),0) AS seller_attributed_cash
  FROM seller_payables payable
  JOIN seller_allocation_net_amounts net ON net.payable_id=payable.id
  JOIN seller_payments payment ON payment.id=net.payment_id
  LEFT JOIN seller_payment_reversals payment_reversal
    ON payment_reversal.payment_id=payment.id
  WHERE payment_reversal.id IS NULL
  GROUP BY payable.formal_order_id
),
cash_dates AS (
  SELECT formal_order_id, MAX(cash_business_date) AS last_cash_business_date
  FROM (
    SELECT
      payable.formal_order_id,
      date(payment.paid_at / 1000, 'unixepoch', '+8 hours') AS cash_business_date
    FROM seller_allocation_net_amounts net
    JOIN seller_payables payable ON payable.id=net.payable_id
    JOIN seller_payments payment ON payment.id=net.payment_id
    WHERE net.net_amount_cny_fen>0
      AND NOT EXISTS (
        SELECT 1 FROM seller_payment_reversals reversal
        WHERE reversal.payment_id=payment.id
      )
    UNION ALL
    SELECT
      obligation.formal_order_id,
      entry.china_business_date
    FROM buyer_refund_payment_entries entry
    JOIN buyer_refund_obligations obligation
      ON obligation.id=entry.obligation_id
  ) movements
  GROUP BY formal_order_id
),
base AS (
  SELECT
    formal_order.id AS formal_order_id,
    formal_order.amazon_order_number_normalized AS amazon_order_number,
    formal_order.seller_organization_id,
    formal_order.store_id,
    formal_order.product_id,
    formal_order.asin_normalized AS asin,
    formal_order.product_name_snapshot AS product_name,
    formal_order.review_type,
    formal_order.confirmed_at,
    formal_order.confirmed_business_date,
    approval.approved_at AS review_approved_at,
    approval.approved_business_date AS review_approved_business_date,
    cash_dates.last_cash_business_date,
    formal_order.final_paid_jpy,
    COALESCE(snapshot.snapshot_count,0) AS snapshot_count,
    snapshot.snapshot_id,
    snapshot.buyer_self_pay_bps,
    snapshot.buyer_self_pay_jpy,
    snapshot.buyer_expected_principal_cny_fen,
    snapshot.seller_expected_principal_cny_fen,
    snapshot.service_fee_cny_fen,
    COALESCE(review.review_case_count,0) AS review_case_count,
    review.review_case_id,
    COALESCE(review.approved_case_count,0) AS approved_case_count,
    COALESCE(review.organization_mismatch_count,0)
      AS review_organization_mismatch_count,
    COALESCE(approval.approval_event_count,0) AS approval_event_count,
    approval.approval_event_id,
    approval.approval_review_case_id,
    COALESCE(approval.buyer_due_event_count,0) AS buyer_due_event_count,
    approval.buyer_due_event_id,
    approval.buyer_due_review_case_id,
    approval.buyer_due_snapshot_id,
    COALESCE(approval.service_fee_event_count,0) AS service_fee_event_count,
    approval.service_fee_event_id,
    approval.service_fee_review_case_id,
    approval.service_fee_snapshot_id,
    COALESCE(payable.principal_count,0) AS principal_count,
    COALESCE(payable.service_fee_count,0) AS service_fee_count,
    payable.principal_organization_id,
    payable.principal_snapshot_id,
    payable.principal_source_type,
    payable.principal_source_id,
    payable.service_fee_organization_id,
    payable.service_fee_payable_snapshot_id,
    payable.service_fee_source_type,
    payable.service_fee_source_id,
    payable.service_fee_due_at,
    COALESCE(payable.principal_due,0) AS seller_principal_due_cny_fen,
    COALESCE(payable.principal_collected,0) AS seller_principal_collected_cny_fen,
    COALESCE(payable.principal_outstanding,0) AS seller_principal_outstanding_cny_fen,
    COALESCE(payable.service_fee_due,0) AS seller_service_fee_due_cny_fen,
    COALESCE(payable.service_fee_collected,0) AS seller_service_fee_collected_cny_fen,
    COALESCE(payable.service_fee_outstanding,0) AS seller_service_fee_outstanding_cny_fen,
    COALESCE(refund.refund_count,0) AS refund_count,
    refund.refund_source_event_id,
    refund.refund_review_case_id,
    COALESCE(refund.refund_due,0) AS buyer_refund_due_cny_fen,
    COALESCE(refund.refund_net_paid,0) AS buyer_refund_net_paid_cny_fen,
    COALESCE(allocation.seller_attributed_cash,0) AS seller_attributed_cash_cny_fen
  FROM formal_orders formal_order
  LEFT JOIN snapshot_facts snapshot ON snapshot.formal_order_id=formal_order.id
  LEFT JOIN review_facts review ON review.formal_order_id=formal_order.id
  LEFT JOIN approval_facts approval ON approval.formal_order_id=formal_order.id
  LEFT JOIN payable_facts payable ON payable.formal_order_id=formal_order.id
  LEFT JOIN refund_facts refund ON refund.formal_order_id=formal_order.id
  LEFT JOIN allocation_facts allocation ON allocation.formal_order_id=formal_order.id
  LEFT JOIN cash_dates ON cash_dates.formal_order_id=formal_order.id
),
classified AS (
  SELECT
    base.*,
    CASE WHEN snapshot_count=1 THEN
      seller_expected_principal_cny_fen + service_fee_cny_fen
        - buyer_expected_principal_cny_fen
      ELSE NULL END AS projected_gross_profit_cny_fen,
    CASE
      WHEN snapshot_count=0 THEN 'MISSING_FINANCIAL_SNAPSHOT'
      WHEN snapshot_count>1 THEN 'MULTIPLE_FINANCIAL_SNAPSHOTS'
      WHEN principal_count>1 OR service_fee_count>1 OR refund_count>1
        OR review_case_count>1 THEN 'LEDGER_CONFLICT'
      WHEN approved_case_count=0 AND approval_event_count=0 THEN 'PROJECTED_ONLY'
      WHEN approved_case_count<>1 OR approval_event_count<>1
        OR buyer_due_event_count<>1 OR service_fee_event_count<>1
        OR review_case_id<>approval_review_case_id
        OR review_case_id<>buyer_due_review_case_id
        OR review_case_id<>service_fee_review_case_id
        THEN 'REVIEW_APPROVAL_CONFLICT'
      WHEN principal_count=0 THEN 'MISSING_PRINCIPAL_PAYABLE'
      WHEN service_fee_count=0 THEN 'MISSING_SERVICE_FEE_PAYABLE'
      WHEN refund_count=0 THEN 'MISSING_BUYER_REFUND_OBLIGATION'
      WHEN review_organization_mismatch_count>0
        OR principal_organization_id<>seller_organization_id
        OR service_fee_organization_id<>seller_organization_id
        THEN 'SELLER_ORGANIZATION_MISMATCH'
      WHEN principal_snapshot_id<>snapshot_id
        OR principal_source_type<>'FORMAL_ORDER'
        OR principal_source_id<>formal_order_id
        OR service_fee_payable_snapshot_id<>snapshot_id
        OR service_fee_source_type<>'REVIEW_APPROVAL'
        OR service_fee_source_id<>review_case_id
        OR service_fee_due_at<>review_approved_at
        OR refund_source_event_id<>buyer_due_event_id
        OR refund_review_case_id<>review_case_id
        OR buyer_due_snapshot_id<>snapshot_id
        OR service_fee_snapshot_id<>snapshot_id
        THEN 'REVIEW_APPROVAL_CONFLICT'
      WHEN seller_principal_due_cny_fen<>seller_expected_principal_cny_fen
        OR seller_service_fee_due_cny_fen<>service_fee_cny_fen
        OR buyer_refund_due_cny_fen<>buyer_expected_principal_cny_fen
        THEN 'AMOUNT_MISMATCH'
      ELSE 'COMPLETED'
    END AS finance_status
  FROM base
)
SELECT
  formal_order_id, amazon_order_number, seller_organization_id,
  store_id, product_id, asin, product_name, review_type,
  confirmed_at, confirmed_business_date,
  review_approved_at, review_approved_business_date,
  last_cash_business_date, CAST(final_paid_jpy AS TEXT) AS final_paid_jpy,
  snapshot_id AS financial_snapshot_id,
  buyer_self_pay_bps,
  CASE WHEN buyer_self_pay_jpy IS NULL THEN NULL
    ELSE CAST(buyer_self_pay_jpy AS TEXT) END AS buyer_self_pay_jpy,
  CASE WHEN buyer_expected_principal_cny_fen IS NULL THEN NULL
    ELSE CAST(buyer_expected_principal_cny_fen AS TEXT)
    END AS buyer_expected_principal_cny_fen,
  CASE WHEN seller_expected_principal_cny_fen IS NULL THEN NULL
    ELSE CAST(seller_expected_principal_cny_fen AS TEXT)
    END AS seller_expected_principal_cny_fen,
  CASE WHEN service_fee_cny_fen IS NULL THEN NULL
    ELSE CAST(service_fee_cny_fen AS TEXT)
    END AS service_fee_snapshot_cny_fen,
  CASE WHEN projected_gross_profit_cny_fen IS NULL THEN NULL
    ELSE CAST(projected_gross_profit_cny_fen AS TEXT)
    END AS projected_gross_profit_cny_fen,
  CASE WHEN finance_status='COMPLETED' THEN CAST(
    seller_principal_due_cny_fen + seller_service_fee_due_cny_fen
      - buyer_refund_due_cny_fen AS TEXT)
    ELSE NULL END AS completed_gross_profit_cny_fen,
  CAST(seller_principal_due_cny_fen AS TEXT)
    AS seller_principal_due_cny_fen,
  CAST(seller_principal_collected_cny_fen AS TEXT)
    AS seller_principal_collected_cny_fen,
  CAST(seller_principal_outstanding_cny_fen AS TEXT)
    AS seller_principal_outstanding_cny_fen,
  CAST(seller_service_fee_due_cny_fen AS TEXT)
    AS seller_service_fee_due_cny_fen,
  CAST(seller_service_fee_collected_cny_fen AS TEXT)
    AS seller_service_fee_collected_cny_fen,
  CAST(seller_service_fee_outstanding_cny_fen AS TEXT)
    AS seller_service_fee_outstanding_cny_fen,
  CAST(buyer_refund_due_cny_fen AS TEXT) AS buyer_refund_due_cny_fen,
  CAST(buyer_refund_net_paid_cny_fen AS TEXT)
    AS buyer_refund_net_paid_cny_fen,
  CAST(CASE WHEN buyer_refund_due_cny_fen>buyer_refund_net_paid_cny_fen
    THEN buyer_refund_due_cny_fen-buyer_refund_net_paid_cny_fen
    ELSE 0 END AS TEXT) AS buyer_refund_outstanding_cny_fen,
  CAST(CASE WHEN buyer_refund_net_paid_cny_fen>buyer_refund_due_cny_fen
    THEN buyer_refund_net_paid_cny_fen-buyer_refund_due_cny_fen
    ELSE 0 END AS TEXT) AS buyer_refund_overpaid_cny_fen,
  CAST(seller_attributed_cash_cny_fen-buyer_refund_net_paid_cny_fen AS TEXT)
    AS attributed_cash_net_cny_fen,
  finance_status
FROM classified;
CREATE VIEW seller_organization_settlement_balances AS
SELECT
  organization.id AS seller_organization_id,
  COALESCE(SUM(CASE
    WHEN payable.payable_type='SELLER_PRINCIPAL'
      THEN payable.outstanding_amount_cny_fen ELSE 0 END),0)
    AS outstanding_principal_cny_fen,
  COALESCE(SUM(CASE
    WHEN payable.payable_type='SELLER_SERVICE_FEE'
      THEN payable.outstanding_amount_cny_fen ELSE 0 END),0)
    AS outstanding_service_fee_cny_fen,
  COALESCE((
    SELECT SUM(payment.unallocated_amount_cny_fen)
    FROM seller_payment_balances payment
    WHERE payment.seller_organization_id=organization.id
  ),0) AS unallocated_credit_cny_fen
FROM seller_organizations organization
LEFT JOIN seller_payable_balances payable
  ON payable.seller_organization_id=organization.id
GROUP BY organization.id;
CREATE TRIGGER trg_buyer_refund_obligation_requires_normal_order
BEFORE INSERT ON buyer_refund_obligations
WHEN COALESCE((
  SELECT state.operational_state
  FROM formal_order_effective_operational_state state
  WHERE state.formal_order_id=NEW.formal_order_id
),'NORMAL')<>'NORMAL'
BEGIN
  SELECT RAISE(ABORT,'buyer_refund_obligation_blocked_by_order_operational_state');
END;
CREATE TRIGGER trg_review_approval_requires_normal_order
BEFORE UPDATE OF status ON review_cases
WHEN NEW.status='APPROVED' AND OLD.status<>'APPROVED'
  AND COALESCE((
    SELECT state.operational_state
    FROM formal_order_effective_operational_state state
    WHERE state.formal_order_id=NEW.formal_order_id
  ),'NORMAL')<>'NORMAL'
BEGIN
  SELECT RAISE(ABORT,'review_approval_blocked_by_order_operational_state');
END;
CREATE TRIGGER trg_review_service_fee_requires_normal_order
BEFORE INSERT ON seller_payables
WHEN NEW.source_type='REVIEW_APPROVAL'
  AND COALESCE((
    SELECT state.operational_state
    FROM formal_order_effective_operational_state state
    WHERE state.formal_order_id=NEW.formal_order_id
  ),'NORMAL')<>'NORMAL'
BEGIN
  SELECT RAISE(ABORT,'seller_service_fee_blocked_by_order_operational_state');
END;
CREATE VIEW internal_finance_exceptions AS
SELECT
  formal_order_id,
  seller_organization_id,
  store_id,
  finance_status,
  CASE finance_status
    WHEN 'MISSING_FINANCIAL_SNAPSHOT' THEN 'MISSING_FINANCIAL_SNAPSHOT'
    WHEN 'MULTIPLE_FINANCIAL_SNAPSHOTS' THEN 'MULTIPLE_FINANCIAL_SNAPSHOTS'
    WHEN 'MISSING_PRINCIPAL_PAYABLE' THEN 'MISSING_PRINCIPAL_PAYABLE'
    WHEN 'MISSING_SERVICE_FEE_PAYABLE' THEN 'MISSING_SERVICE_FEE_PAYABLE'
    WHEN 'MISSING_BUYER_REFUND_OBLIGATION' THEN 'MISSING_BUYER_REFUND_OBLIGATION'
    WHEN 'REVIEW_APPROVAL_CONFLICT' THEN 'REVIEW_APPROVAL_CONFLICT'
    WHEN 'SELLER_ORGANIZATION_MISMATCH' THEN 'SELLER_ORGANIZATION_MISMATCH'
    WHEN 'AMOUNT_MISMATCH' THEN 'AMOUNT_MISMATCH'
    ELSE 'LEDGER_CONFLICT'
  END AS exception_code,
  CASE finance_status
    WHEN 'MISSING_FINANCIAL_SNAPSHOT' THEN 'REVIEW_FORMAL_ORDER_SNAPSHOT'
    WHEN 'MULTIPLE_FINANCIAL_SNAPSHOTS' THEN 'REVIEW_FORMAL_ORDER_SNAPSHOT'
    WHEN 'MISSING_PRINCIPAL_PAYABLE' THEN 'RUN_SELLER_PAYABLE_RECONCILIATION'
    WHEN 'MISSING_SERVICE_FEE_PAYABLE' THEN 'RUN_SELLER_PAYABLE_RECONCILIATION'
    WHEN 'MISSING_BUYER_REFUND_OBLIGATION' THEN 'REVIEW_BUYER_REFUND_OBLIGATION'
    ELSE 'MANUAL_INTERNAL_INVESTIGATION'
  END AS suggested_action
FROM internal_order_finance_positions
WHERE finance_status NOT IN ('PROJECTED_ONLY','COMPLETED');


UPDATE app_schema_state
SET
  schema_version=22,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1;
