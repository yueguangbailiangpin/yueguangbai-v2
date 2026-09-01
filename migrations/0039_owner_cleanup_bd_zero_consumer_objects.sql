-- Owner-authorized cleanup, batch B+D (schema 39): drop the two remaining
-- objects with no surviving consumer of any kind (code, tool, script, test,
-- view or trigger body).
--
-- Scope ruling 2026-09-01 (Owner, groups B and D, corrected after an
-- empirical sqlite_master audit): customer_buyer_invitation_lead_links
-- (runtime zero-read since the 0029 acquisition retirement; every earlier
-- trigger consumer was superseded) and scheduled_operations_permission_catalog
-- (single declaration seed row, never read).
--
-- Deliberately KEPT despite the B-group label: staff_assignment_role_
-- permission_defaults, its no_delete/no_update triggers and the
-- staff_effective_assignment_permissions view. The two live staff-guard
-- triggers on buyer/seller_staff_assignments select that view, and the view
-- joins the defaults table -- the trio is load-bearing assignment-eligibility
-- enforcement, not dead structure. The original audit missed trigger bodies
-- as a consumption channel; this migration records the corrected scope.

DROP TABLE IF EXISTS customer_buyer_invitation_lead_links;
DROP TABLE IF EXISTS scheduled_operations_permission_catalog;

UPDATE app_schema_state
SET
  schema_version=39,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1
  AND schema_version=38;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  (SELECT schema_version FROM app_schema_state WHERE singleton_id=1)=39
  AND (
    SELECT COUNT(*) FROM sqlite_master
    WHERE name IN (
      'customer_buyer_invitation_lead_links',
      'scheduled_operations_permission_catalog'
    )
  )=0
  AND (
    SELECT COUNT(*) FROM sqlite_master
    WHERE name IN (
      'staff_effective_assignment_permissions',
      'staff_assignment_role_permission_defaults',
      'trg_staff_assignment_role_permission_defaults_no_delete',
      'trg_staff_assignment_role_permission_defaults_no_update'
    )
  )=4
THEN 1 ELSE 0 END;
