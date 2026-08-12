# Production Readiness Delta

## ADDED Requirements

### Requirement: Production readiness requires an operational alert sink

Production `/ready` SHALL expose an `operational_alerts` check and SHALL fail closed unless the supported production alert sink is explicitly enabled and its runtime configuration is valid. Production release preflight and the independent production health monitor SHALL require the same check. Explicit disabled policy MAY be used only by local or isolated non-production environments.

#### Scenario: Production alert mode is disabled or invalid

- **WHEN** production runtime or release configuration has a disabled, unknown or incomplete operational alert mode
- **THEN** release preflight blocks and `/ready` reports `operational_alerts=failed` with HTTP 503.

#### Scenario: Non-production alert mode is explicitly disabled

- **WHEN** a local or isolated non-production configuration explicitly disables operational alerts
- **THEN** non-production policy may accept that configuration without creating a production bypass.
