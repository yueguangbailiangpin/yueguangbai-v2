# Design: Governed Outbox Delivery Disabled Mode

## Boundary

`integration_outbox` continues to be written inside the existing business transaction. The new flag is read only at delivery entry points: Worker Scheduled Handler, Staff manual job runner, and dead-letter replay eligibility. It is not available to business commands and cannot suppress the durable Outbox fact.

## Disabled semantics

`OUTBOX_DELIVERY_ENABLED=false` returns `DISABLED` before acquiring an Outbox job lease or claiming an event. Therefore the event status, attempt count, error, event lease, scheduled run row, and `scheduled_dead_letters` remain unchanged. A Staff manual command may still record its own controlled command/audit/idempotency outcome of `DISABLED`; it does not mutate an Outbox event or replay a dead letter.

## Readiness and configuration

The readiness response keeps an explicit `outbox_delivery` key. Disabled delivery is `not_required`; it is not removed and cannot masquerade as observed successful delivery. When enabled, it requires the Scheduler and current Outbox job health. The three environment templates all set the flag to `false`, and Cloudflare release-runtime validation accepts only explicit boolean strings so an omitted release flag fails closed.

## Rejected alternatives

- Deleting the readiness key would hide an intentionally deferred capability from operators.
- Using a missing adapter as the disable signal records false failures and can quarantine valid durable events.
- Blocking transaction-time Outbox writes would discard the domain's integration intent and break the existing atomicity boundary.
