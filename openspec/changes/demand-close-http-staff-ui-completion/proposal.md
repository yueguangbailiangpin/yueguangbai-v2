# Proposal: demand-close-http-staff-ui-completion

## Why

The published demand-batch close command already exists and is covered as a
domain workflow, but it is not wired to the formal Staff HTTP surface or to a
Staff page. A published demand can therefore be closed only by an internal
caller, while the current product scheduling workspace cannot show or submit
the operation.

## What Changes

- Add the formal Staff endpoint
  `POST /api/staff/demand-batches/:id/close` with the existing API success and
  failure envelope, `Idempotency-Key`, `expected_version`, and strict DTO
  contract.
- Harden the close command at its formal boundary: active Staff
  authorization is reread from the authoritative database, only `owner` and
  `seller_ops` with effective `DEMAND_PUBLISH` may proceed, Personal DENY and
  Seller Organization/Store scope remain effective, and the demand review
  work-item assignment remains the operation boundary. The authoritative
  resource is reread before the transaction.
- Keep the state transition `PUBLISHED -> CLOSED`, non-empty close reason,
  stable same-key replay, mismatch/concurrency/version failures, one audit and
  one demand event, and consistent work-item/idempotency completion in one
  transaction.
- Extend the existing Staff reservation-schedule DTO with backend-computed
  status and `can_close`, and add a Chinese confirmation/reason form to the
  existing reservation detail page. The UI will use the existing retained
  mutation request mechanism, then refresh the demand/product/workbench views
  after success.
- Add focused domain, HTTP, DTO, and Staff UI tests for success, replay,
  mismatch, concurrency, stale version, state/validation failures,
  unauthenticated/role/deny/scope/assignment concealment, no sensitive fields,
  visibility, deduplicated submission, exact ambiguous retry, and success
  refresh behavior.

## Scope

This Change covers the missing formal close route, its authoritative command
boundary, the existing Staff product-scheduling entry, and the directly
affected current contracts, tests, API inventory, and OpenSpec artifacts.

## Non-Scope

- No deletion or redesign of `list-public-demand-batches.ts`, seller members,
  retained security tombstones, D1 tables/views, marketplace/payables
  indexes, CSS layers, or auth/cursor refactors.
- No unrelated documentation cleanup, migration, new external integration,
  remote CI/GitHub action, deployment, OpenSpec archive, or modification of
  another active Change.
- No production or remote Cloudflare, D1, R2, Queues, Google Drive, Feishu,
  or GitHub resource access.

## Migration and rollback

`NO_SCHEMA_CHANGE`: the implementation reuses the existing demand, work-item,
audit, event, and idempotency tables. Rollback is a normal local revert of the
single task commit; no reset, rebase, stash, clean, squash, amend, push, or
deployment is part of this Change.
