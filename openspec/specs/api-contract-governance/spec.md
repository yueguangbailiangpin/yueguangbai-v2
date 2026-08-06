# api-contract-governance Specification

## Purpose
TBD - created by archiving change api-contract-baseline-alignment. Update Purpose after archive.
## Requirements
### Requirement: Contract documentation matches the registered API route family

The system documentation SHALL describe the existing formal `/api/*` routes, SHALL NOT claim unregistered `/api/v2/*` aliases, and SHALL verify that route inventory, Contract constants and first-party adapters remain aligned without changing runtime routes in this Change.

#### Scenario: Documented route exists

- **WHEN** the contract inventory lists a method and path
- **THEN** the default app and corresponding Contract constant expose the same registered boundary.

#### Scenario: Documentation invents an alias

- **WHEN** documentation references an unregistered `/api/v2/*` route
- **THEN** the contract verifier fails and no runtime alias is added merely to satisfy the text.

### Requirement: Growing lists use the cursor contract by default

The system documentation SHALL define growing collections with bounded `limit`, opaque `cursor` and nullable `next_cursor`, and SHALL permit page-number pagination only when a specific finite report Contract explicitly requires it.

#### Scenario: Cursor list

- **WHEN** a client traverses a growing Buyer, Seller or Staff collection
- **THEN** it follows returned cursors and does not infer total rows or page numbers.

#### Scenario: Intentional page exception

- **WHEN** a bounded report retains page-number pagination
- **THEN** its capability documents the exception, limits and concurrent-change semantics explicitly.

### Requirement: MCP and HTTP versions are governed independently

The system SHALL version MCP tool names and input/output schemas independently from internal HTTP URLs and SHALL require a separate approved Change before introducing a breaking external HTTP version family.

#### Scenario: MCP v1 calls internal API service

- **WHEN** a Staff MCP v1 tool invokes an existing Application Service
- **THEN** its public tool version remains stable regardless of the internal `/api/*` path.

#### Scenario: Future HTTP breaking change

- **WHEN** an external consumer requires a breaking HTTP contract
- **THEN** a separate Change defines coexistence, migration and retirement rather than silently renaming current routes.

### Requirement: Baseline alignment has no Schema or business behavior impact

The Change SHALL create no Migration, route behavior, permission, financial calculation or DTO projection change and SHALL fail review if runtime source changes are introduced without a separate business Change.

#### Scenario: Clean alignment diff

- **WHEN** the Change is reviewed
- **THEN** only governance documentation, inventories and behavior-neutral verifiers are modified.

#### Scenario: Real defect is discovered

- **WHEN** inventory finds a runtime bug or missing business endpoint
- **THEN** the defect is reported and routed to an independent Change instead of being hidden by documentation edits.
