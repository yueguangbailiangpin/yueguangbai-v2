# Design: Remote Baseline Conformance Audit

## 1. Audit Model

This change performs a remote, static, semantic audit of formal `main`. It does not execute the application, OpenSpec CLI, Vitest, D1, Wrangler, or verifier scripts.

The audit compares six evidence layers:

1. Authority: `AGENTS.md`, governance, decisions, product rules, contracts, architecture, and migration documents in their defined authority order.
2. Production implementation: routes, services, domain functions, SQL statements, projections, and authorization boundaries.
3. Contracts: request/response DTOs, enums, error codes, serialization rules, and public field shapes.
4. Tests: actual test source and named test behavior where identified.
5. Database: migrations, constraints, unique indexes, triggers, views, transaction assertions, audit tables, outbox, and idempotency records.
6. Verifiers/runtime history: verifier source plus historical formal acceptance records.

Audit documents are never implementation evidence for their own conclusions.

## 2. Authority Resolution

Authority conflicts are resolved according to `AGENTS.md`. If two current formal sources conflict, the audit records `GOVERNANCE_CONFLICT`; it does not silently select the convenient source and does not modify either source.

Chat memory, old repositories, file-name inference, industry convention, and test names without source inspection are not authority.

## 3. Evidence Strength

### Strong evidence

- production implementation source;
- matching contract;
- matching test source;
- database constraint/trigger/migration where relevant;
- multiple layers agreeing on the same behavior.

### Medium evidence

- implementation without a key test;
- test without complete production path evidence;
- static verifier only;
- database protection without API coverage;
- API coverage without a database backstop.

### Weak evidence

- documentation alone;
- symbol or file name alone;
- comments alone;
- conversation history;
- inference;
- an unlocated implementation path.

Weak evidence cannot produce `PASS` by itself.

## 4. Requirement Status

- `PASS`: current source evidence supports the requirement without a material contradiction.
- `PARTIAL`: part of the requirement is supported, but a meaningful layer, route, test, scope, or consistency guarantee is incomplete.
- `FAIL`: evidence confirms the current baseline does not meet the requirement.
- `NOT_VERIFIED`: available remote evidence is insufficient to determine compliance.
- `GOVERNANCE_CONFLICT`: current authoritative sources conflict and the conflict changes the required behavior or contract.

The audit never uses `FAIL` as a substitute for “evidence not found.”

## 5. Runtime Evidence Labels

- `PREVIOUSLY_VALIDATED`: result belongs to the formally accepted historical Integration baseline.
- `NOT_RUN_IN_THIS_AUDIT`: source was inspected remotely but no runtime command was run in this audit.
- `LOCAL_VALIDATION_REQUIRED`: local execution is required before release or contract freeze.

## 6. Risk Model

### P0

Confirmed cross-tenant access, authentication bypass, internal finance disclosure to Buyer/Seller, direct mutation/deletion of financial facts, confirmed data loss, or an unrecoverable production disaster path.

### P1

High-probability authorization or integrity gap, a contract the formal frontend cannot safely use, bypassable critical state machine, missing critical database constraint, severe idempotency/audit/outbox defect, or incorrect finance formula.

### P2

Important test evidence gap, unstable errors/pagination, capacity risk, incomplete defense layer, or an issue that should be fixed before launch without proof of immediate disaster.

### P3

Documentation, naming, duplication, low-risk maintainability, or ordinary technical debt. These areas may be candidates for a later Ponytail review if they remain outside permanent exclusions.

## 7. API Readiness

Each real registered route is inventoried by method and path and classified:

- `READY`: implementation, authorization domain, scope, DTO, pagination/error behavior, and required frontend action are sufficiently stable.
- `READY_WITH_LIMITATIONS`: usable after explicitly documented constraints or small contract fixes.
- `NOT_READY`: a known blocker prevents safe formal frontend dependence.
- `NOT_VERIFIED`: remote evidence is insufficient.

Staff APIs are not considered frontend-ready merely because handlers fail closed. A trusted production mechanism must create `staffAuthorization` before a Staff route can be `READY`.

## 8. Remote Semantic Verification

`REMOTE_SEMANTIC_VERIFY` compares every change requirement against current `main` implementation, contracts, test source, migrations, and verifiers. Its result vocabulary is:

- `COMPLETE`
- `PARTIAL`
- `MISSING`
- `INCONSISTENT`
- `NOT_VERIFIED`

This is not `$openspec-verify-change` and is not OpenSpec CLI verification. Local Codex must still run the actual CLI and repository validation gates.

## 9. Database Baseline Treatment

The following values are historical accepted baseline facts, not audit executions:

- migrations: `0001–0026`;
- schema version: `26`;
- application tables: `113`;
- triggers: `213`;
- views: `10`;
- test files: `99`;
- tests: `511`.

The audit may inspect the source that defines or checks them. It must label the runtime result `PREVIOUSLY_VALIDATED` and request local revalidation.

## 10. Safety and Write Boundary

Only these paths may change:

- `openspec/changes/pre-wave13-baseline-conformance-audit/**`;
- `docs/audits/PRE_WAVE13_BASELINE_CONFORMANCE_AUDIT.md`;
- `docs/audits/PRE_WAVE13_REQUIREMENT_TRACEABILITY_MATRIX.md`;
- `docs/audits/PRE_WAVE13_FRONTEND_API_READINESS.md`.

No production code, contract, test, migration, workflow, package file, deployment file, authoritative source, or existing specification is modified.
