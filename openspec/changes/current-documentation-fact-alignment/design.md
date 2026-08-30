# Design: current-documentation-fact-alignment

## Context

The current checkout is clean on `feature/staging-workflow-rate-ux` at
`ecc173ab75a5db7a1b70b8ff8fb13044fb165ea9`, 82 commits ahead of its upstream
tracking ref. Direct verification reports Schema 36 from migrations
`0001`–`0036` and 241 unique runtime/documented endpoints. The current source
tree has no Staff MCP runtime implementation or Rakuten/TikTok core Worker
adapter entry; release preflight still intentionally rejects `STAFF_MCP_*`,
while historical OpenSpec, migration, import, and quarantine material remains
for traceability and fail-closed handling.

## Goals / Non-Goals

**Goals:**

- Make current-facing wording match directly verified local facts.
- Keep historical counts, schema notes, stage evidence, and old Decision
  wording explicitly historical rather than deleting or rewriting them.
- Keep the new Change self-contained and auditable as a docs-only Change.

**Non-Goals:**

- No runtime, API, SQL, migration, package script, configuration, test
  implementation, API inventory behavior, or DTO change.
- No OpenSpec archive/sync of another Change and no external or production
  access.

## Decisions

1. **Use direct current evidence.** The migration verifier and API verifier are
   the authority for Schema/API counts; the filesystem and runtime/preflight
   sources are the authority for directory and release-composition wording.
2. **Qualify retained material instead of deleting it.** Tombstones, historical
   OpenSpec/migration records, and import candidates remain documented as
   non-runtime or fail-closed material.
3. **Separate current and historical state with labels and minimal movement.**
   Existing historical stage detail stays intact, while current completion and
   remaining Stage 8/production boundaries are stated separately.
4. **Use `skip_specs: true`.** No observable requirement changes, so a delta
   spec would invent behavior and is intentionally omitted.
5. **Keep child and parent OpenSpec status separate.** The independent
   `stage7f4-legacy-css-retirement` Change is complete but not archived, while
   its parent `stage7f-frontend-complete-rebuild` still has the 6.2 manual
   visual-acceptance and 7.3 parent-bookkeeping checkboxes open. The current
   state must record both facts without changing either Change's tasks.

## Risks / Trade-offs

- **Risk:** Long historical lines can still be mistaken for current facts.
  **Mitigation:** Add explicit current/historical labels and preserve the
  current API, Schema, NOT_RUN, Stage 8, and Production NO-GO statements near
  the top of the current-state document.
- **Risk:** Retained provider/import references can be misread as runtime
  support. **Mitigation:** State the core Worker/release boundary and the
  fail-closed/traceability purpose beside the retained references.
- **Risk:** A completed child Change can be mistaken for a completed parent
  Change. **Mitigation:** Keep the child archive state and parent pending
  acceptance/bookkeeping state explicit in the current-state document.

## Migration Plan

`NO_SCHEMA_CHANGE`. Apply the four documentation corrections and the new
Change artifacts, run the scoped source guards, D1/API/OpenSpec/format checks,
then create one normal local commit. Rollback is a normal revert of that
commit; do not amend, push, deploy, archive another Change, or access remote
resources.
