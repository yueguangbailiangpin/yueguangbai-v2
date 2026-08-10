# Production Readiness Delta

## ADDED Requirements

### Requirement: Production health has an independent non-Feishu receiver

The system SHALL use independently operated GitHub Actions to read only the fixed production `/health` endpoint on a bounded schedule, SHALL open at most one fixed operational Issue while unhealthy, and SHALL close it only after a healthy recovery observation.

#### Scenario: Health endpoint fails repeatedly

- **WHEN** the endpoint times out, returns non-200, exceeds the response bound or violates the health envelope
- **THEN** the workflow records only a fixed reason, creates or reopens one Issue, remains failed, and does not duplicate an already-open incident.

#### Scenario: Health endpoint recovers

- **WHEN** a later check receives the valid health envelope
- **THEN** the workflow adds one fixed recovery note and closes the open Issue without invoking Cloudflare, Feishu, D1, R2 or business commands.

#### Scenario: Independent receiver acceptance

- **WHEN** an authorized operator dispatches simulated failure followed by simulated recovery
- **THEN** the same real GitHub Issue completes open-to-closed lifecycle evidence without contacting the production endpoint.
