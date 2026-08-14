# Tasks: Advance V1 Full Payment

- [x] 1. Add D-043 and the OpenSpec delta for server-authoritative full Advance Payment and full-only Reversal.
- [x] 2. Add failing API, direct-D1, migration and Staff UI tests for the full-payment contract.
- [x] 3. Add forward-only Migration 0067 with existing-ledger assertions and serialized full-payment/full-reversal guards.
- [x] 4. Remove amount authority from Payment/Reversal requests and derive immutable snapshot amounts server-side while preserving authorization, idempotency, proof, Audit and cash facts.
- [x] 5. Expose the authoritative amount through the protected lookup DTO and replace the editable Staff amount input with read-only confirmation copy.
- [x] 6. Advance current schema/verifier/runbook baselines to 67 without modifying historical decisions, migrations or archived changes.
- [x] 7. Run targeted tests, full migration/guard verification, strict OpenSpec validation, `git diff --check` and full `npm run check`.
- [x] 8. Complete implementation consistency review and Formal Verify against the fixed implementation SHA while keeping production and staging operations blocked; sync/archive and external fixed-final-SHA review remain subsequent governance gates.
