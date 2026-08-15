# Change Proposal: Migration 0069 Cloudflare D1 Compatibility

## Why

Migration `0069` currently runs SQLite whole-database validation inside its transaction. Cloudflare D1 rejects the integrity form with `SQLITE_AUTH`; the documented quick form exhausts memory against the current complete Schema. The failure happens before destructive DDL and rolls the transaction back, leaving the real staging database safely at Schema 68, but it blocks the only authorized empty-database retirement window.

## Authorization and scope

The owner explicitly authorizes a controlled amendment of Migration `0069` and, after the first canary exposed a second parser incompatibility, an equivalent trigger-syntax amendment in Migration `0070` in the same independent PR. Migrations `0001`–`0068` remain byte-identical, Migration `0070` retains its existing table, constraint and business semantics, the real staging database stays at Schema 68 until this Draft PR is reviewed, and production remains out of scope.

## What changes

- Remove whole-database validation PRAGMAs from the `0069` transaction.
- Retain Schema 68 ordering, every zero-stock assertion, both FK checks, object/column inventory assertions, rebuild order and the final `changes()=1` guard.
- Reject future migration SQL that embeds whole-database integrity or quick checks.
- Rewrite the `0070` source guard from D1-rejected `CASE ... THEN RAISE` syntax to the equivalent `SELECT RAISE(...) WHERE ...` form and reject recurrence.
- Perform full health checks by exporting the remote database and reconstructing it in native SQLite before and after `0069`.
- Prove exact `0001`–`0070` remote compatibility on one disposable staging-only D1 canary, then delete that canary.

## Non-goals

- No migration `0001`–`0068` edit, no `0070` table/constraint/business change and no new forward migration.
- No runtime-transformed migration, manual migration-ledger write or imported local database presented as remote migration evidence.
- No write to the real staging D1, Worker, R2, DNS, Secrets, Access policy, production resource or real business data.

## Rollback

Before merge, discard or revert this branch. The disposable canary is deleted after evidence capture. The real staging database remains at Schema 68, so no remote data rollback is required. After a future reviewed application of `0069`, rollback remains forward-only and requires a separately authorized migration.
