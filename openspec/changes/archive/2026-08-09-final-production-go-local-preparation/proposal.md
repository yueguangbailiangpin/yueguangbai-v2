# Change Proposal: Final Production GO Local Preparation

## Why

The repository contains broad local acceptance evidence, but local simulation, archived OpenSpec work and merged pull requests do not prove that Cloudflare, Google Drive, Feishu, Staff MCP, production backups or mainland-network journeys are configured or working. A final local-only release audit is required to freeze the trustworthy repository facts, identify stale evidence, separate owner-authorized external work from local repairs, and provide a fail-closed Production GO checklist.

## What Changes

- Freeze the fetched `origin/main` baseline, current Migration chain, M10 history, dependency advisory status and GitHub/automation snapshot.
- Classify every finding as repository-evidenced, locally repairable, owner-authorized, or Production GO blocking.
- Correct only stale local runbook statements and static production-readiness verification that no longer follow the governed `0001`–`0037` chain.
- Add a local static verifier, a detailed evidence audit and an owner-operated phased release checklist.
- Keep deployment, remote Migration, provider activation, real data access and final Production GO outside this Change.

## Out of Scope

- No D1 Migration, business Contract, Domain, API, Web behavior, permission, financial, file-lifecycle or identity change.
- No production Cloudflare config, R2 adapter implementation, Web hosting implementation, Feishu production adapter, public Staff MCP transport, alert receiver or CI/deployment workflow implementation.
- No remote write, deployment, production Migration, DNS/domain change, Secret read/write, real Provider call, production data read, push, PR, merge, commit, archive or OpenSpec sync.

## Migration and Contract Impact

No Migration and no business Contract change. The repository baseline remains the continuous `0001`–`0037` chain at schema 37. Any missing production adapter, hosting path, durable MCP boundary, external alerting, new Schema fact or contract change requires an independent future OpenSpec Change.

## Rollback

Revert this Change's documentation and static-verifier updates together. No database, external resource, deployed artifact or business fact requires rollback. Historical M10 evidence remains historical; this Change only adds a current release audit and updates current operational wording.

## Acceptance

The Change is locally complete only when its target and repository-wide OpenSpec strict validation, dependency audit, continuous Migration checks, production-readiness checks, full local gate, browser suite, secret scan and diff checks pass. Completion keeps the release at `NO-GO` until every external blocker has timestamped evidence and the business owner explicitly approves Production GO.
