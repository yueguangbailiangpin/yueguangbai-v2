# Remote Activation Evidence Index

## Release

- Reviewed PR head: `b21a826c6832104db1db6265e692c9362ddf0b0c`.
- Ordinary merge on main: `10624b1066143b7ac57923597a1d877209959a4a`.
- Merge parents and tree equality were verified before staging work.
- Git-external evidence bundle: `managed://staging/t8-10624b10/`.

## Database

- Before: Schema 68, migration ledger 68, reconstructed integrity `ok`, foreign-key errors 0.
- Applied: existing migrations 0069 and 0070 only.
- After: Schema 70, migration ledger 70, reconstructed integrity `ok`, foreign-key errors 0.
- First Owner: one Staff user, one active Owner role, one synthetic staging Buyer channel.

## Cloudflare staging baseline

- Worker, D1, R2, Access application, managed Secrets and custom domain use staging-only resource classes.
- Required Secret names present: `CUSTOMER_SESSION_SECRET`, `CUSTOMER_SECURITY_TOKEN_SECRET`; values remain external.
- Access application protects the staging hostname with one Allow policy whose five-email set matches the managed identity file; emails remain external.
- Public DNS resolves and HTTPS is Access-protected.
- Unauthenticated health/readiness requests redirect to Access.

## Authenticated readiness

- `/health`: HTTP 200, application status `ok`.
- `/ready`: HTTP 200, application status `ready`.
- `ok`: schema, object storage, staff access, release.
- `not_required`: scheduler, outbox delivery, acquisition maintenance, operational alerts, recovery.
- On an empty `file_objects` table, `object_storage=ok` requires the runtime's real R2 `headObject` binding probe.

## Safety boundary

- No production-targeted resource, data, Secret or DNS query or mutation was performed for this activation. The Access management list incidentally displayed an existing non-staging application row; no production details were opened or changed.
- `PRODUCTION_GO=NO_GO`.
- T9, T10 and T11 evidence is not included.
