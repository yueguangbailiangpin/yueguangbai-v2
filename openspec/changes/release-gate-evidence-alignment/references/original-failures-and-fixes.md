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

## First clean-candidate gate finding

The first clean-candidate aggregate run stopped in the main Web gate when the existing shared Customer cache-race test observed the dependency-error heading one effect tick before its second root-removal effect completed. The observed Buyer query value was `undefined`, not stale protected data. The assertion now waits for the already-required two-root removal to complete; it still requires both roots to be empty, preserves the second explicit logout retry, and makes no Seller logout surface or runtime change. Ten isolated repetitions passed before the bounded timing fix, and the full gate is rerun from a new clean candidate rather than treating that failed run as success.

The next clean-candidate run passed the main, production-readiness, Drive, and Feishu gates, then stopped because the separate Staff MCP production verifier still named its archived Change through an active-only path. That verifier, the Cloudflare release verifier, admin-dashboard evidence reads, and the API-contract Change-root allowance now use the same exactly-one active/archive resolver. The failed aggregate run is not counted as a release pass; all commands are rerun from the next clean candidate.
