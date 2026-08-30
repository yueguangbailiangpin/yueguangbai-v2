# Tasks: reservation-auto-approval-protection

## Migration

+ [x] 1.1 Confirm the protection is read-only and requires no new migration, table, index, or buyer-risk field.

## Domain/API

+ [x] 2.1 Define and export the two stable automatic-review reason codes and the internal manual-review result shape without changing the Buyer reservation contract.
+ [x] 2.2 Add a buyer-global formal-order protection projection that reuses the existing responsibility selector and responsibility builder for overdue semantics and current operational-event semantics.
+ [x] 2.3 Insert the protection check before every automatic-approval mutation statement; preserve the current two-transaction boundary and correct misleading atomicity comments.
+ [x] 2.4 Keep Staff manual approval independent and preserve expected-version, state-machine, capacity, audit, transaction-assertion, and work-item behavior.

## Tests

+ [x] 3.1 Add failing-then-passing D1 tests for overdue formal orders across seller organizations and exclusion of pending/non-formal records.
+ [x] 3.2 Add failing-then-passing D1 tests for each specified open operational risk, `RESOLVED` recovery, and exclusion of internal-finance-only facts.
+ [x] 3.3 Lock deterministic reason-code priority, Buyer DTO non-leakage, hold/work-item preservation, and manual Staff approval continuation.
+ [x] 3.4 Lock same-key replay and automatic retry/concurrency invariants so no hold, approved count, instruction, or work item is duplicated.

## Verification

- [x] 4.1 Run the reservation protection suite, typecheck, `npm test`, build, `npm run check`, `db:verify`, migration guards, API contract, relevant capacity suites, OpenSpec strict validation, and `git diff --check`, recording direct exit codes.
- [x] 4.2 Create one independent local commit only after all required local checks pass; do not push, deploy, sync/archive the Change, or touch remote resources.
