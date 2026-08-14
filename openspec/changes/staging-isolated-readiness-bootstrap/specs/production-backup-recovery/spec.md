# production-backup-recovery Delta

## MODIFIED Requirements

### Requirement: Operational readiness is stronger than liveness

`/health` MAY prove only that the Worker process responds. Production `/ready` SHALL fail unless database schema, required scheduled jobs, acquisition maintenance, operational alerts, object storage, Cloudflare Access configuration, running release identity, and current-release recovery evidence are all `ok`; its separate `outbox_delivery` check SHALL retain the scheduled-operations contract of `not_required` while `OUTBOX_DELIVERY_ENABLED=false`. Staging `/ready` SHALL preserve the same named checks but SHALL mark Scheduler, Outbox Delivery, Acquisition Maintenance, operational alerts and production recovery as `not_required`; it SHALL still fail unless Schema 70, isolated object storage, staging Access configuration and exact release identity are `ok`.

#### Scenario: Worker is alive but scheduler is stale

- **WHEN** production `/health` returns 200 but a required scheduled job has never succeeded, is stale/failed, or has excessive backlog
- **THEN** production `/ready` returns not-ready and Production GO is blocked.

#### Scenario: Recovery belongs to another release

- **WHEN** production Schema 70 is current but the latest recovery attestation release SHA differs from `APP_RELEASE_SHA`
- **THEN** production `/ready` returns not-ready.

#### Scenario: Staging production-only capabilities are disabled

- **WHEN** staging keeps Scheduler, Outbox Delivery, Acquisition Maintenance and alert delivery disabled and has no production recovery attestation
- **THEN** those five checks are `not_required`, never `ok`, and staging readiness depends on its four mandatory staging checks.

### Requirement: Local release validation does not silently probe production

Repository/static/migration/type/build/recovery-preparation checks SHALL remain local/offline. A real production `/ready` read SHALL be a separate explicit action.

#### Scenario: Local release check completes

- **WHEN** the local release command completes its repository gates
- **THEN** it reports external production readiness as unverified and performs zero production `/ready` calls.

#### Scenario: Owner explicitly probes production

- **WHEN** the explicit production readiness probe is invoked after deployment/activation approval
- **THEN** it performs a bounded HTTPS GET against the fixed `/ready` endpoint, requires the eight mandatory production checks to be `ok`, and accepts `outbox_delivery=not_required` only while the independent `OUTBOX_DELIVERY_ENABLED=false` contract remains in force.
