## 1. CLI Trust Boundary

- [ ] 1.1 Remove the backup CLI schema fallback and require a valid explicit `--expected-schema`.
- [ ] 1.2 Remove the restore CLI schema fallback and require a valid explicit `--expected-schema`.

## 2. Tests and Runbook

- [ ] 2.1 Add anonymous local CLI tests for missing, invalid, matching, and mismatching expected schema values.
- [ ] 2.2 Update every current runbook/example invocation to supply the approved schema explicitly.
- [ ] 2.3 Confirm no real database, backup, key, secret, or external resource is accessed.

## 3. Validation

- [ ] 3.1 Run the focused production-readiness backup/restore suites and dry-run.
- [ ] 3.2 Run strict OpenSpec validation and the repository/release gates.
