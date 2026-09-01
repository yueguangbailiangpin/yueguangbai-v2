# Design: production-governance-fact-alignment

## Context

The authoritative local evidence is the current checkout at
`928750b278ae15aa9b88141b9c40c99da5ffe201`: clean worktree, branch
`feature/staging-workflow-rate-ux`, 92 commits ahead of its local upstream
ref, migration chain `0001`–`0037`, Schema 37, and 241 documented/runtime
endpoints. The production domain was cleaned up, so the checked-in hourly
health probe must not run against its former URL. The production Gate remains
NO-GO; local evidence is not staging, Remote CI, or production evidence.

## Goals / Non-Goals

**Goals:**

- Make current-facing governance prose match the verified local source,
  migration, runtime, and OpenSpec facts.
- Preserve historical numbers and semantics when they are explicitly marked as
  historical snapshots.
- Keep the health workflow manually dispatchable for diagnostics while making
  its paused schedule and reactivation condition machine-checked.

**Non-Goals:**

- No runtime business code, API contract, database object, migration, or
  external resource changes.
- No production readiness assertion and no change from `PRODUCTION_STATUS=NO-GO`.

## Decisions

1. **Use current local authorities.** Migration verifier output, the API
   contract verifier, active source-tree inventory, OpenSpec status, and the
   existing production cleanup record determine current wording. No remote
   state is queried.
2. **Retire, do not restore.** Staff MCP and Rakuten/TikTok runtime/provider
   surfaces remain deleted. Current prose names the deletion and retained
   fail-closed tombstones; historical plans remain historical.
3. **Separate completion from archive state.** Stage 7F parent and child are
   recorded as complete while explicitly unarchived; no existing Change task
   checkbox is edited.
4. **Pause only the schedule.** The health workflow keeps its manual trigger,
   existing diagnostic job, endpoint validation, least permissions, and
   concurrency. The static verifier requires no `schedule` key and requires a
   dispatch description stating that Stage 8 deployment and URL confirmation
   are prerequisites for reactivation.
5. **Do not modify stale historical verifiers outside the active gate.** The
   current production-local verifier and its tests are the enforcement path;
   older formal-readiness snapshots remain historical source material and are
   not silently rewritten.

## Data / Transaction / Permission Boundaries

There is no D1 transaction or data mutation. No API or DTO boundary changes.
The workflow continues to use only `contents: read` and `issues: write`; its
manual probe invokes the existing low-cardinality monitor and cannot deploy,
run migrations, or write Cloudflare resources. No Buyer/Seller/Staff data is
read, projected, or changed, so D1 acceptance and DTO-isolation checks are
explicitly N/A for this documentation/governance-only Change.

## Rejected Alternatives

- **Keep the hourly schedule:** rejected because the target deployment and
  `/ready` endpoint no longer exist, which would create a false recurring
  incident.
- **Replace the target with a guessed URL:** rejected because Stage 8 has not
  established a production endpoint and a fabricated target would misstate
  readiness.
- **Delete the workflow or diagnostic script:** rejected because the user
  requires manual dispatch and existing diagnostics to remain available.
- **Restore retired MCP/provider code:** rejected because current authority
  requires deletion plus fail-closed tombstones.

## Verification / Rollback

Run the YAML/governance tests, document/schema guards, OpenSpec strict
validation, `git diff --check`, and the applicable local npm gates. Rollback is
an ordinary revert of this Change's local commit; no reset, rebase, stash,
clean, amend, push, deployment, or archive is allowed.
