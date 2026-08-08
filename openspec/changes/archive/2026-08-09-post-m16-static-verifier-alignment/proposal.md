# Change Proposal: Post-M16 Static Verifier Alignment

## Why

The static acceptance verifiers for completed M14–M16 work still encode superseded repository snapshots. They now fail on current `main` even though the protected implementation, migration chain, and route boundaries remain valid. The verifiers must be realigned to current authoritative files without reducing any safety, authorization, migration, or route-isolation assertion.

## What Changes

- Align the Wave 14A verifier with the exact current Seller form label assertion.
- Make the M14 four-role and acquisition verifiers validate their owned migration prefix while accepting the current governed migration tail.
- Make acquisition migration-count validation accept the authoritative chain rather than a stale exact count.
- Make the M16 scheduling verifier inspect the lazy Staff route modules that own the current route split.
- Make the admin dashboard verifier validate its no-schema-change boundary against the migration owner and current chain rather than treating M16 migration `0037` as dashboard scope.
- Add only the targeted verifier regression assertions and this Change’s planning/evidence files.

## Out of Scope

- Production app, API, Contract, Domain, Migration, schema, permission, session, file, token, UI, or package-manifest changes.
- Database migration or local/remote schema mutation outside the repository’s existing read-only/in-memory verifier behavior.
- Deployment, external resources, push, PR, archive, or Integration work.

## Migration

No Migration. The authoritative chain remains `0001` through `0037`; this Change only updates static verifier expectations.

## Rollback

Revert the changed verifier and test/document files together. No business, schema, permission, migration, or external state needs recovery.
