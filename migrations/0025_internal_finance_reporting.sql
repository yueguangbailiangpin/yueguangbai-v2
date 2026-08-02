PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Wave 12 / Phase 3L: owner-only internal gross-profit reporting.
-- All amounts remain derived from immutable snapshots and ledgers. No mutable
-- profit amount is introduced by this migration.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=24
) THEN 1 ELSE 0 END;

-- Publish FINANCIAL_VIEW in the persisted override catalog while preserving
-- every historical GRANT/DENY row.
CREATE TABLE phase3l_backup_staff_permission_overrides AS
SELECT * FROM staff_permission_overrides;
DROP TABLE staff_permission_overrides;

CREATE TABLE staff_permission_overrides (
  staff_id TEXT NOT NULL REFERENCES staff_users(id),
  permission_code TEXT NOT NULL CHECK (permission_code IN (
    'TASK_VIEW_OPEN','TASK_CLAIM','TASK_VIEW_TEAM','TASK_ASSIGN_TEAM',
    'TASK_REASSIGN_TEAM','TASK_TAKEOVER_TEAM','TASK_COLLABORATE_TEAM',
    'BUYER_VIEW','BUYER_CREATE','BUYER_ACTIVATE_STANDARD',
    'BUYER_IDENTITY_HIGH_RISK_MANAGE','SELLER_VIEW','SELLER_MANAGE',
    'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
    'RESERVATION_VIEW','RESERVATION_DECIDE','ORDER_VIEW','ORDER_CONFIRM',
    'ORDER_INSTRUCTION_VIEW','ORDER_INSTRUCTION_PUBLISH',
    'ORDER_INSTRUCTION_MANAGE','ORDER_INSTRUCTION_EXPIRY_RUN',
    'REVIEW_VIEW','REVIEW_DECIDE','BUYER_REFUND_VIEW','BUYER_REFUND_RECORD',
    'SELLER_SETTLEMENT_VIEW','SELLER_SETTLEMENT_RECORD',
    'BUYER_SUPPORT_VIEW','BUYER_SUPPORT_NOTE','SELLER_SUPPORT_VIEW',
    'SELLER_SUPPORT_NOTE','FINANCIAL_VIEW','FINANCIAL_CORRECT',
    'FINANCIAL_EXPORT','STAFF_MANAGE','PERMISSION_MANAGE','AUDIT_VIEW',
    'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
    'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND','ASSIGNMENT_BATCH_TRANSFER',
    'ASSIGNMENT_AVAILABILITY_MANAGE'
  )),
  effect TEXT NOT NULL CHECK (effect IN ('GRANT','DENY')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  reason TEXT CHECK (reason IS NULL OR length(reason)<=1000),
  assigned_by_staff_id TEXT REFERENCES staff_users(id),
  assigned_at INTEGER NOT NULL CHECK (assigned_at>=0),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  updated_at INTEGER NOT NULL CHECK (updated_at>=created_at),
  PRIMARY KEY (staff_id, permission_code),
  CHECK (
    (status='ACTIVE' AND revoked_at IS NULL)
    OR (status='REVOKED' AND revoked_at IS NOT NULL)
  )
) STRICT;

INSERT INTO staff_permission_overrides (
  staff_id, permission_code, effect, status, reason,
  assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
)
SELECT
  staff_id, permission_code, effect, status, reason,
  assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
FROM phase3l_backup_staff_permission_overrides;
DROP TABLE phase3l_backup_staff_permission_overrides;

CREATE INDEX idx_staff_permission_override_effect_status
ON staff_permission_overrides (effect, status, permission_code, staff_id);

-- The assignment role-default catalog also owns a permission CHECK. Rebuild it
-- and add FINANCIAL_VIEW only to owner. Non-owner grants remain hard-blocked by
-- runtime authorization policy.
CREATE TABLE phase3l_backup_staff_role_defaults AS
SELECT * FROM staff_assignment_role_permission_defaults;
DROP TABLE staff_assignment_role_permission_defaults;

CREATE TABLE staff_assignment_role_permission_defaults (
  role_code TEXT NOT NULL CHECK (role_code IN (
    'owner','pre_sales','seller_ops','seller_support','after_sales','buyer_support'
  )),
  permission_code TEXT NOT NULL CHECK (permission_code IN (
    'TASK_VIEW_OPEN','TASK_CLAIM','TASK_VIEW_TEAM','TASK_ASSIGN_TEAM',
    'TASK_REASSIGN_TEAM','TASK_TAKEOVER_TEAM','TASK_COLLABORATE_TEAM',
    'BUYER_VIEW','BUYER_CREATE','BUYER_ACTIVATE_STANDARD',
    'BUYER_IDENTITY_HIGH_RISK_MANAGE','SELLER_VIEW','SELLER_MANAGE',
    'PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_VIEW','DEMAND_PUBLISH',
    'RESERVATION_VIEW','RESERVATION_DECIDE','ORDER_VIEW','ORDER_CONFIRM',
    'ORDER_INSTRUCTION_VIEW','ORDER_INSTRUCTION_PUBLISH',
    'ORDER_INSTRUCTION_MANAGE','ORDER_INSTRUCTION_EXPIRY_RUN',
    'REVIEW_VIEW','REVIEW_DECIDE','BUYER_REFUND_VIEW','BUYER_REFUND_RECORD',
    'SELLER_SETTLEMENT_VIEW','SELLER_SETTLEMENT_RECORD',
    'BUYER_SUPPORT_VIEW','BUYER_SUPPORT_NOTE','SELLER_SUPPORT_VIEW',
    'SELLER_SUPPORT_NOTE','FINANCIAL_VIEW','FINANCIAL_CORRECT',
    'FINANCIAL_EXPORT','STAFF_MANAGE','PERMISSION_MANAGE','AUDIT_VIEW',
    'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
    'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND','ASSIGNMENT_BATCH_TRANSFER',
    'ASSIGNMENT_AVAILABILITY_MANAGE'
  )),
  created_at INTEGER NOT NULL CHECK (created_at>=0),
  PRIMARY KEY (role_code, permission_code)
) STRICT;

INSERT INTO staff_assignment_role_permission_defaults (
  role_code, permission_code, created_at
)
SELECT role_code, permission_code, created_at
FROM phase3l_backup_staff_role_defaults;
DROP TABLE phase3l_backup_staff_role_defaults;

INSERT INTO staff_assignment_role_permission_defaults (
  role_code, permission_code, created_at
) VALUES (
  'owner', 'FINANCIAL_VIEW', CAST(unixepoch('now') AS INTEGER) * 1000
);

-- One row per formal order. Counts are retained so incomplete or conflicting
-- facts are reported rather than silently treated as zero.
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

-- Company cash movements are intentionally separate from order gross profit.
-- Allocation and reallocation are excluded because they do not move company cash.
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
JOIN formal_orders formal_order ON formal_order.id=obligation.formal_order_id;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='view' AND name='internal_order_finance_positions')
  AND EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='view' AND name='internal_finance_exceptions')
  AND EXISTS (SELECT 1 FROM sqlite_master
    WHERE type='view' AND name='internal_finance_cash_movements')
  AND EXISTS (
    SELECT 1 FROM staff_assignment_role_permission_defaults
    WHERE role_code='owner' AND permission_code='FINANCIAL_VIEW'
  )
  AND NOT EXISTS (
    SELECT 1 FROM staff_assignment_role_permission_defaults
    WHERE role_code<>'owner' AND permission_code='FINANCIAL_VIEW'
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=25,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=24;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
