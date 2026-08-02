# Baseline Conformance Requirements

This specification defines the requirements against which the current formal `main` baseline is audited. It is not a historical Wave 1–12 specification. Each requirement has one audit scenario; implementation evidence and classification are recorded in the audit matrix.

## Identity and Authorization

### Requirement: AUTH-001 Identity domains are separated
Buyer, Seller, and Staff identities SHALL remain distinct authorization domains.
#### Scenario: Domain separation is audited
- **WHEN** authentication, session, and actor construction paths are inspected
- **THEN** Buyer, Seller, and Staff contexts are classified for separation and trust.

### Requirement: AUTH-002 Sessions come from trusted backend context
All three session types SHALL be created only from trusted backend verification.
#### Scenario: Session origin is audited
- **WHEN** production entrypoints and middleware are inspected
- **THEN** every session-producing path is located or classified missing.

### Requirement: AUTH-003 Authority fields are server controlled
Clients SHALL NOT submit or determine staff_id, role, permission, scope, owner, system_owner, authoritative organization_id, seller_id, or buyer_id.
#### Scenario: Authority injection is audited
- **WHEN** request parsers and actor builders are inspected
- **THEN** client-controlled authority fields are rejected or ignored in favor of trusted context.

### Requirement: AUTH-004 Staff authorization fails closed
A request without trusted Staff authorization SHALL fail closed.
#### Scenario: Empty Staff context is audited
- **WHEN** a Staff route has no trusted authorization context
- **THEN** the route must not execute protected behavior.

### Requirement: AUTH-005 Inactive Staff are rejected
Inactive Staff identities SHALL NOT receive an effective authorization context.
#### Scenario: Inactive status is audited
- **WHEN** Staff identity resolution encounters an inactive staff or identity row
- **THEN** authorization is denied.

### Requirement: AUTH-006 Personal DENY wins
An active personal DENY SHALL take final precedence over role defaults, grants, and leader permissions.
#### Scenario: DENY precedence is audited
- **WHEN** the same permission is otherwise granted
- **THEN** the effective permission set excludes it.

### Requirement: AUTH-007 Owner meanings are distinct
System owner SHALL remain distinct from Seller Organization OWNER.
#### Scenario: Owner semantics are audited
- **WHEN** owner checks are inspected
- **THEN** organization membership cannot satisfy system-owner checks.

### Requirement: AUTH-008 Financial view is owner-only
FINANCIAL_VIEW SHALL require an active Staff system owner.
#### Scenario: Financial view authorization is audited
- **WHEN** internal finance read routes are inspected
- **THEN** both active Staff and system-owner permission checks are present.

### Requirement: AUTH-009 Financial export has an extra permission
FINANCIAL_EXPORT SHALL be required in addition to FINANCIAL_VIEW.
#### Scenario: Export authorization is audited
- **WHEN** CSV export is requested
- **THEN** the additional export permission is enforced.

### Requirement: AUTH-010 Settlement view is not financial view
SELLER_SETTLEMENT_VIEW SHALL NOT substitute for FINANCIAL_VIEW.
#### Scenario: Permission substitution is audited
- **WHEN** settlement and internal-finance routes are compared
- **THEN** settlement permission cannot unlock internal finance.

### Requirement: AUTH-011 Scope and projection follow permission
Permission checks SHALL be followed by data-scope enforcement and safe field projection.
#### Scenario: Scope-after-permission is audited
- **WHEN** protected resource reads are inspected
- **THEN** tenant/team scope and DTO projection are independently enforced.

### Requirement: AUTH-012 404 and 403 policy is consistent
Unauthorized resource handling SHALL follow the formal 404/403 disclosure policy.
#### Scenario: Resource concealment is audited
- **WHEN** cross-scope and missing resources are requested
- **THEN** response status and public message follow the documented policy.

### Requirement: AUTH-013 Buyer DTO privacy
Buyer DTOs SHALL exclude Staff-only data and internal finance.
#### Scenario: Buyer projection is audited
- **WHEN** Buyer response builders and contracts are inspected
- **THEN** internal Staff and finance fields are absent.

