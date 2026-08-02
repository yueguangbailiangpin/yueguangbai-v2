# Tasks: Pre-Wave 13 Baseline Conformance Audit

## Remote Audit Work

- [x] Confirm formal main is f28c52a36e9498c37453a4a12755d9ad8459ae65.
- [x] Confirm the audit branch begins at the same SHA with ahead 0, behind 0, and the same merge base.
- [x] Read the repository authority files and OpenSpec 1.7.0 skills.
- [x] Inspect the production route registration entrypoint and registered API modules.
- [x] Inspect representative implementation, contracts, domain rules, migrations, tests, and verifier source for each audit domain.
- [x] Define all AUTH, FIN, FILE, FLOW, API, and DB requirements.
- [x] Create the requirement traceability matrix.
- [x] Create the frontend API readiness inventory.
- [x] Record risk findings, governance conflicts, frontend blockers, and local validation requests.
- [x] Complete the REMOTE_SEMANTIC_VERIFY review.
- [x] Record low-risk Ponytail candidate areas without running Ponytail.
- [x] Confirm audit-only write scope before every remote commit.

## LOCAL_VALIDATION_PENDING

- [ ] Install repository dependencies locally through the authorized workflow.
- [ ] Run the repository full check gate locally.
- [ ] Run strict migration and schema validation against a D1-compatible local database.
- [ ] Reconfirm schema version 26, application tables 113, triggers 213, and views 10.
- [ ] Reconfirm test files 99 and tests 511, or document an intentional new baseline.
- [ ] Execute every verifier referenced by package.json.
- [ ] Run strict OpenSpec validation for this change.
- [ ] Run the repository OpenSpec verify workflow for this change.
- [ ] Validate trusted Staff session creation in the production Worker entrypoint after the blocker is resolved.
- [ ] Validate real D1 behavior versus test doubles for triggers, strict tables, transactions, cursors, and integer/string conversion.
- [ ] Run Wrangler validation only in the authorized local or Integration workflow.
- [ ] Run a later Ponytail review only after separate approval and only on documented low-risk candidates.
- [ ] Create Integration only after blockers are fixed and every gate passes.
- [ ] Advance main only through the authorized Integration process.

## Explicitly Not Performed

- [ ] Deployment.
- [ ] Pull request creation.
- [ ] Integration creation.
- [ ] Migration 0027.
- [ ] Production implementation fixes.
- [ ] Test modifications.
- [ ] Ponytail execution.
