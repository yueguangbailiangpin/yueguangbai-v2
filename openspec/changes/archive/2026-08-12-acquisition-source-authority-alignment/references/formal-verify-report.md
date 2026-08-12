# Formal Verify: acquisition-source-authority-alignment

Verified on 2026-08-12 Asia/Shanghai against the active proposal, design, tasks, delta specification, current contracts, Decision Register and implementation. Ponytail remained off. The controller authorization in this task permits Verify, then sync/archive only after a clean final Verify; no production, migration, remote or runtime operation was performed.

## Initial scorecard

| Dimension | Result |
| --- | --- |
| Completeness | CRITICAL — 11/12 tasks; V3 was intentionally still unchecked when this first assessment began |
| Correctness | PASS — 3/3 requirements and 5/5 scenarios mapped to implementation, Contract and tests |
| Coherence | PASS — D-035 narrowly supersedes only D-026's obsolete server-derived/no-request-channel clause |
| Findings | 1 critical self-referential task gate, 0 warnings, 1 suggestion |

The initial CRITICAL was not an implementation defect: `tasks.md` V3 deferred this exact Verify/sync/archive workflow pending the now-recorded controller decision. No other CRITICAL or WARNING was found, so V3 was accurately rewritten and checked before final Verify. It did not claim sync or archive completion.

## Requirement and scenario evidence

| Requirement and scenarios | Implementation and Contract evidence | Test and Decision evidence | Result |
| --- | --- | --- | --- |
| Explicit controlled source declaration; legal direct source; invalid declaration rejected | `apps/api/src/acquisition/routes.ts:116-120` exact-closes the request and applies same-origin middleware. `apps/api/src/acquisition/leads.ts:54-61` requires trusted duty and marketplace scope, then validates an ACTIVE, matching audience/market channel. `packages/contracts/src/acquisition.ts:46-54`; `docs/contracts/STAFF_ACQUISITION_FUNNEL.md:11-15` publish the boundary. | `apps/api/src/acquisition/acquisition.test.ts:31-69` proves legal direct creation, safe DTO and immutable origin; `:72-98` proves disabled, wrong-audience, wrong-market and out-of-scope rejection. D-035 is `docs/decisions/V2_DECISION_REGISTER.md:280-286`. | PASS |
| Prospect-to-Lead exact origin inheritance; mismatched Prospect source rejected | `apps/api/src/acquisition/leads.ts:65-70` requires type, marketplace and origin channel equality before any write; `:85-110` persists inherited facts and converts only after validation. | `apps/api/src/acquisition/acquisition.test.ts:100-126` covers mismatch rejection and exact inherited channel/source URL. Contract: `docs/contracts/STAFF_ACQUISITION_FUNNEL.md:12`. | PASS |
| Original source immutable and correction controlled; correction leaves projection safe | Original source/creator are stored with immutable audit facts in `apps/api/src/acquisition/leads.ts:85-104`; safe projection omits protected source fields in `:221-242` and `packages/contracts/src/acquisition.ts:161-180`. Append-only correction plus audit is `apps/api/src/acquisition/reporting-operations.ts:86-106`. | `apps/api/src/acquisition/acquisition.test.ts:31-69` proves trigger-backed immutability and safe DTO behavior. Contract: `docs/contracts/STAFF_ACQUISITION_FUNNEL.md:14,28`; D-035: `docs/decisions/V2_DECISION_REGISTER.md:282-284`. | PASS |

## Coherence review

- The proposal's no-runtime-change boundary matches the inspected implementation: the governance diff changes tests, contracts, Decisions and verifiers, not the production Lead route/domain behavior.
- The design's client-data/not-client-authority distinction is implemented by server-side duty, scope, status, audience and marketplace checks before the D1 write.
- Migration discipline is preserved: this task's baseline check found no diff under `migrations/`.

## Findings

### CRITICAL

- Initial only: V3 in `tasks.md:25` was incomplete. Resolved under the explicit controller authorization after confirming there were no other blocking findings.

### WARNING

- None.

### SUGGESTION

- Add a focused D1 test for `correctLeadSource` that asserts both append-only correction rows and `ACQUISITION_SOURCE_CORRECTED` audit output. The current code and immutable-origin test prove the boundary, but this would make the correction path independently regression-proof.

## Final scorecard

| Dimension | Result |
| --- | --- |
| Completeness | PASS — 12/12 tasks; all required artifacts are complete |
| Correctness | PASS — 3/3 requirements and 5/5 scenarios match the current implementation, Contract, Decision and evidence suite |
| Coherence | PASS — proposal, design, D-035 and retained D-026 history agree with the implemented fail-closed boundary |
| Findings | 0 critical, 0 warnings, 1 suggestion |

Final assessment: all blocking findings are resolved. The Change is eligible for its governed spec sync and archive. The suggestion above is retained but non-blocking.
