# Tasks: Security And Command Integrity Readiness

- [x] 1. Freeze `NO_SCHEMA_CHANGE`, production boundaries, one-time machine secret replay and command transaction invariants.
- [x] 2. Harden machine credential create/revoke and add route-to-service replay/conflict/atomicity tests.
- [x] 3. Harden Prospect update/signals, assignment revoke and source correction with guarded command batches, Audit/Outbox and route behavior tests.
- [x] 4. Add fail-closed `operational_alerts` readiness and align monitor, release preflight, runtime policy, runbook and tests.
- [x] 5. Apply strict Origin and exact-body enforcement to password change and order-instruction writes while preserving direct scheduled-service calls.
- [x] 6. Run targeted strict verification, all strict verification, `git diff --check`, then one full `npm run check`.
- [ ] 7. Self-review secrets, production writes and migration diff; commit, push and open a Draft PR without merging.
