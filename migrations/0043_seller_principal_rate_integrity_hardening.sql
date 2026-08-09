PRAGMA foreign_keys = ON;

-- Forward-only integrity repair for Migration 0041. Existing policy, event,
-- formal-order, financial snapshot, payable, and principal snapshot facts are
-- never rewritten. Any incompatible existing fact stops the migration before
-- the additive index and triggers are created.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=42
) THEN 1 ELSE 0 END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_versions policy
  WHERE policy.status='CONFIRMED'
    AND policy.effective_from<=policy.confirmed_at
) THEN 1 ELSE 0 END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_events event
  GROUP BY event.version_id, event.event_type
  HAVING COUNT(*)>1
) THEN 1 ELSE 0 END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_events event
  WHERE NOT EXISTS (
    SELECT 1 FROM seller_principal_rate_policy_versions policy
    WHERE policy.id=event.version_id
      AND policy.scope_type=event.scope_type
      AND policy.seller_organization_id IS event.seller_organization_id
      AND policy.source_currency_code=event.source_currency_code
      AND policy.quote_currency_code=event.quote_currency_code
      AND policy.version_no=event.version_no
      AND policy.markup_rate_value=event.markup_rate_value
      AND policy.effective_from=event.effective_from
      AND (
        (event.event_type='SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED'
          AND event.actor_staff_id=policy.submitted_by_staff_id
          AND event.created_at=policy.submitted_at
          AND event.reason IS NULL)
        OR (event.event_type='SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED'
          AND policy.status='CONFIRMED'
          AND event.actor_staff_id=policy.confirmed_by_staff_id
          AND event.created_at=policy.confirmed_at
          AND event.reason IS NULL)
        OR (event.event_type='SELLER_PRINCIPAL_RATE_POLICY_REJECTED'
          AND policy.status='REJECTED'
          AND event.actor_staff_id=policy.rejected_by_staff_id
          AND event.created_at=policy.rejected_at
          AND event.reason=policy.rejection_reason)
      )
  )
) THEN 1 ELSE 0 END;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_snapshots principal_snapshot
  WHERE NOT EXISTS (
    SELECT 1 FROM formal_orders formal_order
    JOIN formal_order_financial_snapshots financial_snapshot
      ON financial_snapshot.formal_order_id=formal_order.id
    WHERE formal_order.id=principal_snapshot.formal_order_id
      AND formal_order.confirmed_at=principal_snapshot.created_at
      AND financial_snapshot.seller_expected_principal_cny_fen=
        principal_snapshot.seller_expected_principal_amount_minor
  )
) THEN 1 ELSE 0 END;

CREATE UNIQUE INDEX uq_seller_principal_rate_policy_event_type
ON seller_principal_rate_policy_events (version_id, event_type);

CREATE TRIGGER trg_seller_principal_rate_policy_future_effective_guard
BEFORE UPDATE ON seller_principal_rate_policy_versions
WHEN NEW.status='CONFIRMED'
  AND (NEW.confirmed_at IS NULL OR NEW.effective_from<=NEW.confirmed_at)
BEGIN
  SELECT RAISE(
    ABORT,
    'seller_principal_rate_policy_effective_time_conflict'
  );
END;

CREATE TRIGGER trg_seller_principal_rate_policy_event_fidelity_guard
BEFORE INSERT ON seller_principal_rate_policy_events
WHEN NOT EXISTS (
  SELECT 1 FROM seller_principal_rate_policy_versions policy
  WHERE policy.id=NEW.version_id
    AND policy.scope_type=NEW.scope_type
    AND policy.seller_organization_id IS NEW.seller_organization_id
    AND policy.source_currency_code=NEW.source_currency_code
    AND policy.quote_currency_code=NEW.quote_currency_code
    AND policy.version_no=NEW.version_no
    AND policy.markup_rate_value=NEW.markup_rate_value
    AND policy.effective_from=NEW.effective_from
    AND (
      (NEW.event_type='SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED'
        AND NEW.actor_staff_id=policy.submitted_by_staff_id
        AND NEW.created_at=policy.submitted_at
        AND NEW.reason IS NULL)
      OR (NEW.event_type='SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED'
        AND policy.status='CONFIRMED'
        AND NEW.actor_staff_id=policy.confirmed_by_staff_id
        AND NEW.created_at=policy.confirmed_at
        AND NEW.reason IS NULL)
      OR (NEW.event_type='SELLER_PRINCIPAL_RATE_POLICY_REJECTED'
        AND policy.status='REJECTED'
        AND NEW.actor_staff_id=policy.rejected_by_staff_id
        AND NEW.created_at=policy.rejected_at
        AND NEW.reason=policy.rejection_reason)
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'seller_principal_rate_policy_event_source_mismatch'
  );
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

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='index'
      AND name='uq_seller_principal_rate_policy_event_type')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='trigger'
      AND name='trg_seller_principal_rate_policy_future_effective_guard')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='trigger'
      AND name='trg_seller_principal_rate_policy_event_fidelity_guard')
  AND EXISTS (SELECT 1 FROM sqlite_schema
    WHERE type='trigger'
      AND name='trg_seller_principal_rate_snapshot_confirmation_guard')
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET schema_version=43,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=42;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
