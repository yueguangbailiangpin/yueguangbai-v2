-- Owner-authorized cleanup (schema 38): drop zero-consumer registration
-- snapshot objects, the always-empty staff assignment cursor assertion
-- table, and the two zero-consumer views.
--
-- Scope ruling 2026-09-01 (Owner, group A + C): buyer_registration_attempts,
-- buyer_registration_conflicts, buyer_registration_conflict_events and the
-- 0019 status view form a closed island with no runtime consumer (rate
-- limiting moved to buyer_registration_rate_limits); the 0015 cursor
-- assertion table has never received a row and only carries self-cleanup
-- triggers; the formal_order_effective_dates view survives three rebuilds
-- with no reader and the Owner confirmed no external reporting consumes it.
-- The seller_customer_groups tables stay reserved for the upcoming
-- multi-marketplace rollout; the test-only link/permission-default tables
-- and the permission catalog are intentionally NOT dropped in this change.

DROP VIEW IF EXISTS buyer_registration_conflict_statuses;
DROP VIEW IF EXISTS formal_order_effective_dates;

DROP TRIGGER IF EXISTS trg_buyer_registration_attempts_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_registration_attempts_no_update;
DROP TRIGGER IF EXISTS trg_buyer_registration_conflicts_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_registration_conflicts_no_update;
DROP TRIGGER IF EXISTS trg_buyer_registration_conflict_events_no_delete;
DROP TRIGGER IF EXISTS trg_buyer_registration_conflict_events_no_update;
DROP TRIGGER IF EXISTS trg_staff_assignment_cursor_assertion_cleanup;
DROP TRIGGER IF EXISTS trg_staff_assignment_cursor_assertion_guard;

DROP TABLE IF EXISTS buyer_registration_attempts;
DROP TABLE IF EXISTS buyer_registration_conflict_events;
DROP TABLE IF EXISTS buyer_registration_conflicts;
DROP TABLE IF EXISTS staff_assignment_cursor_assertions;

UPDATE app_schema_state
SET
  schema_version=38,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=37;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=38
  AND (
    SELECT COUNT(*) FROM sqlite_master
    WHERE name IN (
      'buyer_registration_attempts',
      'buyer_registration_conflicts',
      'buyer_registration_conflict_events',
      'staff_assignment_cursor_assertions',
      'buyer_registration_conflict_statuses',
      'formal_order_effective_dates'
    )
  )=0
THEN 1 ELSE 0 END;