### Requirement: AUTH-014 Seller DTO privacy
Seller DTOs SHALL exclude Buyer Refund cost, internal profit, and other Seller data.
#### Scenario: Seller projection is audited
- **WHEN** Seller response builders and contracts are inspected
- **THEN** forbidden internal and cross-Seller fields are absent.

### Requirement: AUTH-015 Authorization edge cases are tested
GRANT, DENY, inactive, cross-tenant, and empty-context behavior SHALL have test evidence.
#### Scenario: Authorization coverage is audited
- **WHEN** authorization tests are inspected
- **THEN** each required edge case is located or classified incomplete.

## Financial Facts

### Requirement: FIN-001 JPY is integer
JPY financial facts SHALL use integers.
#### Scenario: JPY representation is audited
- **WHEN** schemas, contracts, and calculations are inspected
- **THEN** JPY facts are integer-valued.

### Requirement: FIN-002 CNY is integer fen
CNY financial facts SHALL use integer fen.
#### Scenario: CNY representation is audited
- **WHEN** CNY fields are inspected
- **THEN** amounts use cny_fen integer semantics.

### Requirement: FIN-003 Exchange rate scale
Exchange rates SHALL use cny_per_jpy_e8.
#### Scenario: Rate representation is audited
- **WHEN** pricing and snapshot fields are inspected
- **THEN** rate scale is e8 and not floating point.

### Requirement: FIN-004 No REAL or FLOAT facts
Financial facts SHALL NOT use REAL or FLOAT storage.
#### Scenario: Database affinity is audited
- **WHEN** migrations and views are inspected
- **THEN** financial storage avoids REAL and FLOAT.

### Requirement: FIN-005 No parseFloat or toFixed calculations
Financial calculations SHALL NOT use parseFloat or toFixed.
#### Scenario: Calculation source is audited
- **WHEN** finance source and verifiers are inspected
- **THEN** prohibited floating-point helpers are absent from fact calculations.

### Requirement: FIN-006 JSON money is decimal string
Financial amounts exposed in JSON SHALL use stable decimal strings where required by contract.
#### Scenario: Money serialization is audited
- **WHEN** finance DTO builders are inspected
- **THEN** large integer amounts are serialized without precision loss.

### Requirement: FIN-007 Financial facts are immutable
Financial facts SHALL NOT be overwritten in place.
#### Scenario: Mutation protection is audited
- **WHEN** ledger and snapshot tables are inspected
- **THEN** original facts remain immutable.

### Requirement: FIN-008 Corrections use reversal and new facts
Corrections SHALL use reversal facts and new facts.
#### Scenario: Correction flow is audited
- **WHEN** payment/refund correction commands are inspected
- **THEN** history is preserved through reversal and replacement entries.

### Requirement: FIN-009 Formal Order creates principal due
Formal Order confirmation SHALL create Seller Principal Due.
#### Scenario: Principal creation is audited
- **WHEN** formal-order confirmation is inspected
- **THEN** the principal payable is produced atomically or reconciled deterministically.

### Requirement: FIN-010 Review approval creates service fee due
Approved Review SHALL create Service Fee Due.
#### Scenario: Service-fee creation is audited
- **WHEN** review approval is inspected
- **THEN** the service-fee payable is produced exactly once.

### Requirement: FIN-011 Buyer Refund ledger is independent
Buyer Refund facts SHALL remain independent of Seller settlement facts.
#### Scenario: Ledger separation is audited
- **WHEN** refund and settlement schemas are compared
- **THEN** each ledger preserves its own facts and balances.

### Requirement: FIN-012 Seller payment supports full allocation lifecycle
Seller Payment SHALL support split allocation, allocation, reversal, reallocation, and unallocated credit.
#### Scenario: Payment lifecycle is audited
- **WHEN** settlement commands and views are inspected
- **THEN** each lifecycle action is represented without destructive mutation.

