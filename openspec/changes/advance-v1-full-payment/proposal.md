# Change: Advance V1 Full Payment

## Why

The current Advance Principal command accepts a Staff-supplied amount and the canonical cash-integrity specification permits partial reversals. The business owner has selected a simpler V1 boundary: either pay the complete immutable Buyer expected principal once or do not use Advance. Keeping client-selected and partial amounts would preserve financial branches that the launch process does not need.

## What Changes

- Derive the Advance Payment amount only from the formal order financial snapshot `buyer_expected_principal_cny_fen`; remove amount authority from the Staff request and editable UI.
- Permit at most one outstanding full Advance Payment per formal order.
- Make reversal a server-derived full reversal; remove reversal amount authority from the request and reject partial or repeated reversals.
- Allow a replacement full Payment only after the previous Payment is fully reversed.
- Add forward-only Migration 0067 with fail-closed existing-ledger checks and database write-boundary guards for the full-payment model.
- Preserve immutable Payment, Reversal, settlement, Audit, idempotency, proof-file and cash-movement facts.

## Non-goals

- No change to ordinary Buyer Refund, Seller Settlement, Seller Allocation, profit formulas, Staff roles or permissions.
- No modification of historical migrations 0001-0066 or archived OpenSpec changes.
- No retirement of Seller Agreement Rate compatibility and no historical order import.
- No production/staging deploy, remote D1/R2 write, Secret, DNS, Access or Scheduler mutation.

## Migration Decision

`FORWARD_MIGRATION_REQUIRED`. Migration 0067 advances Schema 66 to 67, refuses ledgers that contain non-full Advance Payments or partial/multiple reversals, and installs database guards for authoritative full Payment, one outstanding Payment and one full Reversal.

## Rollback

Before remote application, revert this branch as one unit. After 0067 is applied, never edit/delete the migration or immutable ledger rows; rollback requires a new forward migration while retaining the stronger financial facts and audit history.
