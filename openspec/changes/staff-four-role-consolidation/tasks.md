# Tasks: Staff Four-Role Consolidation

## 0. Freeze and Evidence

- [ ] 0.1 Re-read current role contracts, permission defaults, assignment SQL, sessions, fixtures and every persisted role CHECK.
- [ ] 0.2 Assert `origin/main`, consecutive migrations and schema version; reserve the next number only for this serial Change.
- [ ] 0.3 Verify the owner statement that no legacy Staff currently require migration; if any are found, stop and produce an owner-reviewable unique-target mapping and before/after effective-permission diff with no real data committed to Git.

## 1. Migration

- [ ] 1.1 Add the next consecutive Migration with schema/table rebuild backups, row assertions, four-role constraints and exactly one ACTIVE role per ACTIVE Staff.
- [ ] 1.2 Preserve legacy role history as revoked/audit facts and migrate approved assignments atomically.
- [ ] 1.3 Increment authorization versions and revoke pre-cutover Staff Sessions.
- [ ] 1.4 Verify fresh install, 34→next upgrade, wrong order, repeat, partial DDL, rollback backup and forward recovery.

## 2. Contracts and Authorization

- [ ] 2.1 Replace active role enums/displays with owner, pre_sales, seller_ops and buyer_refund.
- [ ] 2.2 Rebuild default permissions and assignment eligibility without changing DENY/hard-deny precedence or financial owner checks.
- [ ] 2.3 Fail closed on unknown/legacy ACTIVE roles, multiple ACTIVE roles, non-unique targets and unapproved support-role mappings.

## 3. API and Web

- [ ] 3.1 Update Staff session projections, role administration, workbench navigation and Chinese role labels.
- [ ] 3.2 Keep login role-free and render capabilities only from backend effective authorization.

## 4. Tests and Verification

- [ ] 4.1 Cover every old→new mapping, rejection of multiple ACTIVE roles, inactive Staff, empty role, Personal DENY, leader package and Scope boundaries.
- [ ] 4.2 Cover no silent permission gain for unapproved buyer_support/seller_support mappings.
- [ ] 4.3 Run complete D1, authorization, finance, file, scheduler, Staff MCP, browser, secrets, typecheck and build gates.
- [ ] 4.4 Run OpenSpec strict and implementation Verify; sync/archive only after controller and owner mapping approval.

## 5. Rollback

- [ ] 5.1 Rehearse pre-cutover restore and post-cutover forward recovery without deleting role, audit or Session-revocation evidence.
