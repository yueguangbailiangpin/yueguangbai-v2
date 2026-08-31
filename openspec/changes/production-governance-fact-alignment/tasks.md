# Tasks: production-governance-fact-alignment

## Migration

- [x] 1.1 Confirm `NO_SCHEMA_CHANGE`; do not add, modify, or execute a
  migration.

## Contracts and governance documents

- [x] 2.1 Reconcile the final Production Gate's billing, Schema, and retired
  integration wording while preserving historical evidence and `NO-GO`.
- [x] 2.2 Reconcile Owner actions, current system state, and local-preparation
  historical labels, including Stage 7F parent/child completion versus archive.

## Domain / API / privacy boundaries

- [x] 3.1 Confirm no domain, API, permission, DTO, Buyer/Seller/Staff data, or
  financial behavior changes; record D1 and DTO-isolation checks as N/A.

## Workflow implementation

- [x] 4.1 Remove only the obsolete automatic health-monitor schedule; retain
  manual dispatch, existing diagnostic logic, least permissions, concurrency,
  and the old endpoint as a manual-only diagnostic target.
- [x] 4.2 State the Stage 8 deployment and confirmed production `/ready` URL
  prerequisite for restoring an hourly schedule; do not invent a URL or deploy.

## Tests and verifier

- [x] 5.1 Update the active release-governance verifier and regression tests to
  enforce the manual-only workflow and reactivation notice.
- [x] 5.2 Run the targeted health/governance tests, document/schema guards,
  OpenSpec strict validation, and `git diff --check` with direct exits.
- [x] 5.3 Run applicable local npm gates; do not report staging, Remote CI, or
  production acceptance from local results.

## Delivery

- [ ] 6.1 Inspect the final diff scope and create one normal local commit only
  after all in-scope checks pass; do not amend, push, deploy, sync, or archive.
