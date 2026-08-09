# Original Release Verifier Failures and Fix Evidence

Date: 2026-08-09 (Asia/Shanghai)

## Reproduced before modification

1. `node scripts/verify-final-production-go-local-preparation.mjs`
   - Failed with `required governance evidence missing: openspec/changes/pre-wave13-baseline-conformance-audit/tasks.md`.
   - Cause: an active-only hard-coded path after the Change had moved to `archive/2026-08-09-pre-wave13-baseline-conformance-audit`.
2. `node scripts/verify-staff-mcp-formal.mjs`
   - Failed with `expected 5 requirements, found 14`.
   - Cause: five critical invariants were incorrectly treated as the entire authoritative spec instead of a mandatory subset of the current 14 requirements.

## Current behavior

- Final-production and other touched Change evidence reads resolve exactly one ordinary active or dated archive directory and reject missing, duplicate, coexisting, malformed, or symlink evidence.
- Staff MCP reads the 14-requirement canonical spec, requires unique titles, maps the original five exact requirement names to implementation and tests, and still fails if any of those five or their markers disappear.
- Both original commands pass after the fix. The aggregate release gate reruns both paths on the clean candidate and still returns Production `NO_GO`.
