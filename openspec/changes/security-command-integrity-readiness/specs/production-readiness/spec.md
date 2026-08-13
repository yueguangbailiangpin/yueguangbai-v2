# Production Readiness Delta

## ADDED Requirements

### Requirement: Production readiness requires an operational alert sink

Production `/ready` SHALL expose an `operational_alerts` check and SHALL fail closed unless a supported bound RPC sink is present and an unexpired structured operator attestation exists in immutable Audit. A single canonical descriptor SHALL include the actual service target, canonical entrypoint, exact allowed props, sink identity and sink deployment/version. Only an omitted rendered service entrypoint SHALL canonicalize to the default descriptor entrypoint, while props and runtime SHALL explicitly mirror `default`; named entrypoints SHALL exactly match the supported JavaScript identifier subset, including `$` and `_`, across service, props and runtime. Invalid present values and missing runtime mirrors SHALL fail closed. Preflight SHALL derive its fingerprint with stable canonical JSON plus SHA-256 from the rendered service entry and SHALL reject stale or arbitrary fingerprints; runtime SHALL derive and verify the same observable configuration. The owner route SHALL accept no client PASS fields and SHALL attest only after fresh delivery, safe simulated failure and recovery RPC challenges each return an exact, current receipt bound to the challenge nonce/type, exact 40-character release SHA, current fingerprint and sink version. Any failed or malformed challenge SHALL write no success Audit. The accepted receipt summaries, operator evidence reference, verification time and bounded expiry SHALL commit using the atomic command protocol. A bare verification boolean or local console adapter SHALL NOT satisfy production readiness.

#### Scenario: Production alert mode is disabled or invalid

- **WHEN** production runtime or release configuration has a disabled, unknown or incomplete operational alert mode
- **THEN** release preflight blocks and `/ready` reports `operational_alerts=failed` with HTTP 503.

#### Scenario: Non-production alert mode is explicitly disabled

- **WHEN** a local or isolated non-production configuration explicitly disables operational alerts
- **THEN** non-production policy may accept that configuration without creating a production bypass.

#### Scenario: Attestation is absent, stale or mismatched

- **WHEN** the immutable attestation is missing, malformed, expired, or does not match the exact running release, sink identity, deployment version or derived configuration fingerprint
- **THEN** production `/ready` reports `operational_alerts=failed` with HTTP 503 even when a bound sink object exists.

#### Scenario: Binding descriptor or RPC receipt drifts

- **WHEN** service target, entrypoint, props, identity or sink deployment version changes without a matching derived fingerprint and fresh receipt set, or any receipt has a wrong, missing, duplicate or expired nonce/type/release/fingerprint/version/outcome
- **THEN** preflight, runtime or attestation fails closed, and the owner route writes no successful attestation.

#### Scenario: Production template awaits operator evidence

- **WHEN** the repository production template is inspected before an authorized operator supplies and independently verifies the real sink descriptor/derived fingerprint, provisions the RPC implementation and performs the three exercises
- **THEN** preflight remains `BLOCKED_NEEDS_OPERATOR_INPUT`, no attestation is fabricated, and real production validation remains an incomplete external gate.