### Requirement: FIN-013 Buyer Refund supports payment, reversal, and OVERPAID
Buyer Refund SHALL support payment entries, reversal entries, and OVERPAID state.
#### Scenario: Refund lifecycle is audited
- **WHEN** refund ledger behavior is inspected
- **THEN** net paid, outstanding, and overpaid values are derived from facts.

### Requirement: FIN-014 Projected Gross Profit formula
Projected Gross Profit SHALL equal seller expected principal plus service fee minus buyer expected principal.
#### Scenario: Projected formula is audited
- **WHEN** finance views and tests are inspected
- **THEN** the formula and null/conflict behavior match authority.

### Requirement: FIN-015 Completed Gross Profit formula
Completed Gross Profit SHALL use completed/approved facts according to the formal formula.
#### Scenario: Completed formula is audited
- **WHEN** completed-profit derivation is inspected
- **THEN** only qualifying completed facts contribute.

### Requirement: FIN-016 Attributed Cash formula
Attributed Cash SHALL use net attributed seller allocation cash minus Buyer Refund net paid for the order.
#### Scenario: Attributed cash is audited
- **WHEN** allocation and refund facts are joined
- **THEN** reversals are reflected and unrelated cash is excluded.

### Requirement: FIN-017 Company Cash Flow formula
Company Cash Flow SHALL use seller cash inflow and reversals minus Buyer Refund outflow and reversals under cash-date semantics.
#### Scenario: Cash flow is audited
- **WHEN** cash-flow aggregation is inspected
- **THEN** signs, reversals, dates, and organization filters are correct.

### Requirement: FIN-018 Missing facts are not guessed as zero
Missing or conflicting facts SHALL NOT be silently treated as valid zero facts.
#### Scenario: Conflict classification is audited
- **WHEN** required snapshots/payables/events are absent or duplicated
- **THEN** the finance position is null or conflict-classified.

### Requirement: FIN-019 Internal finance view authorization
Internal finance viewing SHALL require system owner plus FINANCIAL_VIEW.
#### Scenario: View permission is audited
- **WHEN** internal finance read routes execute
- **THEN** both owner role and permission are required.

### Requirement: FIN-020 Export authorization
Internal finance export SHALL additionally require FINANCIAL_EXPORT.
#### Scenario: Export permission is audited
- **WHEN** an export route executes
- **THEN** FINANCIAL_EXPORT is required after view authorization.

### Requirement: FIN-021 Export audit integrity
Each export SHALL create Audit, Outbox, and SHA-256 evidence.
#### Scenario: Export evidence is audited
- **WHEN** CSV bytes are produced
- **THEN** immutable metadata, audit event, outbox event, and output digest are recorded atomically.

### Requirement: FIN-022 CSV is ephemeral
CSV bytes SHALL NOT be persisted to R2, stored as a permanent file, or exposed through a permanent URL.
#### Scenario: Export persistence is audited
- **WHEN** export implementation is inspected
- **THEN** bytes are returned synchronously and only audit metadata persists.

### Requirement: FIN-023 CSV output limits
CSV output SHALL be limited to 50000 rows and 25 MiB.
#### Scenario: Export bounds are audited
- **WHEN** source collection and serialization are inspected
- **THEN** both row and byte limits are enforced before success.

### Requirement: FIN-024 CSV safety format
CSV SHALL use UTF-8 BOM, CRLF, RFC4180 quoting, and formula-injection protection.
#### Scenario: CSV encoding is audited
- **WHEN** serializer and tests are inspected
- **THEN** all four safety requirements are evidenced.

### Requirement: FIN-025 Customer finance privacy
Buyer and Seller APIs SHALL fully isolate internal profit and Buyer Refund cost.
#### Scenario: Customer finance projection is audited
- **WHEN** customer DTOs are inspected
- **THEN** prohibited internal finance fields are absent.

## File Security

### Requirement: FILE-001 Upload intent
Uploads SHALL begin with an upload intent.
#### Scenario: Upload initiation is audited
- **WHEN** file creation services are inspected
- **THEN** object creation is bound to a recorded intent.

