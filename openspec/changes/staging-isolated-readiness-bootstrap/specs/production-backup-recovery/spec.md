# production-backup-recovery Delta

## MODIFIED Requirements

### Requirement: Operational readiness is stronger than liveness

`/health` MAY prove only that the Worker process responds. Production `/ready` SHALL fail unless database schema, required scheduled jobs, acquisition maintenance, operational alerts, object storage, Cloudflare Access configuration, running release identity, and current-release recovery evidence are all `ok`. Staging `/ready` SHALL preserve the same named checks but SHALL mark its intentionally disabled production-only gates and production recovery as `not_required`; it SHALL still fail unless Schema 65, isolated object storage, staging Access configuration and exact release identity are `ok`.

#### Scenario: Worker is alive but scheduler is stale

- **WHEN** production `/health` returns 200 but a required scheduled job has never succeeded, is stale/failed, or has excessive backlog
- **THEN** production `/ready` returns not-ready and Production GO is blocked.

#### Scenario: Recovery belongs to another release

- **WHEN** production Schema 65 is current but the latest recovery attestation release SHA differs from `APP_RELEASE_SHA`
- **THEN** production `/ready` returns not-ready.

#### Scenario: Staging production-only capabilities are disabled

- **WHEN** staging keeps Scheduler, Acquisition Maintenance and alert delivery disabled and has no production recovery attestation
- **THEN** those checks are `not_required`, never `ok`, and staging readiness depends on its four mandatory staging checks.
