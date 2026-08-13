# Tasks: Security And Command Integrity Readiness

- [x] 1. Freeze `NO_SCHEMA_CHANGE`, production boundaries, one-time machine secret replay and command transaction invariants.
- [x] 2. Harden machine credential create/revoke and add route-to-service replay/conflict/atomicity tests.
- [x] 3. Harden Prospect update/signals, assignment revoke and source correction with guarded command batches, Audit/Outbox and route behavior tests.
- [x] 4. Add fail-closed `operational_alerts` readiness and align monitor, release preflight, runtime policy, runbook and tests.
- [x] 5. Apply strict Origin and exact-body enforcement to password change and order-instruction writes while preserving direct scheduled-service calls.
- [x] 6. Run targeted strict verification, all strict verification, `git diff --check`, then one full `npm run check`.
- [x] 7. Self-review secrets, production writes and migration diff; commit, push and open a Draft PR without merging.
- [x] 8. Verify machine Bearer Prospect signal/analysis command semantics, controlled OCC, concealment and atomic failure cleanup through real routes.
- [x] 9. Replace production boolean self-attestation with bound-sink configuration and immutable structured Staff attestation; align `/ready`, runtime, preflight and monitor policy.
- [x] 10. Verify credential replay before mutable channel validation and Staff source-correction concealment through formal sessions.
- [x] 11. Verify key Staff and order-instruction boundaries through cookie-to-session-to-D1 middleware, plus exact ghost-count assertions.
- [x] 12. Run final API/Web typecheck, targeted tests, strict OpenSpec gates, diff check and exactly one full repository check for this review revision.
- [ ] 13. Production operator implements/provisions the real sink RPC, independently verifies its canonical descriptor/derived fingerprint, performs delivery/safe-failure/recovery exercises and records a current attestation. Not performed: production access is not authorized by this change.
- [x] 14. Derive the binding fingerprint from the exact rendered service descriptor, require exact release SHA, and replace client PASS claims with three nonce-bound RPC receipts plus fail-closed tests.
