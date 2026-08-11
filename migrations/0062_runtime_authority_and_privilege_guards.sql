PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN EXISTS(
  SELECT 1 FROM app_schema_state WHERE singleton_id=1 AND schema_version=61
) THEN 1 ELSE 0 END;

-- Any second customer persona is a privilege expansion on the same login.
-- Revoke every older session in the SAME transaction that activates that persona.
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
  INSERT INTO transaction_assertions(assertion_value)
  SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
END;

-- Company-profit adjustments are the only generic adjustment scopes. Seller
-- principal/service-fee and Buyer refund cash ledgers must use their own formal
-- correction/reversal flows so a side table can never pretend the ledger moved.
CREATE TRIGGER trg_formal_order_financial_adjustment_profit_only
BEFORE INSERT ON formal_order_financial_adjustments
WHEN NEW.adjustment_scope NOT IN ('PROJECTED_GROSS_PROFIT','COMPLETED_GROSS_PROFIT')
BEGIN
  SELECT RAISE(ABORT,'formal_order_financial_adjustment_scope_requires_ledger_flow');
END;

-- Post-confirmation order integrity is an actual state machine, not a label.
-- An abnormal/investigation order cannot newly approve a review and therefore
-- cannot create new Buyer refund or Seller service-fee obligations until it is
-- explicitly RESOLVED back to NORMAL.
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

INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN
  EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_customer_persona_privilege_session_bump')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_formal_order_financial_adjustment_profit_only')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_review_approval_requires_normal_order')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_buyer_refund_obligation_requires_normal_order')
  AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='trg_review_service_fee_requires_normal_order')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=62,installed_at=CAST(unixepoch('now') AS INTEGER)*1000
WHERE singleton_id=1 AND schema_version=61;
INSERT INTO transaction_assertions(assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