### Requirement: FILE-002 Pre-upload checks
Authorization, duplicate, count, size, and capacity checks SHALL occur before upload acceptance.
#### Scenario: Preflight is audited
- **WHEN** upload-intent creation is inspected
- **THEN** invalid or over-capacity requests fail before durable acceptance.

### Requirement: FILE-003 Post-upload HEAD verification
Uploaded objects SHALL be verified by object-storage HEAD/metadata checks.
#### Scenario: Object verification is audited
- **WHEN** completion runs
- **THEN** stored size, MIME, and digest metadata are checked.

### Requirement: FILE-004 VERIFIED state
Only successfully verified uploads SHALL enter VERIFIED state.
#### Scenario: Verification transition is audited
- **WHEN** completion succeeds
- **THEN** both intent and file objects transition atomically to VERIFIED.

### Requirement: FILE-005 Entity link
Usable files SHALL be linked to explicit entities.
#### Scenario: Entity linking is audited
- **WHEN** a file becomes business evidence
- **THEN** a versioned entity link identifies its purpose and target.

### Requirement: FILE-006 Audience grant
Customer-visible files SHALL require an explicit audience grant.
#### Scenario: Audience grant is audited
- **WHEN** a customer read is authorized
- **THEN** current grant and business scope are checked.

### Requirement: FILE-007 Short read intent
Reads SHALL use a short-lived read intent.
#### Scenario: Read-intent lifetime is audited
- **WHEN** a client requests a file
- **THEN** the response contains an expiring access token rather than a permanent URL.

### Requirement: FILE-008 Dynamic read authorization
Authorization SHALL be re-evaluated when a file read intent is created and consumed.
#### Scenario: Dynamic authorization is audited
- **WHEN** scope, grant, or resource status changes
- **THEN** stale access does not remain valid indefinitely.

### Requirement: FILE-009 object_key privacy
object_key SHALL NOT enter client DTOs.
#### Scenario: Storage-key projection is audited
- **WHEN** file DTOs and routes are inspected
- **THEN** object storage keys remain server-side.

### Requirement: FILE-010 No permanent URL
Permanent object URLs SHALL NOT be stored.
#### Scenario: URL persistence is audited
- **WHEN** schemas and services are inspected
- **THEN** only object keys and short-lived intent data persist.

### Requirement: FILE-011 Client cannot define authority
Clients SHALL NOT choose authoritative owner, scope, or audience grant.
#### Scenario: File authority input is audited
- **WHEN** upload/link/read request parsers are inspected
- **THEN** authoritative ownership and scope come from trusted actor/business context.

### Requirement: FILE-012 R2 failure compensation
R2/object-storage failure SHALL produce compensation behavior.
#### Scenario: Storage failure is audited
- **WHEN** object verification or database finalization fails
- **THEN** deletion is attempted and residual work is recorded for retry.

### Requirement: FILE-013 Residual cleanup is retry-safe
Residual object cleanup SHALL be idempotent and safely retryable.
#### Scenario: Cleanup retry is audited
- **WHEN** deletion fails repeatedly
- **THEN** retry metadata prevents unsafe duplication or lost cleanup work.

### Requirement: FILE-014 Purpose and audience isolation
File purpose and audience SHALL be isolated.
#### Scenario: Purpose isolation is audited
- **WHEN** a file is linked or read
- **THEN** an unrelated purpose or visibility cannot reuse it.

### Requirement: FILE-015 Settlement proof authorization
Seller Settlement Proof SHALL use current Staff/Seller scope and dedicated file authorization.
#### Scenario: Settlement proof read is audited
- **WHEN** a proof read intent is requested
- **THEN** settlement permission, organization scope, file version, and dynamic authorization are checked.

### Requirement: FILE-016 One order-evidence screenshot
Order evidence SHALL contain exactly one screenshot.
#### Scenario: Screenshot count is audited
- **WHEN** order evidence is submitted or resubmitted
- **THEN** the domain accepts exactly one verified image.

### Requirement: FILE-017 File security edge cases are tested
Unauthorized, expired, revoked, and duplicate-binding cases SHALL have test evidence.
#### Scenario: File edge coverage is audited
- **WHEN** file tests are inspected
- **THEN** each required denial path is located or classified incomplete.

