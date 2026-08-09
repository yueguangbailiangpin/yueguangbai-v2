## Context

The cryptographic backup implementation already verifies the supplied schema and release commit. Only the CLI argument parser silently supplies schema 34 when the operator omits the schema.

## Goals / Non-Goals

**Goals:**

- Make schema provenance an explicit required operator input on both CLI paths.
- Preserve all existing encryption, attestation, inventory, row, relationship, and financial checks.

**Non-Goals:**

- No backup format, crypto, database, or production workflow redesign.
- No real database, key, backup, or secret access.

## Decisions

- Reuse the existing required-argument parser, then apply the existing positive-safe-integer validation. This is the smallest shared fail-closed behavior.
- Test CLI process boundaries with anonymous temporary fixtures so omission and invalid values are exercised exactly as operators invoke them.
- Reject a repository-derived default because repository migration presence does not prove the intended or remote schema.

## Risks / Trade-offs

- [Existing local invocations omitted the flag] → Update every current runbook/test invocation; omission now fails with a specific missing argument.

## Migration Plan

No data migration. Operators add `--expected-schema <approved-version>` to both commands. Reverting restores the unsafe fallback and is not recommended.
