# Change: Governed Outbox Delivery Disabled Mode

## Why

The transactional Outbox is the durable record that a domain command committed an integration event. Its delivery worker is an independent external-effect capability and must stay disabled until separately enabled. Treating a missing delivery adapter as a failed attempt while delivery is intentionally disabled creates false operational debt and dead letters.

## What Changes

- Add the explicit `OUTBOX_DELIVERY_ENABLED` runtime flag, defaulting to `false` in the local, staging, and production templates.
- Keep all existing transactionally committed Outbox writes unchanged; the flag gates delivery only.
- When disabled, scheduled and Staff-triggered Outbox delivery skip before any event claim, retry/failure write, or dead-letter write.
- Retain the `/ready` `outbox_delivery` check and report `not_required` while the flag is false; enabled delivery remains subject to scheduler health.

## Non-Goals

- No change to Outbox schemas, domain transactions, event payloads, retry policy, or existing dead-letter facts.
- No scheduler activation, deployment, remote Cloudflare/D1/R2/DNS/Secret operation, or production/staging resource access.

## Rollback

Reverting the code restores the prior delivery behavior. Enabling delivery later is a separately governed runtime configuration action; disabled events remain durable `PENDING`/`FAILED` Outbox facts for the existing delivery flow and are never rewritten by this Change.