## Business State Machines

### Requirement: FLOW-001 Buyer registration and identity
Buyer registration and identity SHALL follow the formal self-registration/authentication flow.
#### Scenario: Registration is audited
- **WHEN** registration is requested
- **THEN** rate limit, optional human verification, identity uniqueness, password rules, audit, and session establishment are enforced.

### Requirement: FLOW-002 Reservation and slot occupation
Reservation creation SHALL atomically occupy capacity.
#### Scenario: Capacity occupation is audited
- **WHEN** a Buyer reserves an open demand
- **THEN** capacity/version constraints prevent overbooking.

### Requirement: FLOW-003 Self-pay disclosure and acceptance
Buyer self-pay rules SHALL be shown and explicitly accepted before reservation.
#### Scenario: Self-pay acceptance is audited
- **WHEN** a reservation is submitted
- **THEN** the accepted basis points and demand version are validated and recorded.

### Requirement: FLOW-004 Instruction task after approval
Reservation approval SHALL create the order-instruction publication task.
#### Scenario: Publication task is audited
- **WHEN** a reservation becomes approved
- **THEN** the corresponding Staff work item/instruction aggregate exists exactly once.

### Requirement: FLOW-005 Versioned order instruction
Order instructions SHALL be versioned.
#### Scenario: Instruction history is audited
- **WHEN** publication changes
- **THEN** immutable versions and current aggregate version are retained.

### Requirement: FLOW-006 Safe product main image
Product main image SHALL be exposed only through safe file reads.
#### Scenario: Main-image read is audited
- **WHEN** a Buyer reads an instruction image
- **THEN** a scoped short read intent is created.

### Requirement: FLOW-007 Ordered keyword PNG
Instruction keywords SHALL produce ordered PNG assets.
#### Scenario: Keyword assets are audited
- **WHEN** instruction assets are prepared
- **THEN** keyword order, generator output, and PNG file records are deterministic and versioned.

### Requirement: FLOW-008 Initial six-hour deadline
Initial order submission SHALL have a six-hour deadline.
#### Scenario: Initial deadline is audited
- **WHEN** an instruction is first published
- **THEN** the snapshot deadline is six hours and insufficient windows are rejected.

### Requirement: FLOW-009 Two-hour correction deadline
Requested order-data corrections SHALL have a two-hour deadline.
#### Scenario: Resubmission deadline is audited
- **WHEN** changes are requested
- **THEN** a two-hour resubmission deadline is recorded and enforced.

### Requirement: FLOW-010 One order screenshot
Order submission SHALL require exactly one screenshot.
#### Scenario: Order evidence cardinality is audited
- **WHEN** evidence is submitted
- **THEN** exactly one verified order-evidence image is linked.

### Requirement: FLOW-011 PRICE_MISMATCH
A paid-price mismatch SHALL be represented by PRICE_MISMATCH behavior.
#### Scenario: Price mismatch is audited
- **WHEN** final paid JPY differs from the instruction amount under formal rules
- **THEN** the submission enters the defined conflict/review path.

### Requirement: FLOW-012 Buyer self-pay finance snapshot
Formal order creation SHALL preserve the Buyer self-pay financial snapshot.
#### Scenario: Financial snapshot is audited
- **WHEN** evidence is confirmed into a formal order
- **THEN** immutable self-pay, principal, fee, and rate facts are captured.

### Requirement: FLOW-013 Formal order linkage
Approved evidence SHALL link to exactly one formal order.
#### Scenario: Formal-order linkage is audited
- **WHEN** Staff confirms order evidence
- **THEN** reservation, evidence, instruction, snapshot, and formal order are atomically linked.

### Requirement: FLOW-014 Amazon order number uniqueness
Amazon order number ownership SHALL be enforced by the database.
#### Scenario: Order-number claim is audited
- **WHEN** the same normalized marketplace order number is reused
- **THEN** the active unique claim prevents double ownership or routes historical conflicts to review.

