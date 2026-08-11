PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=60
) THEN 1 ELSE 0 END;

-- Review visibility is explicitly post-approval. Pending/rejected review cases
-- must not be mislabeled as dropped/not-visible marketplace observations.
CREATE TRIGGER trg_review_visibility_requires_approved_review
BEFORE INSERT ON review_visibility_observations
WHEN NOT EXISTS(
  SELECT 1 FROM review_cases review_case
  WHERE review_case.id=NEW.review_case_id
    AND review_case.formal_order_id=NEW.formal_order_id
    AND review_case.status='APPROVED'
)
BEGIN
  SELECT RAISE(ABORT,'review_visibility_requires_approved_review');
END;

-- Advance principal is only for the period before the formal refund obligation.
CREATE TRIGGER trg_advance_principal_payment_before_obligation
BEFORE INSERT ON buyer_advance_principal_entries
WHEN NEW.entry_type='PAYMENT' AND EXISTS(
  SELECT 1 FROM buyer_refund_obligations obligation
  WHERE obligation.formal_order_id=NEW.formal_order_id
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_after_refund_obligation_forbidden');
END;

-- Reversals must point to a payment on the same formal order and buyer.
CREATE TRIGGER trg_advance_principal_reversal_source_guard
BEFORE INSERT ON buyer_advance_principal_entries
WHEN NEW.entry_type='REVERSAL' AND NOT EXISTS(
  SELECT 1 FROM buyer_advance_principal_entries payment
  WHERE payment.id=NEW.original_payment_entry_id
    AND payment.entry_type='PAYMENT'
    AND payment.formal_order_id=NEW.formal_order_id
    AND payment.buyer_customer_id=NEW.buyer_customer_id
)
BEGIN
  SELECT RAISE(ABORT,'advance_principal_reversal_source_mismatch');
END;

-- Financial adjustments may reference an order operational event only when the
-- event belongs to the exact same formal order.
CREATE TRIGGER trg_formal_order_financial_adjustment_event_guard
BEFORE INSERT ON formal_order_financial_adjustments
WHEN NEW.source_operational_event_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM formal_order_operational_events event
  WHERE event.id=NEW.source_operational_event_id
    AND event.formal_order_id=NEW.formal_order_id
)
BEGIN
  SELECT RAISE(ABORT,'formal_order_financial_adjustment_event_mismatch');
END;

-- Seller portal member store grants may never cross organizations.
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

-- Per-machine channel scopes must fit one of that machine's marketplace scopes.
CREATE TRIGGER trg_acquisition_machine_channel_scope_guard
BEFORE INSERT ON acquisition_machine_channels
WHEN NOT EXISTS(
  SELECT 1 FROM acquisition_channels channel
  JOIN acquisition_machine_marketplaces market
    ON market.machine_id=NEW.machine_id
   AND market.marketplace_code=channel.marketplace_code
  WHERE channel.id=NEW.channel_id AND channel.status='ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT,'acquisition_machine_channel_scope_mismatch');
END;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_review_visibility_requires_approved_review')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_advance_principal_payment_before_obligation')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_formal_order_financial_adjustment_event_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_seller_member_portal_grant_scope_guard')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_acquisition_machine_channel_scope_guard')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=61,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=60;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
