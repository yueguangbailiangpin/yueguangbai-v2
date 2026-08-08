# Change Proposal: Production Cloudflare/Web/R2 Release Configuration

## Why

The final Production GO audit proved that the repository has no production R2 binding adapter, no reviewable staging/production Worker configuration, and no frozen Web static-hosting, SPA fallback, security-header, same-origin API or release-preflight path. Those local gaps block Gate 2 even before any owner-authorized Cloudflare resource can be tested.

## What Changes

- Add a Cloudflare R2 binding adapter for the existing `ObjectStorageAdapter` / `FILE_OBJECT_STORAGE` application port.
- Add placeholder-only staging and production Wrangler templates with explicit D1, R2, asset, cron, origin and custom-domain fields.
- Add runtime and offline preflight validation that rejects missing bindings, placeholders, wrong environments, automatic resource provisioning, unsafe origins and enabled external/destructive features.
- Host the Vite build as Worker Static Assets with SPA fallback, Worker-applied security headers and origin-relative `/api/*` routing.
- Add a local-only dry-run, static verifier, rollback runbook and updated final Production GO evidence.
- Make ambiguous/post-write R2 PUT failures compensate through the existing storage port, enforce Git-external rendered configuration by lexical and real path, and keep CSP compatible by prohibiting JSX inline style.

## Out of Scope

- No Cloudflare account, Worker, D1, R2, Pages, route, domain, DNS, certificate, Secret, deployment or remote Migration action.
- No real resource identifier, bucket name, hostname, account identifier, Secret or production data in Git.
- No Google Drive, Feishu workbench, Staff MCP, external alert receiver or release-control implementation/activation.
- No public bucket, object key, permanent URL, direct R2 read route or change to file Audience/permission semantics.

## Migration and Contract Impact

`NO_SCHEMA_CHANGE`. The continuous repository chain remains `0001`–`0037`; this Change SHALL NOT create `0038`. The only new contracts are local release configuration, Cloudflare binding adaptation, Web hosting and release preflight. Existing file lifecycle, database, permission, idempotency, Audit, Outbox and cold-archive contracts remain authoritative.

## Rollback

Before any first R2 archive deletion, a schema-compatible prior Worker may be restored after disabling Scheduler and all external integrations. After any R2 archive deletion, rollback to an R2-only Worker is blocked until every affected Drive object is rehydrated to R2 and HEAD/SHA-256 verified. This Change itself performs neither deployment nor deletion.

## Acceptance

Local acceptance requires strict OpenSpec validation, anonymous R2 binding put/head/prefix/read/delete tests, existing upload/HEAD/final-assertion/compensation/private-read tests, invalid-binding and placeholder tests, Web build/static/SPA/header/same-origin tests, dry-run redaction tests, typecheck/build and the appropriate full repository gates. The final conclusion remains `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO-GO` until real resources, owner-supplied configuration, secrets, deployment, networking and production evidence are separately authorized and verified.
