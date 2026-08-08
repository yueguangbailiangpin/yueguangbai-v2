# Static Verifier Alignment Requirements

## ADDED Requirements

### Requirement: Verifiers follow current authoritative repository facts
Each affected static verifier SHALL derive its migration, route, or source assertion from the current authoritative repository facts and SHALL reject missing, renamed, non-contiguous, incorrectly owned, or structurally invalid facts.

#### Scenario: A later governed migration exists
- **WHEN** a verifier for an earlier archived Change runs after a later migration has been added to the continuous chain
- **THEN** it validates its owned prefix and fails on prefix drift, while it does not fail merely because the later governed migration exists.

#### Scenario: Migration ownership changes
- **WHEN** the required migration is absent, renamed, non-contiguous, or its protected ownership content drifts
- **THEN** the affected verifier fails closed with a specific error.

### Requirement: Source and route checks follow current module boundaries
The Wave 14A and M16 verifiers SHALL inspect the production source and lazy route modules that currently own their checked behavior, while retaining fail-closed isolation and accessibility assertions.

#### Scenario: Seller form selector becomes less precise
- **WHEN** the Seller source no longer contains the exact accessible `店铺` label selector
- **THEN** the Wave 14A verifier fails.

#### Scenario: Staff scheduling route leaves its lazy module
- **WHEN** the scheduling route is removed from its required lazy Staff route boundary or the boundary becomes eagerly imported by the root shell
- **THEN** the M16 verifier fails.

### Requirement: Dashboard scope remains read-only and separate from M16 schema ownership
The dashboard verifier SHALL prove its no-schema-change boundary against its own Change and the current authoritative migration chain, without classifying the independently governed M16 `0037` migration as dashboard schema scope.

#### Scenario: Dashboard introduces schema ownership
- **WHEN** dashboard-owned source or migration assertions show a new dashboard Migration or invalid local schema chain
- **THEN** the dashboard verifier fails.
