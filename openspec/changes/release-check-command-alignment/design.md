# Design: release-check-command-alignment

## Context

Commit `668945fa` removed orphaned aggregate npm entries and their retired
verifier scripts. The current manifest retains the following authorities:

- `verify:final-production-go:local` and the `check` chain for local
  production-readiness evidence;
- `preflight:drive-archive` for Drive activation structure checks;
- `verify:staff-auth-composition` for current Staff Auth route/composition
  evidence;
- `test:browser` for the canonical Chromium loopback suite.

The old `check:production-readiness`, `check:drive-archive`,
`check:staff-auth-production`, and `test:wave14a:browser` names are absent from
the current manifest. Existing historical acceptance records retain their
original command text as historical evidence and are not rewritten.

## Goals / Non-Goals

**Goals:**

- Make every command in the release aggregate resolve to a real root npm
  script.
- Preserve the existing release ordering, candidate provenance, browser port
  isolation, external-evidence `UNVERIFIED`, and `production_go: NO_GO`
  semantics.
- Fail closed with an actionable complete list if the manifest drifts again.
- Keep all non-audit subcommands within LOCAL-only validation boundaries.

**Non-Goals:**

- No runtime business behavior, schema, migration, external resource, or
  deployment change.
- No reactivation of retired Staff MCP, Feishu, Rakuten, TikTok, or old archive
  configuration.

## Decisions

1. **Use the current manifest as the command authority.** The aggregate calls
   `verify:openspec:strict`, `audit:dependencies`, `check`,
   `preflight:drive-archive`, `verify:staff-auth-composition`,
   `verify:cloudflare-release`, `dry-run:cloudflare-release`,
   `verify:final-production-go:local`, and `test:browser`.
2. **Keep explicit Staff Auth coverage.** `check` already covers the same
   verifier, but the release aggregate keeps the named current verifier
   visible as a direct release family, matching the prior aggregate's intent.
3. **Replace, do not resurrect.** The old production-readiness aggregate is
   covered by the current `check` plus final-go verifier; the old Drive and
   Staff Auth aggregates are replaced by their current verifier/preflight
   authorities; the old browser wrapper is replaced by `test:browser`.
4. **Guard before execution.** The manifest guard runs before candidate
   provenance and before any npm subcommand, and reports all missing keys.
5. **Preserve environment boundaries.** Only `audit:dependencies` may perform
   the explicitly authorized public npm advisory/registry read. Cloudflare
   templates, Drive and Staff Auth preflights, final-go verification, and the
   browser suite remain local or loopback-only; no production readiness probe
   is added.

## Data / Transaction / Permission Boundaries

There is no D1 transaction, data mutation, API or DTO change. Local test/build
artifacts may be generated in the checkout's normal ignored output locations.
No Cloudflare, GitHub, Drive, Feishu, provider, production, or remote database
resource is read or written except the explicitly authorized public npm audit
read.

## Rejected Alternatives

- **Restore the four old npm entries:** rejected because the consolidation
  commit removed them and current authorities already cover their valid
  assertions.
- **Create no-op compatibility scripts:** rejected because they would turn a
  missing capability into a false PASS.
- **Call the Staff Auth helper directly without a package script:** rejected
  because the aggregate must be checked against the root npm manifest.
- **Use the old Wave14A wrapper:** rejected because `test:browser` is the
  canonical current browser command and the wrapper was removed.

## Verification / Rollback

Run the manifest unit tests, all authorized local release gates, the targeted
Production Gate checks, strict OpenSpec validation, and `git diff --check`.
Create one ordinary local commit only after all required checks pass; do not
push, deploy, archive, sync, reset, rebase, stash, clean, squash, or amend.
