# Design: Migration 0069 Cloudflare D1 Compatibility

## Failure boundary

The observed D1 failure occurs at the first whole-database validation query, before any table rebuild or drop. D1 rolls back the batch and keeps Schema 68. Replacing that query with the quick variant is not viable: the current complete schema returned `SQLITE_NOMEM` in an isolated read-only probe.

## Migration transaction

Migration `0069` keeps only bounded, migration-relevant checks inside D1:

1. Schema version is exactly 68.
2. FK violations are absent before DDL.
3. The complete affected table, trigger and view set exists.
4. Every legacy-rate and formal-order stock category is empty, including Audit, Outbox and idempotency residue.
5. Owning triggers are dropped before their tables are rebuilt.
6. Compatibility projection tables are rebuilt before the three legacy tables are dropped.
7. Required surviving/replacement FKs, triggers, indexes and views exist; obsolete tables and columns do not.
8. FK violations are absent after DDL.
9. The guarded Schema 68 to 69 update changes exactly one row.

No migration source may run a whole-database integrity or quick check inside the transaction. A repository verifier enforces that rule across all migration SQL files.

## External full-health proof

The disposable canary is advanced in two phases:

1. Apply exact migrations `0001`–`0068` remotely.
2. Export that D1 database, reconstruct the dump in native SQLite, and require full integrity success, zero FK failures, Schema 68 and a 68-row migration ledger.
3. Apply exact migrations `0069`–`0070` remotely from the reviewed worktree.
4. Verify remote Schema 70, a 70-row migration ledger, zero FK failures, removal of all legacy agreement-rate objects and obsolete columns, and expected schema inventory.
5. Export again and require native SQLite full integrity success, zero FK failures, Schema 70 and the same object assertions.
6. Record only redacted status/count evidence and delete the canary. Confirm its ID is absent afterwards.

The canary is not the real staging database and cannot establish staging acceptance or Production GO.

## Rejected alternatives

- **Quick validation inside D1:** documented but observed to exhaust memory on this schema.
- **Runtime SQL transformation:** would make the applied bytes differ from the reviewed migration.
- **Manual ledger insertion:** would forge migration history.
- **Migration 0071:** cannot repair a database blocked before `0069` completes.
- **Importing a locally migrated dump:** would not prove D1 can execute the migration.

## Remote target controls

The canary uses a unique staging-only name and database ID in a Git-external `0600` config. Commands resolve that exact name and ID before mutation. The real staging and production IDs are explicit forbidden targets. Deletion is limited to the validated canary ID after all evidence is captured.
