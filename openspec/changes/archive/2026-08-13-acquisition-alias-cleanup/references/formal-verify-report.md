# Formal Verify: acquisition-alias-cleanup

Verified on 2026-08-13 Asia/Shanghai against the active proposal, design,
tasks, current `staff-acquisition-funnel` specification, D-026/D-035, D-038,
the Staff route composition, current Acquisition route/contracts and local
validation evidence. Ponytail remained off. No production, remote, migration
or runtime operation was performed.

## Initial scorecard

| Dimension | Result |
| --- | --- |
| Completeness | CRITICAL — 8/9 tasks because V3 included this Formal Verify transition |
| Correctness | PASS — no current OpenSpec requirement changes; the refactor preserves the existing D-035-aligned runtime and its API/security behavior evidence |
| Coherence | PASS — canonical composition, V4 evidence and retirement scope agree with the design |
| Findings | 1 self-referential task gate, 0 warnings, 0 suggestions |

The initial critical was a workflow bookkeeping issue, not an implementation
failure. V3 was split into completed pre-Verify validation and V4, then V4 was
checked only with this final assessment. No requirement, scenario, contract or
runtime discrepancy was found.

## Evidence mapping

| Concern | Evidence | Result |
| --- | --- | --- |
| Canonical composition | `StaffRouteModule.tsx` imports and renders `AcquisitionCoreWorkbench`; `AcquisitionCoreWorkbench.tsx` re-exports V4 | PASS |
| UI authorization and Owner surface | `AcquisitionCoreWorkbenchV4.msw.test.tsx` directly covers pre-sales/buyer-refund closure and Owner channel/daily operations | PASS |
| Route and browser evidence | `apps/web/e2e/staff-acquisition.spec.ts` exercises bookmarkable `/staff/acquisition`, human prospect creation and buyer-refund closure | PASS |
| Current source authority | `routes.ts`, `leads.ts`, `packages/contracts/src/acquisition.ts`, `acquisition.test.ts` and `staff-acquisition-funnel` retain explicit controlled `channel_id`, ACTIVE/type/site/scope and Prospect-origin fail-closed behavior | PASS |
| Attribution and operational safety | Existing behavior/verifier evidence retains immutable original source, append-only audited correction, dedupe/profit isolation and maintenance fail-closed gating | PASS |
| Retirement boundary | repository consumer search finds no non-archived runtime/import/test/verifier consumer; verifier checks both retired paths absent | PASS |
| Migration and external boundary | `db:verify`, migration guards and empty `git diff -- migrations` passed; no remote command was run | PASS |

## Final scorecard

| Dimension | Result |
| --- | --- |
| Completeness | PASS — 10/10 tasks complete |
| Correctness | PASS — the alias removal preserves the established current behavior and its contract/API test owners |
| Coherence | PASS — no obsolete body marker, API behavior, contract or historical Decision rewrite was introduced |
| Findings | 0 critical, 0 warnings, 0 suggestions |

Final assessment: this pure evidence/alias-retirement Change is eligible for
its governed sync/archive transition. The required post-archive full check is
still to be run and is not represented as already complete here.