### Requirement: FLOW-015 Expiry and slot release
Expired reservations/instructions SHALL release capacity according to formal rules.
#### Scenario: Expiry release is audited
- **WHEN** a deadline passes
- **THEN** state, capacity, audit, outbox, and related tasks are reconciled without double release.

### Requirement: FLOW-016 Reconciliation
State-machine reconciliation SHALL be idempotent and bounded.
#### Scenario: Reconciliation is audited
- **WHEN** a derived task, deadline, payable, or file asset is missing
- **THEN** reconciliation repairs or records a conflict without destructive guessing.

### Requirement: FLOW-017 Review submission and approval metadata
Review submission, resubmission, decisions, evidence versions, and metadata SHALL be retained.
#### Scenario: Review lifecycle is audited
- **WHEN** a review changes state
- **THEN** version, actor, public/internal notes, files, and event history are recorded.

### Requirement: FLOW-018 Service fee after review approval
Review approval SHALL create the service-fee receivable/payable exactly once.
#### Scenario: Approval financial effect is audited
- **WHEN** a review is approved or replayed
- **THEN** one service-fee due fact exists.

### Requirement: FLOW-019 Buyer Refund status and payment facts
Buyer Refund status SHALL be derived from independent obligation and payment facts.
#### Scenario: Refund status is audited
- **WHEN** payments and reversals change
- **THEN** due, net paid, outstanding, overpaid, and public status remain consistent.

### Requirement: FLOW-020 Idempotent replay
Command retries SHALL return the committed result without duplicating side effects.
#### Scenario: Replay is audited
- **WHEN** the same actor/action/key/hash is repeated
- **THEN** the original result is replayed and conflicting payloads are rejected.

### Requirement: FLOW-021 Optimistic concurrency
Mutations SHALL use expected_version or an equivalent concurrency assertion.
#### Scenario: Version conflict is audited
- **WHEN** a stale client mutates an aggregate
- **THEN** the command fails with a stable version conflict.

### Requirement: FLOW-022 Audit and Outbox
Material state transitions SHALL create Audit and Outbox evidence.
#### Scenario: Side-effect evidence is audited
- **WHEN** a command commits
- **THEN** state, audit, outbox, and idempotency completion are transactionally consistent.

### Requirement: FLOW-023 Clients cannot skip states
Clients SHALL NOT directly select authoritative next states.
#### Scenario: Transition control is audited
- **WHEN** request bodies are inspected
- **THEN** commands accept business inputs and the server determines state transitions.

## API, Contract, and DTO

### Requirement: API-001 Exact-key validation
Mutation contracts SHALL use exact-key validation.
#### Scenario: Request-key strictness is audited
- **WHEN** JSON request parsers are inspected
- **THEN** unknown keys are rejected or the limitation is recorded.

### Requirement: API-002 Unknown query parameters are rejected
Public list/filter APIs SHALL reject unknown or repeated parameters.
#### Scenario: Query strictness is audited
- **WHEN** query parsers are inspected
- **THEN** unsupported and repeated parameters produce validation errors.

### Requirement: API-003 Pagination is stable and bounded
Pagination SHALL be stable, deterministic, and bounded.
#### Scenario: Page behavior is audited
- **WHEN** list APIs are inspected
- **THEN** limits, sort keys, and next-cursor behavior are explicit.

### Requirement: API-004 Large data avoids OFFSET
Large datasets SHALL NOT rely on unbounded OFFSET pagination.
#### Scenario: Pagination strategy is audited
- **WHEN** read models are inspected
- **THEN** keyset/cursor iteration is used for large formal datasets.

### Requirement: API-005 Cursor validation is strict
Cursors SHALL be bounded, structured, and strictly validated.
#### Scenario: Cursor validation is audited
- **WHEN** malformed cursors are supplied
- **THEN** they fail with a stable validation error.

### Requirement: API-006 Error codes are stable
Public error codes SHALL be stable across routes for equivalent conditions.
#### Scenario: Error mapping is audited
- **WHEN** module error maps are compared
- **THEN** semantically equivalent conditions use documented codes.

