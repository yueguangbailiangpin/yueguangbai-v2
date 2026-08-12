# HTTP Contract Hardening Delta

## ADDED Requirements

### Requirement: Sensitive browser writes enforce strict Origin and exact bodies

Customer password change and Staff order-instruction prepare, publish, cancel, expiry scan, asset reconciliation and reservation reconciliation HTTP writes SHALL require an exact same-origin `Origin`, SHALL reject missing or foreign Origin, and SHALL reject every body key outside the complete accepted semantic body. Direct trusted scheduler-to-service invocation SHALL remain available without an HTTP Origin requirement.

#### Scenario: Browser write has missing or foreign Origin

- **WHEN** an otherwise authenticated request omits Origin or supplies another origin
- **THEN** the route rejects it before executing the service mutation.

#### Scenario: Browser write contains an extra body key

- **WHEN** an otherwise valid request adds any unaccepted key
- **THEN** the route returns validation failure and no mutation, Audit, Outbox or idempotency completion commits.

#### Scenario: Same-origin exact request is valid

- **WHEN** an authorized browser sends the exact accepted body and same-origin header
- **THEN** the existing command service executes with a request hash covering the complete accepted semantic body.
