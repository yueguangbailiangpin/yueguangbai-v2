# Design: Production Cloudflare/Web/R2 Release Configuration

## Migration → Contract → Implementation → Test → Rollback → Acceptance

### Migration

No database fact, state machine, permission, index or audit schema changes. The release preflight proves the repository chain is exactly continuous `0001`–`0037` and reports that a production ledger still requires a separately authorized read-only comparison. It never creates or applies Migration `0038`.

### Contract

The Cloudflare bucket binding is infrastructure authority only. A small adapter maps it into the existing `ObjectStorageAdapter`, so all callers continue using opaque D1-controlled keys and the existing upload-intent, authorization, capacity, byte/MIME/SHA, HEAD, final assertion, compensation, private read-intent and Audience rules.

The hosting contract uses one exact HTTPS origin for Web and `/api/*`. Browser code remains origin-relative. Cross-origin API preflight and requests are rejected; no wildcard or credentialed cross-origin CORS policy is created. A single Custom Domain hostname is an operator-supplied placeholder and is never selected by this Change.

### Implementation

The R2 adapter uses binding `put`, `head`, ranged `get`, full `get` and `delete`. PUT supplies SHA-256, content type and the existing internal metadata; every returned/head object must preserve size, MIME, checksum and required metadata. The adapter exposes no list operation, signed URL, bucket name or public URL.

The generic storage port distinguishes a definitely failed PUT from a failure where the object may exist. Once an R2 PUT is in flight, a provider rejection is ambiguous; after any non-null result, receipt validation failure is definitely post-write. The adapter marks both as possibly stored, and the existing upload layer—not permission or R2-specific business code—runs compensation. Delete failure continues through the existing concealed `DELETION_PENDING` plan.

The Worker runtime distinguishes `local`, `staging` and `production`. Staging/production require valid D1, R2 and static-asset bindings, an exact HTTPS application origin and matching allowed-origin value. Missing/invalid bindings or values return a sanitized dependency failure. Scheduler, Staff Auth/Feishu, Drive copy/proxy/delete, Feishu workbench sync/callback, Staff MCP and external alert delivery remain disabled in both checked-in templates.

Worker Static Assets serve `apps/web/dist`; `not_found_handling=single-page-application` preserves direct Buyer/Seller/Staff deep links. Worker-first routing lets one runtime attach CSP, HSTS, frame, MIME, referrer, permissions and cache headers while sending `/api/*` and `/health` only to Hono. Hashed assets may be immutable; the SPA shell is revalidated.

The preflight reads only a local template or explicitly supplied local rendered configuration. It validates field names and structure without echoing values, prints only required field/Secret names and approval categories, never loads Cloudflare credentials, never invokes Wrangler/API and has no deploy mode. Templates intentionally contain blocking placeholders; real rendered configurations must remain outside Git.

For `--config`, “outside Git” is executable policy: the input must already be absolute, its normalized lexical path must be outside the repository, and its `realpath` must also be an outside regular file. This rejects repository paths and symlink traversal in either direction before configuration content is read.

The CSP keeps `style-src 'self'` without `unsafe-inline`. Dynamic progress uses the native `<progress>` element and skeleton sizing uses stylesheet selectors; a recursive source verifier rejects every JSX `style=` attribute.

### Test

Anonymous in-memory R2 binding tests cover put/head/ranged read/full read/delete and malformed binding/metadata/checksum. Existing file service suites cover upload intent, ownership, capacity, HEAD verification, final D1 assertions, compensation, cleanup retry and Audience-protected reads; a default-app runtime journey is switched to the anonymous R2 adapter and consumes a private read intent.

Production-runtime tests cover missing/wrong bindings, placeholder-like values, environment mismatch, cross-origin API rejection, API-vs-SPA routing, deep-link fallback, security headers and cache policy. Preflight tests cover missing/placeholder/default resources, wrong environment, origin/domain mismatch, enabled kill switches and secret redaction. A reproducible Vite build check rejects source maps, external asset URLs and missing referenced assets.

### Rollback

Freeze the release SHA, configuration snapshot, D1 ledger, D1 recoverable backup and R2/Drive Manifest before any remote mutation. Deploy Web/Worker only with external switches off. Before first R2 archive delete, rollback may select a schema-compatible prior Worker. After first R2 archive delete, only a Drive-proxy-compatible Worker may run unless every affected object has been rehydrated and HEAD/SHA verified. Committed D1 business/financial/Audit facts are never down-migrated or overwritten.

### Acceptance

Local code and templates close the repository-implementation portion of Gate 2 only. Real resource creation, ID/domain/Secret injection, preflight of the owner-rendered configuration, Cloudflare validation/deployment, HTTPS/DNS, staging/production smoke, real R2 behavior, mainland/WeChat networks and final owner approval remain unexecuted blockers. Production GO therefore remains `NO-GO`.

## Rejected Alternatives

- Binding R2 directly as `FILE_OBJECT_STORAGE`: rejected because the Cloudflare binding does not implement the application port and would bypass explicit adaptation.
- Public bucket URLs or signed browser URLs: rejected because D1 Audience and read-intent authorization must be recalculated for every read.
- Separate Pages and API origins: rejected because the frozen Web client is same-origin and a split would add CORS/cookie risk without need.
- Missing D1/R2 names or IDs for automatic provisioning: rejected because Wrangler can create default resources; the release contract requires explicit existing resources and fail-closed validation.
- A deployment wrapper: rejected because this Change is local-only and has no authority to call Cloudflare.