### Requirement: API-007 404/403 behavior is consistent
API resource disclosure behavior SHALL be consistent with authorization policy.
#### Scenario: Error disclosure is audited
- **WHEN** missing and out-of-scope resources are compared
- **THEN** status and message behavior is intentional and documented.

### Requirement: API-008 Empty results are stable
Empty list results SHALL preserve the normal page structure.
#### Scenario: Empty page is audited
- **WHEN** a list query has no matches
- **THEN** items, pagination metadata, and cursor shape remain stable.

### Requirement: API-009 Money serialization is stable
Money fields SHALL have stable integer or decimal-string serialization.
#### Scenario: Money contract is audited
- **WHEN** Buyer, Seller, Staff, and finance DTOs are inspected
- **THEN** no client-visible precision ambiguity exists.

### Requirement: API-010 Date semantics are explicit
UTC timestamps and business-date strings SHALL have explicit semantics.
#### Scenario: Date contract is audited
- **WHEN** route filters and DTOs are inspected
- **THEN** epoch timestamps and YYYY-MM-DD business dates are distinguishable.

### Requirement: API-011 Buyer and Seller projections are safe
Buyer and Seller APIs SHALL use domain-specific safe projections.
#### Scenario: Projection boundaries are audited
- **WHEN** response DTO builders are inspected
- **THEN** internal and cross-tenant fields are excluded.

### Requirement: API-012 Internal IDs are minimized
Unnecessary internal identifiers SHALL NOT be exposed.
#### Scenario: Identifier exposure is audited
- **WHEN** DTO fields are reviewed
- **THEN** exposed identifiers have a frontend/business purpose.

### Requirement: API-013 Required frontend actions exist
Every formal frontend action SHALL have a reachable, authorized API.
#### Scenario: Capability coverage is audited
- **WHEN** frontend workflows are mapped to registered routes
- **THEN** missing or unreachable actions are classified NOT_READY.

### Requirement: API-014 Overlapping APIs are reconciled
APIs with overlapping meaning SHALL have one clear source of truth.
#### Scenario: Route overlap is audited
- **WHEN** similar routes and DTOs are compared
- **THEN** semantic conflicts or duplicate authorities are identified.

### Requirement: API-015 Frontend contracts are freezeable
Contracts required by Big Module 5 SHALL be stable enough to freeze before implementation.
#### Scenario: Freeze candidates are audited
- **WHEN** readiness is summarized
- **THEN** each required contract is marked freeze-ready, limited, blocked, or unverified.

## Migration and Database Integrity

### Requirement: DB-001 Consecutive migrations
The migration chain SHALL be consecutive from 0001 through 0026.
#### Scenario: Migration continuity is audited
- **WHEN** migration files and schema assertions are inspected
- **THEN** no number is missing or duplicated.

### Requirement: DB-002 Schema version 26
Schema version 26 SHALL have formal accepted evidence.
#### Scenario: Schema version evidence is audited
- **WHEN** baseline records and 0026 are inspected
- **THEN** the result is labelled PREVIOUSLY_VALIDATED and locally revalidation-pending.

### Requirement: DB-003 Application table count
The accepted application table count SHALL be 113.
#### Scenario: Table-count evidence is audited
- **WHEN** schema tests/verifiers are inspected
- **THEN** 113 is recorded as historical runtime evidence, not a new run.

### Requirement: DB-004 Trigger count
The accepted trigger count SHALL be 213.
#### Scenario: Trigger-count evidence is audited
- **WHEN** schema tests/verifiers are inspected
- **THEN** 213 is recorded as historical runtime evidence, not a new run.

### Requirement: DB-005 View count
The accepted view count SHALL be 10.
#### Scenario: View-count evidence is audited
- **WHEN** schema tests/verifiers are inspected
- **THEN** 10 is recorded as historical runtime evidence, not a new run.

### Requirement: DB-006 Foreign keys
Business relationships SHALL use foreign-key constraints where applicable.
#### Scenario: Referential integrity is audited
- **WHEN** migrations are inspected
- **THEN** critical parent/child relationships have database enforcement.

