# Change Proposal: Pre-Wave 13 Baseline Conformance Audit

## Why

Big Module 5 formal frontend work is about to depend on the current backend contracts, identity boundaries, authorization scopes, state machines, file access rules, date semantics, and financial projections. Before those interfaces are frozen, the project needs a current-state evidence baseline showing what the formal `main` branch actually implements and what remains unsafe or unverified.

This change is **not** a historical specification for Waves 1–12. It is a present-state audit change created against formal `main` at `f28c52a36e9498c37453a4a12755d9ad8459ae65`.

## Scope

The audit covers the current formal baseline only:

- migrations `0001` through `0026`;
- schema version `26` and the previously accepted schema counts;
- Buyer APIs and DTOs;
- Seller APIs and DTOs;
- Staff APIs and authorization context;
- Internal Finance APIs, formulas, exports, and privacy boundaries;
- File upload, verification, linking, audience grants, read intents, and cleanup;
- contracts under `packages/contracts/src/**`;
- domain rules under `packages/domain/src/**`;
- production API implementation under `apps/api/src/**`;
- verifier source under `scripts/**`;
- relevant test source and previously accepted validation evidence.

## Out of Scope

- changing production implementation;
- adding or changing business behavior;
- fixing findings;
- adding migration `0027` or any migration;
- rewriting Waves 1–12 as if they had used OpenSpec;
- changing authoritative documents to match implementation;
- running local tests, D1, Wrangler, OpenSpec CLI, or Ponytail;
- deployment, Integration, PR creation, or advancing `main`;
- starting Big Module 5 frontend implementation.

## Expected Outputs

1. A current-state OpenSpec requirement baseline for the audit.
2. A requirement–implementation–test–database traceability matrix.
3. A formal frontend API readiness inventory with real methods and paths.
4. A risk-ranked audit report with P0–P3 findings.
5. A `REMOTE_SEMANTIC_VERIFY` result that is explicitly distinct from OpenSpec CLI verification.
6. A GO / GO_WITH_BLOCKERS_TO_FIX / NO_GO recommendation.
7. A list of local validation requests.
8. A low-risk Ponytail review candidate list and a permanent exclusion list.

## Success Criteria

- Every required AUTH, FIN, FILE, FLOW, API, and DB requirement has a fixed status: `PASS`, `PARTIAL`, `FAIL`, `NOT_VERIFIED`, or `GOVERNANCE_CONFLICT`.
- Evidence distinguishes production source, contracts, tests, database constraints, verifiers, and runtime validation history.
- Historical accepted counts are labelled `PREVIOUSLY_VALIDATED`, never as commands run in this audit.
- Frontend-blocking findings are explicit and mapped to affected APIs/contracts.
- No file outside the allowed audit paths is modified.

## Rollback

Rollback consists only of reverting the audit documentation commits. This change introduces no production behavior, schema, contract, test, workflow, deployment, or data change.
