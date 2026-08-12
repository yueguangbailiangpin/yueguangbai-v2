# Production Readiness Delta

## ADDED Requirements

### Requirement: Production readiness requires an operational alert sink

Production `/ready` SHALL expose an `operational_alerts` check and SHALL fail closed unless a supported bound service sink is present and an unexpired structured operator attestation exists in immutable Audit. The attestation SHALL match the exact running release SHA, configured sink identity and SHA-256 configuration fingerprint, SHALL include delivery, failure and recovery exercise PASS results, operator evidence reference, verification time and bounded expiry, and SHALL be created only through a formally authenticated owner route using the atomic command protocol. A bare verification boolean or local console adapter SHALL NOT satisfy production readiness. Production release preflight, runtime policy and the independent production health monitor SHALL enforce their corresponding part of the same policy. Explicit disabled policy MAY be used only outside production; console mode MAY be used only in local development.

#### Scenario: Production alert mode is disabled or invalid

- **WHEN** production runtime or release configuration has a disabled, unknown or incomplete operational alert mode
- **THEN** release preflight blocks and `/ready` reports `operational_alerts=failed` with HTTP 503.

#### Scenario: Non-production alert mode is explicitly disabled

- **WHEN** a local or isolated non-production configuration explicitly disables operational alerts
- **THEN** non-production policy may accept that configuration without creating a production bypass.

#### Scenario: Attestation is absent, stale or mismatched

- **WHEN** the immutable attestation is missing, malformed, expired, reports a failed exercise, or does not match the running release, sink identity or configuration fingerprint
- **THEN** production `/ready` reports `operational_alerts=failed` with HTTP 503 even when a bound sink object exists.

#### Scenario: Production template awaits operator evidence

- **WHEN** the repository production template is inspected before an authorized operator supplies real sink binding identity and fingerprint and performs the three exercises
- **THEN** preflight remains `BLOCKED_NEEDS_OPERATOR_INPUT`, no attestation is fabricated, and real production validation remains an incomplete external gate.
