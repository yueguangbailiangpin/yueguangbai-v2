# Migration 0029 Rollback and Recovery

## Before the first 0029 write

1. Stop application writes.
2. Export the complete D1 database to an isolated backup.
3. Record schema version, row counts and SHA-256 Manifest for Buyer, Store, Rate, Fee, Evidence, Formal Order and Financial Snapshot facts.
4. Restore the export into an isolated database and run `integrity_check`, `foreign_key_check` and the Manifest comparison.
5. Apply 0029 only after the restored copy is verified.

If migration or backfill validation fails before the new Worker accepts writes, keep the old Worker and restore the verified schema-28 backup. Do not run reverse table-drop SQL.

## After USD/KRW or multi-Marketplace facts exist

The old Worker cannot understand canonical USD/KRW or multi-Marketplace facts. Downgrading to schema 28 would silently hide those facts and is forbidden.

1. Stop writes and preserve a new complete backup and Manifest.
2. Keep schema 29 and deploy a forward repair that only appends/corrects canonical facts.
3. If repair is unsafe, restore the latest verified schema-29 backup into an isolated database, verify all canonical and legacy projections, then switch traffic under a separate production authorization.
4. Financial snapshot rows and correction events are immutable; corrections use new versions/facts, never updates or deletes.

## Rehearsal evidence

`npm run verify:marketplace-money` performs:

- schema-28 JP fixture Manifest and SHA-256;
- pre-write backup and isolated restore comparison;
- 0029 upgrade with exact rate/fee/backfill assertions;
- insertion of a USD canonical fact;
- schema-29 forward backup and isolated restore;
- integrity and foreign-key checks on every stage.

This is local evidence only. It does not authorize a production migration, database write or deployment.