### Requirement: DB-007 Unique constraints
Uniqueness rules SHALL have database constraints.
#### Scenario: Uniqueness is audited
- **WHEN** identity, idempotency, order-number, and binding tables are inspected
- **THEN** duplicate facts are blocked by keys or unique indexes.

### Requirement: DB-008 CHECK constraints
Domain invariants SHALL use CHECK constraints where database-enforceable.
#### Scenario: Check constraints are audited
- **WHEN** strict tables are inspected
- **THEN** status, range, type, and lifecycle invariants are constrained.

### Requirement: DB-009 transaction_assertions
Multi-statement invariants SHALL use transaction_assertions or equivalent atomic assertions.
#### Scenario: Transaction assertions are audited
- **WHEN** command batches are inspected
- **THEN** affected-row and related-fact assertions fail the transaction on inconsistency.

### Requirement: DB-010 Audit events
Material actions SHALL write audit events.
#### Scenario: Audit persistence is audited
- **WHEN** state-changing commands are inspected
- **THEN** actor, aggregate, request, previous/next state, and time evidence is retained.

### Requirement: DB-011 Outbox
Integration-relevant actions SHALL write an outbox event atomically.
#### Scenario: Outbox persistence is audited
- **WHEN** commands create external work
- **THEN** deduplicated outbox records commit with business state.

### Requirement: DB-012 Idempotency constraints
Idempotency records SHALL enforce actor/action/key uniqueness and payload consistency.
#### Scenario: Idempotency storage is audited
- **WHEN** command retries occur
- **THEN** the database prevents duplicate committed commands and conflicting replays.

### Requirement: DB-013 Migration 0025 preserves permission history
The 0025 permission-table rebuild SHALL preserve historical fields, rows, and constraints.
#### Scenario: 0025 rebuild is audited
- **WHEN** backup, rebuild, copy, and assertion SQL are inspected
- **THEN** prior authorization data is retained and FINANCIAL_VIEW is added safely.

### Requirement: DB-014 Immutable financial tables reject update/delete
Immutable financial fact and export-audit tables SHALL reject UPDATE and DELETE.
#### Scenario: Immutability triggers are audited
- **WHEN** financial migrations are inspected
- **THEN** protective triggers cover immutable tables.

### Requirement: DB-015 Order-number claim uniqueness
Amazon order number ownership SHALL have a database unique constraint.
#### Scenario: Claim uniqueness is audited
- **WHEN** active claims are inserted
- **THEN** duplicate marketplace/order-number ownership is blocked.

### Requirement: DB-016 File relations and audience constraints
File objects, entity links, and audience grants SHALL have relational and lifecycle constraints.
#### Scenario: File schema is audited
- **WHEN** file migrations are inspected
- **THEN** invalid owners, statuses, purposes, duplicate links, and audience combinations are rejected.

### Requirement: DB-017 Migration rebuild data-loss safety
Table rebuild migrations SHALL include copy and assertion safeguards against data loss.
#### Scenario: Rebuild safety is audited
- **WHEN** migrations reconstruct tables
- **THEN** backup/copy/drop order and transaction assertions preserve row semantics.

### Requirement: DB-018 Schema tests validate behavior
Schema tests SHALL validate behavior, not only object counts.
#### Scenario: Behavioral schema coverage is audited
- **WHEN** migration tests are inspected
- **THEN** constraints, triggers, immutability, and representative failure paths are tested.

### Requirement: DB-019 Verifiers match current source
Static verifiers SHALL remain aligned with the current migration chain and implementation.
#### Scenario: Verifier freshness is audited
- **WHEN** package scripts and verifier source are inspected
- **THEN** stale assumptions about prior migration limits or removed symbols are identified.

### Requirement: DB-020 Test doubles versus D1 risk is controlled
Differences between test substitutes and production D1 SHALL be explicitly validated locally.
#### Scenario: Runtime parity is audited
- **WHEN** remote static review cannot execute real D1
- **THEN** parity remains NOT_VERIFIED and a local validation request is recorded.
