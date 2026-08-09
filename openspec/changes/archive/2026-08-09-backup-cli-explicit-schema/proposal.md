## Why

Backup and restore currently default a missing `--expected-schema` to historical schema 34. An omitted trust-boundary input can therefore validate the wrong release shape instead of failing closed.

## What Changes

- Require explicit `--expected-schema` for both backup and restore CLIs.
- Remove schema 34 fallback behavior.
- Update focused CLI tests and the backup/restore runbook.
- Use only anonymous local fixture databases and keys.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `production-readiness`: Require release operators to supply the expected schema explicitly for backup and restore verification.

## Impact

Local backup/restore CLI argument handling, tests, and runbook examples. No database schema, production data, real backup, secret, provider, or external resource is accessed.
