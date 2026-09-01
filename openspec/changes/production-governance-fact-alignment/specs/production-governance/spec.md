# Production Governance Delta

## MODIFIED Requirements

### Requirement: Current production governance facts are explicit and scoped

Current-facing release documents SHALL state the verified local migration
baseline as Schema 37 / `0001`–`0037`, SHALL not describe the resolved CI billing
block as current, SHALL describe retired Staff MCP and Rakuten/TikTok runtime
surfaces as deleted with fail-closed anti-resurrection tombstones, and SHALL
distinguish Stage 7F completion from OpenSpec archive state. Historical numbers
and semantics MAY remain only when explicitly labeled as historical snapshots.

#### Scenario: Governance documents are checked against the local baseline

- **WHEN** the local production-schema/documentation guards and targeted text
  review run on the current checkout
- **THEN** they find the current `0001`–`0037` chain and `0037` tail, no current
  Schema 72 or billing-block claim in the affected current records, explicit
  retired-surface tombstone wording, and explicit Stage 7F 42/42 plus
  unarchived wording.

#### Scenario: Historical local evidence is retained

- **WHEN** an affected document contains an older SHA, measurement, or gate
  record needed for audit traceability
- **THEN** the record remains unchanged in meaning and is visibly labeled as a
  historical snapshot rather than presented as current acceptance.

### Requirement: Obsolete production health schedules are fail-closed

The checked-in production health workflow SHALL have no automatic `schedule`
trigger while the former production `/ready` endpoint is unavailable. It SHALL
retain the existing `workflow_dispatch` simulation input, fixed diagnostic
entrypoint, least permissions, concurrency control, and old endpoint validation
for manual diagnostics. Its dispatch description SHALL state that a Stage 8
formal deployment and confirmed production readiness URL are required before
an hourly schedule may be restored. No replacement URL or deployment command
may be introduced.

#### Scenario: Manual diagnostic remains available

- **WHEN** an operator manually dispatches the workflow with `probe`, `failure`,
  or `recovery`
- **THEN** the existing health job and monitor script remain the only execution
  path, with no automatic schedule and no application-resource deployment.

#### Scenario: Governance guard rejects schedule reintroduction

- **WHEN** the local release-governance verifier parses the health workflow
- **THEN** it accepts the manual-only canonical shape and rejects a workflow
  containing an automatic `schedule` trigger or a dispatch description that
  omits the Stage 8 and confirmed-URL prerequisite.
