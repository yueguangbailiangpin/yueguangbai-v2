## Runtime and configuration

- [x] Add the explicit `OUTBOX_DELIVERY_ENABLED` binding and require an explicit boolean in release runtime validation.
- [x] Set the local, staging, and production templates to `false` without changing any remote configuration.
- [x] Gate Scheduled Handler, Staff manual delivery, and dead-letter replay before Outbox event mutation.
- [x] Keep transaction-time Outbox writes outside this flag boundary.

## Readiness and tests

- [x] Retain `outbox_delivery` in `/ready`, returning `not_required` when disabled and preserving enabled health checks.
- [x] Add focused coverage that disabled delivery has zero adapter calls, failure attempts, dead letters, job runs, and Outbox mutation.
- [x] Run focused behavior tests, API typecheck, strict OpenSpec validation, and static diff checks locally.

## Handoff

- [x] Keep the Change active until the implementation review workflow completes; then sync and archive only after the review findings are resolved.
- [x] Do not push, create a PR, merge, deploy, or access remote resources.
