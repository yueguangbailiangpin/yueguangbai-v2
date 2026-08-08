# Design: Final Production GO Local Preparation

## Evidence Authority

The audit uses, in order: fetched Git refs and current repository files; executable lockfile/Migration/static/test evidence; canonical decisions, product rules, contracts and specs; archived Change evidence for historical claims; GitHub read-only metadata; and finally operator-provided external evidence. A prose claim never overrides a failing command, unresolved placeholder, missing adapter or absent external receipt.

Evidence labels are fixed:

- `REPOSITORY_EVIDENCED`: current source, lockfile, Git history and executed local checks support the claim.
- `LOCAL_REPAIR`: this Change may correct governance documents or safe static verification only.
- `OWNER_AUTHORIZATION_REQUIRED`: the action changes an external account, resource, Secret, production dataset or release state.
- `PRODUCTION_GO_BLOCKED`: required evidence is absent, failed, stale, simulated, local-only or awaits explicit owner approval.

## Migration → Contract → Implementation/Configuration → Test → Rollback → Acceptance

### Migration

No new Migration. The current repository chain is `0001`–`0037`. The release operator must compare the approved release SHA, repository chain and remote D1 ledger before applying only missing migrations in exact order. Repository presence never proves a remote Migration ran.

### Contract

Existing production-readiness, cold-archive, Feishu and Staff MCP contracts remain unchanged. This Change adds only release-governance requirements. It does not claim that local mock/provider ports are production integrations.

### Implementation and Configuration

Only current runbook wording and static verification may change. Missing production R2 adaptation, Web hosting, Feishu workbench Provider, Staff MCP HTTPS/OAuth transport, external alerts and production Wrangler configuration are registered as independent follow-up work rather than implemented here.

### Test

The final local gate runs once after all edits. It covers dependency resolution/audit, secret scan, continuous migrations and guards, local D1, permission/Personal DENY, financial BigInt and DTO isolation, UTC/Asia-Shanghai behavior, Chinese Web behavior, backup/restore, cold archive, Feishu mock, Staff MCP mock, full Vitest/build and Chromium. External networks and Providers remain explicitly untested.

### Rollback

Before production, prove a release-bound encrypted D1 backup can restore into a new isolated target, reconcile R2/Drive manifests and preserve schema/rows/financial/file invariants. After any R2 deletion, an R2-only Worker rollback is forbidden until every affected object is rehydrated from Drive and HEAD/SHA verified. Committed business and financial facts use forward correction, never destructive down migration.

### Acceptance

Local completion is necessary but not sufficient. Production GO additionally requires owner-approved Cloudflare resources and config, real backup/restore, Provider and alert evidence, mainland networks and real browsers, permission/security isolation, privacy/compliance, release/rollback rehearsal and a final signed approval bound to one immutable release SHA.

## Deployment Configuration Gap Boundary

The repository has no current production Wrangler file or GitHub CI/deployment workflow. The example config contains placeholders, the local config keeps external switches off, the Web app has no checked-in Pages/Workers static-hosting deployment path, and the Worker receives `FILE_OBJECT_STORAGE` while the example exposes an `IMAGES` R2 binding without a production adapter bridge. Feishu workbench contains a mock adapter only. Staff MCP reports `productionActivationSupported=false` and registers no public `/mcp` route. These are implementation/configuration gaps requiring independent Changes; this governance Change must not fabricate them.

## Rejected Alternatives

- Treating merged PR descriptions or archived Change tasks as production evidence: rejected because they explicitly describe local-only work.
- Filling a production config with guessed IDs, domains or Secrets: rejected because it creates unsafe, unverifiable state.
- Enabling all integrations in one release step: rejected because Drive copy/proxy/delete, Feishu sync/callback, Scheduler, MCP and deployment require separate kill switches and approvals.
- Accepting a text statement of zero vulnerabilities: rejected in favor of lockfile resolution, installed dependency tree, current registry audit and advisory range evidence.
