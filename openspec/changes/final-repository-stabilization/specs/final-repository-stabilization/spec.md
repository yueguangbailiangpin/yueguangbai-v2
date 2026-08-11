## ADDED Requirements

### Requirement: Current authority has one non-circular entry

The repository SHALL expose one current-state index that follows the authority order in `AGENTS.md`, and current Handoff documents SHALL NOT claim competing or circular precedence.

#### Scenario: A new maintainer determines the current system state

- **WHEN** the maintainer starts from the repository root
- **THEN** one documented path identifies the current Schema, identity composition, enabled capabilities and canonical decision/product/contract/architecture sources without choosing among FINAL or LATEST files.

### Requirement: Active runtime contains no Feishu capability

The active Worker, Web application, Contracts and release configuration SHALL contain no executable Feishu authentication, binding, synchronization, callback, task mirror or alert capability.

#### Scenario: The core Worker is bundled

- **WHEN** the current Worker entry is compiled from release configuration
- **THEN** build metadata contains no active Feishu runtime input and Staff authentication remains Cloudflare Access proof plus Moonwhite D1 authority.

### Requirement: Historical Schema cleanup is forward-only and audit-safe

Migrations 0001–0064 SHALL remain byte-identical, and any retirement of Feishu historical objects SHALL use the next continuous forward Migration only after proving retained audit facts and upgrade compatibility.

#### Scenario: A Feishu-named historical object is considered for removal

- **WHEN** local fresh and upgrade databases are inventoried
- **THEN** the object is removed only if no active runtime, required audit fact, constraint, index, Trigger or shared-table invariant depends on it.

### Requirement: Unapproved standalone modules are absent from the core release graph

A standalone capability that is not approved for the core release SHALL NOT be statically included solely to reject requests through a runtime feature flag.

#### Scenario: Staff MCP is not part of the core release

- **WHEN** the core Worker is bundled
- **THEN** its implementation contributes zero bytes to the core output while enablement remains an explicit reviewed code and configuration change.

### Requirement: One-time data tools are not online application modules

Seller partner import, current product-seller mapping and historical-order migration tooling SHALL remain offline, deterministic and unreachable from Worker/Web runtime entry points.

#### Scenario: The production dependency graph is inspected

- **WHEN** Worker and Web build inputs are enumerated
- **THEN** no offline import implementation or source-data fixture is present in either runtime graph.

### Requirement: Verification proves behavior instead of source wording

Acceptance SHALL rely on executable behavior, database semantics, types, platform static rules or build metadata and SHALL NOT require implementation-specific marker text.

#### Scenario: An implementation is refactored without changing behavior

- **WHEN** names, component structure or source layout change while the contract and behavior remain valid
- **THEN** repository gates continue to pass without compatibility marker files or fake source fragments.

### Requirement: Local repository cleanup preserves unique work

Local worktrees SHALL be removed only when clean, reachable from a retained ref and reconstructible, and remote refs SHALL remain unchanged without separate authorization.

#### Scenario: A historical worktree is considered for cleanup

- **WHEN** the worktree has uncommitted changes or unique commits not reachable from the retained final branch
- **THEN** cleanup skips it and reports the exact preservation reason.
