# Feishu Staff Workbench Capability

## ADDED Requirements

### Requirement: Anonymous PoC gates real Feishu integration

The system SHALL keep real Feishu integration disabled until the final business owner verifies current free-plan OAuth, task/workbench, callback, deep-link, administrator and quota behavior using anonymous data, and records the tested API/version and observed limits.

#### Scenario: PoC passes

- **WHEN** the final business owner records every required capability working with the approved tenant configuration and anonymous fixtures
- **THEN** the production Adapter contract may be frozen with evidence and capacity estimates.

#### Scenario: Capability or quota is insufficient

- **WHEN** a required action, permission or expected workload is unsupported, or no owner evidence exists
- **THEN** real integration remains disabled and the design is reduced or an explicit plan decision is requested.

### Requirement: D1 remains identity, permission and task authority

The system SHALL use Feishu only to authenticate a configured-tenant identity and present task mirrors, SHALL map it to an existing ACTIVE D1 Staff user, and SHALL recalculate D1 roles, Personal DENY, Team and Scope before every task action.

#### Scenario: Valid mapped Staff

- **WHEN** a verified Feishu identity maps uniquely to an ACTIVE Staff user
- **THEN** the Worker may issue its own internal Session and display only D1-authorized task mirrors.

#### Scenario: Feishu field claims authority

- **WHEN** a callback or client field claims a role, permission, Staff ID or business status not authorized by D1
- **THEN** the claim is ignored and the operation fails closed.

### Requirement: Feishu receives only actionable safe task summaries

The system SHALL synchronize only actionable, exceptional, overdue tasks and aggregate summaries with safe identifiers, status, priority, due, assignee, title and controlled Web deep link, and SHALL NOT synchronize complete WeChat IDs, raw screenshots, payment proof or authoritative financial data.

#### Scenario: Actionable task is mirrored

- **WHEN** a D1 task enters an approved actionable state
- **THEN** an idempotent Outbox event creates or updates one safe Feishu mirror.

#### Scenario: Ordinary order state changes

- **WHEN** an order change does not create an actionable/exception task
- **THEN** no per-state Feishu mirror call is required.

### Requirement: Feishu task actions use versioned D1 commands

The system SHALL allow only approved low-risk task actions such as claim, return and reassignment from Feishu, SHALL validate callback authenticity/replay and current Staff authority, and SHALL execute the same idempotent expected-version D1 command used by controlled Web.

#### Scenario: Staff claims an available task

- **WHEN** an authorized Staff callback claims the current task version
- **THEN** D1 updates atomically and a new Outbox event updates the mirror.

#### Scenario: Two Staff race

- **WHEN** two callbacks claim the same version
- **THEN** exactly one succeeds and the loser receives a conflict before the mirror is reconciled to current D1 state.

### Requirement: Provider failure never rolls back business facts

The system SHALL retry and dead-letter Feishu 429/5xx failures, SHALL expose sync backlog/health, SHALL permit mirrors to be rebuilt from D1, and SHALL keep controlled Web business operations available while Feishu is disabled or unavailable.

#### Scenario: Feishu outage

- **WHEN** Provider calls fail after a D1 business transaction commits
- **THEN** the business result remains committed and the sync event is retried without duplication.

#### Scenario: Integration rollback

- **WHEN** outbound sync and callbacks are disabled
- **THEN** D1 tasks and Web operations continue and no deletion of a Feishu mirror deletes D1 facts.
