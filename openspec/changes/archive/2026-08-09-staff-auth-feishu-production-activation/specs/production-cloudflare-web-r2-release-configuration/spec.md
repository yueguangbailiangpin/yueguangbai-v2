# Production Cloudflare/Web/R2 Release Configuration Delta

## MODIFIED Requirements

### Requirement: External and destructive capabilities remain disabled

Staging and production templates SHALL set Scheduler, Staff Auth/Feishu, Drive copy, Drive proxy, Drive R2 delete, Feishu workbench sync/callback, Staff MCP and external alert delivery to disabled/false. A capability MAY be enabled only through its own approved OpenSpec Change and dedicated fail-closed activation preflight. R2 deletion required only for failed-upload compensation remains governed by the existing compensation contract.

#### Scenario: Template defaults are reviewed

- **WHEN** either environment template is parsed
- **THEN** every frozen kill switch is explicitly disabled and no provider credential is stored in vars.

#### Scenario: A capability is enabled in release input

- **WHEN** the generic Cloudflare release preflight sees any frozen switch enabled
- **THEN** it rejects the input and identifies the switch name without echoing any configuration value; a separately approved capability must instead use its dedicated activation preflight.

#### Scenario: Staff Auth has a separately approved activation

- **WHEN** an external production config enables only Staff Auth and passes its dedicated activation preflight
- **THEN** the generic template remains unchanged while the reviewed runtime may accept the enabled capability; every unrelated external/destructive switch remains false.

#### Scenario: A capability lacks its dedicated activation approval

- **WHEN** a release input enables a frozen switch without its own approved activation contract and preflight
- **THEN** the applicable preflight or runtime rejects the input and identifies the switch name without echoing any configuration or Secret value.
