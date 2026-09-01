# Proposal: seller-owner-operations-write-authorization

## Why

Seller member write authorization is currently repeated in the Seller portal
actor, catalog access projection, product-application and demand-batch command
guards, file-upload route authority, settlement-account route, and member
management route. Repeating the same `OWNER`/`OPERATIONS` test makes it easy for
one entry point to drift while the four Seller roles and their exceptions are
already fixed by the permission matrix.

## What Changes

- Add one pure domain authorization policy for the four canonical Seller
  member roles: `OWNER`, `OPERATIONS`, `FINANCE`, and `VIEWER`.
- Move the confirmed equivalent `OWNER`/`OPERATIONS` operational-write checks
  to the shared `SELLER_OPERATIONS_WRITE` capability. This covers product
  application submit/withdraw, demand-batch submit/withdraw, and the Seller
  product-application image upload lifecycle.
- Route the confirmed exceptions through named capabilities rather than the
  general write capability:
  - all four active Seller roles may create an authorized store;
  - `OWNER`, `OPERATIONS`, and `FINANCE` may update the organization settlement
    account;
  - only `OWNER` may list/manage members and issue or revoke invitations;
  - only `OWNER` and `FINANCE` may read the existing financial summary,
    payables, and payable detail endpoints.
- Add unit coverage for the complete capability matrix, fail-closed unknown
  runtime roles, unauthenticated/no-membership sessions, and owner-only member
  management. Existing HTTP tests continue to lock cross-organization
  concealed 404, idempotent replay, audit/version-conflict, Origin Guard, and
  role-negative behavior.

## Permission Matrix

| Seller member role | Operational writes: product applications, demand batches, product application image uploads | Create authorized store | Settlement-account write | Member management | Settlement financial summary/payables reads |
| --- | ---: | ---: | ---: | ---: | ---: |
| `OWNER` | yes | yes | yes | yes | yes |
| `OPERATIONS` | yes | yes | yes | no | no |
| `FINANCE` | no | yes | yes | no | yes |
| `VIEWER` | no | yes | no | no | no |

The store-creation column is an explicit product rule, not an inference from
the general operational-write column. Session validity, active membership,
organization scope, Origin Guard, idempotency, state-machine, audit, and
expected-version checks remain in their existing layers.

## Scope

The implementation scope is the Seller member-role authorization decision and
its directly confirmed call sites in the local API/domain code. The shared
policy is exported from `@ygb/domain` and has no database or HTTP dependencies.

## Non-Scope

- No API DTO, route, HTTP status, error-envelope, database schema, migration,
  ledger, audit, idempotency key, or state-machine change.
- No change to Staff role codes such as lower-case `owner` or `seller_ops`.
- No change to Seller read-intent POST routes, public invitation registration,
  Seller settlement-batch read-only routes, or file-read authorization.
- No change to the Seller organization onboarding invariants that create or
  activate the fixed primary `OWNER` member; those are lifecycle/data guards,
  not active-member portal authorization.
- The original write-only Change intentionally did not add a financial gate to
  payment list/detail. That historical scope is preserved, while the later
  independent `seller-settlement-read-boundary` Change is now authoritative for
  the payment read boundary and aligns it with summary/payables.
- No frontend, CSS, deployment, push, remote CI, OpenSpec archive, or access to
  Cloudflare/D1/R2/Queues/Google Drive/production resources.

## Migration

None. The policy is an in-process pure function. Existing command transaction,
idempotency, audit, version, and concealed-404 behavior remains unchanged.

## Privacy and Security Impact

The policy does not expose new data. Unauthorized Seller commands continue to
fail with the same `403` or concealed `404` behavior at their current boundary;
cross-organization resource lookups remain scoped by the resolved active
membership. Unknown role values fail closed in the pure policy.

## Rollback Boundary

Rollback is the normal revert of the single task commit. No reset, rebase,
stash, clean, squash, amend, push, deployment, or remote data operation is
permitted.
