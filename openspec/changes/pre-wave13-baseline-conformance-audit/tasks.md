# Tasks: Pre-Wave 13 Baseline Conformance Audit

## Historical Remote Audit Work

- [x] Confirm historical formal main `f28c52a36e9498c37453a4a12755d9ad8459ae65`.
- [x] Confirm historical audit branch and merge base.
- [x] Inspect authority, route registration, implementation, contracts, migrations, tests and verifier source.
- [x] Create historical requirement traceability and frontend readiness inventory.
- [x] Record P1 findings, governance conflict, frontend blockers and local validation requests.
- [x] Record the historical remote semantic review and low-risk Ponytail candidates without running Ponytail.

## Historical Local Supplement

- [x] Record the historical schema-26 local gate and D1 baseline evidence already produced on the audit branch.
- [x] Record that historical OpenSpec strict validation ran before the Wave 13 implementation changes.
- [ ] Do not treat historical schema-26/test evidence as validation of the current Wave 13 Feature.

## Wave 13 REMOTE_IMPLEMENTATION_EVIDENCE

- [x] Update the existing audit document with Staff Auth, File HTTP, Order Evidence, Buyer Refund and Migration 0027 source evidence.
- [x] Update the existing traceability matrix with 52 Requirements / 104 Scenarios and current static classifications.
- [x] Update the existing frontend readiness inventory with 30 active additions and static total 138.
- [x] Record D-014 Staff authority and Feishu authentication boundary without erasing D-004 history.
- [x] Record `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` as an approved Wave 13 scope reduction assigned to Wave 15.
- [x] Record constrained logout-all COMMITTED replay semantics.
- [x] Record Default App, D1, R2, service rollback and recursive DTO test source.
- [x] Keep all P1 findings at `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` rather than formally closed.
- [x] Keep the audit conclusion `NO_GO_PENDING_LOCAL_VALIDATION`.

## Current Local Validation Pending

- [ ] Install dependencies for the current Feature through the authorized local workflow.
- [ ] Run the current repository full check gate.
- [ ] Run current Vitest, typecheck and build.
- [ ] Apply and verify 0001–0027 against real local D1.
- [ ] Upgrade a schema-26 fixture to 27 and verify Customer Auth preservation.
- [ ] Run real D1 state/session/logout-all/approve/refund transaction behavior.
- [ ] Run real R2 put/receipt/HEAD/compensation/delete-pending/cleanup tests.
- [ ] Recount current schema, tables, triggers, views, test files and tests.
- [ ] Re-run strict OpenSpec validation after the File HTTP semantic scope reduction.
- [ ] Run the repository OpenSpec Verify workflow.
- [ ] Validate production-entrypoint Staff login and every Staff route family in the authorized local workflow.
- [ ] Run browser, approved Feishu app and network validation.
- [ ] Run Ponytail only after separate approval and only after all prior gates pass.

## Integration and Release Pending

- [ ] Create Integration only after all blockers and validation gates are formally closed.
- [ ] Advance main only through the authorized Integration process.
- [ ] Create a PR only if later authorized by project control.
- [ ] Deploy only through the authorized release workflow.

## Explicit Current Non-Actions

- [ ] No current npm/Vitest/D1/R2/Wrangler execution was performed by the remote implementation conversation.
- [ ] No OpenSpec Verify was executed after the Wave 13 semantic update.
- [ ] No Ponytail review was run.
- [ ] No PR, Integration, deployment or main advancement was created.
