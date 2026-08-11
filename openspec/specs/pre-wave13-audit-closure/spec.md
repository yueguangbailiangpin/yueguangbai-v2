# Capability Specification

## Purpose

Defines the evidence-based closure conditions and residual-risk reporting for the Pre-Wave13 baseline conformance audit.

## Requirements

### Requirement: P1-01 closes only after trusted Staff production authentication is implemented and verified

The existing Pre-Wave 13 audit SHALL retain P1-01 until Cloudflare Access assertion verification, D1 email identity mapping, Worker internal Session, current-session APIs, revocation/version semantics, default Staff Session Middleware and production entrypoint E2E are implemented and verified. Every existing Staff and Internal Finance route SHALL receive `staffAuthorization` from the trusted middleware, and direct test Actor or client identity-header injection SHALL not satisfy closure.

#### Scenario: P1-01 closure evidence is complete

- **WHEN** a real default-app E2E authenticates through the Staff login adapter, receives the internal Cookie and successfully reaches representative Staff and Internal Finance routes with D1-recalculated authorization
- **THEN** the audit may mark P1-01 closed and cite the exact Contract, migration, middleware, route and test evidence.

#### Scenario: Any trusted-session link is missing

- **WHEN** login, Session, middleware, production registration, revocation or real entrypoint E2E is absent or only test-injected
- **THEN** P1-01 remains open at P1 severity and the audit remains NO_GO for this blocker.

### Requirement: P1-02 closes only after all three missing HTTP capabilities are reachable and tested

The existing audit SHALL retain P1-02 until the default production app registers reachable File HTTP, Staff Order Evidence and Staff Buyer Refund route families, each with frozen Contract, Permission, Personal DENY, Data Scope, concealment, Idempotency/version, Audit/Outbox and route/E2E coverage. Existing Services without registered HTTP routes SHALL not count as closure.

#### Scenario: All P1-02 route families pass

- **WHEN** authenticated route tests and production entrypoint E2E prove upload/complete/read, evidence list/detail/request-changes/approve and refund list/detail/payment/reversal are reachable and enforce their specifications
- **THEN** the audit may close P1-02 and update frontend readiness for those route families.

#### Scenario: A route family or boundary remains missing

- **WHEN** any required route is unregistered, fail-closed due to missing middleware, lacks Scope/Contract coverage, or real R2 compensation remains unverified
- **THEN** P1-02 remains open or is explicitly classified with the unresolved evidence; it is not downgraded merely because the underlying Service exists.

### Requirement: P1-03 closes through a formal decision clarification that preserves history

The implementation stage SHALL update `docs/decisions/V2_DECISION_REGISTER.md` by preserving D-004 history and adding an explicit superseding decision: Cloudflare Access is the Staff authentication perimeter and proves email only; D1 `staff_users`, email identity and related authorization records are the Staff subject/permission authority; Worker issues the internal Staff Session; Staff APIs do not directly trust Access or client claims; and the former Feishu runtime is retired.

#### Scenario: Decision conflict is formally resolved

- **WHEN** the Decision Register contains the approved clarification and governance/architecture references no longer conflict with the implemented boundary
- **THEN** the audit may close P1-03 and remove `GOVERNANCE_CONFLICT` only with cited decision evidence.

#### Scenario: History is deleted or boundary remains ambiguous

- **WHEN** D-004 is silently removed, an external Provider is still described as permission/Session authority, or the superseding decision is not formally recorded
- **THEN** P1-03 and `GOVERNANCE_CONFLICT` remain open.

### Requirement: Audit closure recounts endpoints and frontend readiness from the implemented production app

After Wave 13 implementation, the existing audit SHALL recount the original 108 registered endpoints plus every added endpoint from the default production app, SHALL publish the new total and SHALL update each affected route family's READY, READY_WITH_LIMITATIONS or NOT_READY status. The count SHALL distinguish registered routes from exported Services and shall identify the auth domain and middleware for every new endpoint.

#### Scenario: Endpoint inventory is reproducible

- **WHEN** the implemented default app route inventory is generated and manually reconciled against Contracts
- **THEN** the audit records the old total, added endpoints, new total, route families, auth/middleware and readiness classification.

#### Scenario: Count relies on source exports or assumptions

- **WHEN** the update counts unregistered functions, omits aliases/routes or cannot reproduce the default-app total
- **THEN** endpoint readiness remains unverified and the audit SHALL not claim P1-02 closure.

### Requirement: Audit closure preserves prior local evidence and records new validation separately

The updated audit SHALL retain the completed Pre-Wave 13 Local Validation Supplement, including its schema 26 and 511-test evidence, and SHALL not revert completed gates to “not executed.” It SHALL add Wave 13 validation with exact date, branch/head, migration results, new test baseline, production Staff E2E, real D1 behavior, R2 failure/compensation, strict OpenSpec validation and actual OpenSpec Verify availability/result.

#### Scenario: New evidence is added without rewriting history

- **WHEN** Wave 13 local/Integration validation is executed
- **THEN** the audit appends a clearly dated supplement that distinguishes earlier baseline evidence from new implementation evidence and reports any changed counts.

#### Scenario: A required validation is unavailable

- **WHEN** OpenSpec Verify, real D1 parity, real R2 fault injection or another required gate cannot be executed
- **THEN** the audit records `NOT_VERIFIED` or an equivalent residual status and does not report it as passed.

### Requirement: Severity, GO/NO_GO and residual risks are recalculated from evidence

The audit update SHALL recalculate P0/P1/P2/P3, NOT_VERIFIED, GOVERNANCE_CONFLICT and overall GO/NO_GO after applying the closure criteria. It SHALL distinguish `CLOSED`, `VERIFIED`, `STILL_OPEN`, `NOT_VERIFIED` and `DEFERRED_TO_BIG_MODULE_7`. A closed P1 SHALL not automatically erase unrelated P2/P3 or DB/R2/Verify residual risks.

#### Scenario: All P1 criteria are met

- **WHEN** P1-01, P1-02 and P1-03 each have complete implementation and verification evidence
- **THEN** their P1 count may become zero, while overall GO/NO_GO is independently recomputed from all remaining findings.

#### Scenario: Residual risk remains

- **WHEN** any security, D1 parity, R2, Verify, deployment or later-module risk remains unverified or deferred
- **THEN** the audit preserves the appropriate severity/status and states why it does or does not block the formal frontend.

### Requirement: Existing audit artifacts are updated as one authoritative record

Wave 13 closure SHALL update the existing `docs/audits/PRE_WAVE13_BASELINE_CONFORMANCE_AUDIT.md`, requirement traceability matrix, frontend API readiness report and the existing `pre-wave13-baseline-conformance-audit` OpenSpec Change. It SHALL NOT create a second competing audit. Every changed finding SHALL cite implementation files, route tests, E2E, migration/behavior results and decisions, and SHALL record the actual final Wave 13 commit.

#### Scenario: Authoritative audit update

- **WHEN** implementation and all required gates finish
- **THEN** one consistent set of existing audit artifacts reflects the same endpoint counts, findings, statuses, decisions and GO/NO_GO result.

#### Scenario: Planning or partial implementation only

- **WHEN** only this Wave 13 planning Change exists or implementation/verification is incomplete
- **THEN** the existing audit remains unchanged, P1 findings remain open and the planning branch does not claim audit closure.
