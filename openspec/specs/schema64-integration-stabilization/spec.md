# schema64-integration-stabilization Specification

## Purpose
TBD - created by archiving change schema64-integration-stabilization. Update Purpose after archive.
## Requirements
### Requirement: Schema 64 uses one Staff identity composition

The active application SHALL use Cloudflare Access email proof plus Moonwhite D1 Staff authority and SHALL contain no Feishu authentication, binding, synchronization, callback or alert runtime.

#### Scenario: Staff enters the protected application

- **WHEN** Cloudflare Access presents a valid assertion for one known ACTIVE Staff email
- **THEN** the Worker issues its own bounded Session and derives all role, Marketplace scope and Personal DENY authority from D1.

### Requirement: Integration repair preserves one API registration per endpoint

Every business METHOD/path SHALL be registered in one contiguous runtime block, and route inventory tests SHALL fail when a second registration is introduced.

#### Scenario: Two modules register the same acquisition channel read

- **WHEN** the runtime route inventory is evaluated
- **THEN** the gate fails until only the current privacy-aware implementation remains.

### Requirement: Historical migration evidence remains byte-preserved

Migrations 0001–0043 SHALL remain byte-identical while 0044–0064 form the reviewed forward-only Schema 64 chain.

#### Scenario: A historical Feishu table name remains in a migration

- **WHEN** migration integrity is checked
- **THEN** the historical byte is retained for upgrade continuity but grants no active Feishu runtime authority.

### Requirement: Disabled Staff MCP is absent from the core release graph

When Staff MCP is disabled, the release configuration SHALL NOT require MCP Provider variables, OAuth endpoints, tool lists, Secrets or a token-status Worker service binding.

#### Scenario: Core production deploys with Staff MCP disabled

- **WHEN** release preflight validates the production configuration
- **THEN** it accepts no MCP service binding and the core Worker remains fail-closed on MCP routes.

### Requirement: Production readiness cannot fall through to the SPA

The production Worker SHALL route `/ready` to the dynamic readiness handler and SHALL NOT serve the SPA shell for that path.

#### Scenario: Readiness dependencies are unavailable

- **WHEN** a production request reaches `/ready` while one or more readiness dependencies are not ready
- **THEN** the Worker returns the structured readiness response with a non-success status rather than HTML.

### Requirement: Scheduled runtime uses validated production bindings

The production Scheduled Handler SHALL resolve the same validated database and object-storage bindings as the request runtime before running jobs.

#### Scenario: File cleanup runs in production

- **WHEN** the production scheduler invokes file orphan cleanup with a valid R2 bucket binding
- **THEN** the job receives the R2 object-storage adapter and SHALL NOT report the adapter as unavailable merely because the raw Worker binding uses the R2 interface.

