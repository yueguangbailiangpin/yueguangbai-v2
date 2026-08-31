# Proposal: release-check-command-alignment

## Why

The release aggregate still names four npm scripts removed by the local
command consolidation at commit `668945fa`: the old production-readiness,
Drive, Staff Auth, and Wave14A browser aggregate names. A clean candidate
therefore reaches a missing-script failure instead of invoking the current
local release evidence.

## What Changes

- Align `scripts/release-check.mjs` with the root `package.json` script
  manifest and current command successors.
- Add a manifest guard that reports every missing release script and fails
  closed before any release sub-gate runs.
- Keep the current Staff Auth verifier and Drive preflight in the aggregate,
  retain the final Production GO local verifier, and use the canonical
  `test:browser` loopback suite.
- Correct the two current runbooks that still instruct operators to invoke
  removed aggregate names.

## Non-goals

- No migration, database schema, API, DTO, permission, financial, Amazon
  index, Seller payable, business-logic, or website change.
- No restoration of removed aggregate scripts and no empty PASS wrappers.
- No change to the production health endpoint, deployment configuration, or
  Production GO decision.
- No archive or sync of this Change.

## Migration / Security / Privacy

`NO_SCHEMA_CHANGE`. The change reads the committed npm manifest and local
source only. `audit:dependencies` remains the one explicitly authorized
public npm advisory/registry read for dependency safety; all other release
subcommands must remain local-only and must not contact Moonwhite production,
Cloudflare, D1 Remote, R2, Queues, Drive, Feishu, GitHub, or deployment
resources. No customer, order, financial, file, credential, or personal data
is added to the Change or runbooks.

## Rollback

Revert the one local commit for this Change. Rollback does not restore the
retired aggregate names; any future command reintroduction requires a separate
reviewed Change with an existing implementation and tests.
