# Change: Staging Isolated Readiness Bootstrap

## Why

The checked-in staging release profile deliberately disables production-only Scheduler, Acquisition Maintenance and alert delivery, but the shared `/ready` endpoint currently requires those capabilities and therefore can never accept staging. A freshly migrated staging D1 also cannot admit its first Staff Owner: Access bootstrap requires a pre-existing active email identity while formal Staff management requires an existing Owner.

## What Changes

- Publish an explicit staging readiness profile that reports production-only gates as `not_required` while keeping Schema, isolated object storage, staging Access configuration and exact release identity mandatory.
- Add a one-time, parameterized and atomic operator tool for the first Owner and synthetic Buyer registration channel on a completely empty Schema 65 staging D1.
- Remove the contradictory staging Cron requirement, enable staging observability and keep all production-only/external switches disabled.
- Document the fixed-SHA staging provisioning, formal test-account creation, backup/restore, role-chain and monitoring sequence.

## Non-goals

- No production deployment, Migration, D1/R2 read or write, Secret, DNS, Cloudflare Access mutation, scheduler activation or real customer/order/fund operation.
- No remote staging resource creation or deployment in this Change implementation PR.
- No schema change and no modification to migrations 0001-0065.
- No public bootstrap endpoint, Staff password, Access bypass or test authentication backdoor.
- No automatic creation of Staff or Customer test identities from committed personal data.

## Migration Decision

`NO_SCHEMA_CHANGE`. Schema 65 already contains Staff identity, role, authorization event, Audit, idempotency and transaction assertion facts required for a governed first-owner bootstrap.

## Rollback

Revert the branch-level source/config/docs Change before remote activation. After a real staging bootstrap, rollback disables the synthetic Owner through formal Staff lifecycle controls or destroys the isolated staging environment under a separate approved operator action; it never deletes production facts or rewrites Migration history.
