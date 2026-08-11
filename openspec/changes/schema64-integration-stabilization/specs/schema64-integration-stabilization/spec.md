## ADDED Requirements

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
