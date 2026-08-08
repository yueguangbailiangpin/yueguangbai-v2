# production-cloudflare-web-r2-release-configuration Specification

## Purpose
Define the fail-closed local implementation and configuration contract for adapting private Cloudflare R2 storage, serving the same-origin Web SPA and preflighting staging/production release inputs without creating, reading, modifying or deploying real resources.
## Requirements
### Requirement: The Change makes no schema or remote-resource change

The Change SHALL declare `NO_SCHEMA_CHANGE`, SHALL preserve the continuous `0001`–`0037 Migration chain, SHALL NOT create `0038`, and SHALL NOT call Cloudflare APIs, deploy, mutate DNS/domains/routes, apply remote Migration, read real Secrets or access production data.

#### Scenario: Local implementation is complete

- **WHEN** all source, template, test and runbook work passes locally
- **THEN** the repository Migration tail remains `0037`, remote writes remain zero and production remains unmodified.

#### Scenario: A required external value is unavailable

- **WHEN** a D1/R2/account/domain/Secret/route value or external approval is missing
- **THEN** it remains an operator-required field and is neither guessed nor written to Git.

### Requirement: Cloudflare R2 adapts only to the existing private storage port

The Worker SHALL adapt one explicit R2 binding into the existing `ObjectStorageAdapter` / `FILE_OBJECT_STORAGE` port. It SHALL implement put, head, bounded-prefix read, full private read and delete with byte-size, content-type, SHA-256 and required metadata verification. It SHALL expose no bucket listing, public bucket, key, signed URL or permanent URL.

#### Scenario: Verified object lifecycle

- **WHEN** the existing upload service puts bytes through a valid anonymous or real R2 binding
- **THEN** the adapter preserves the receipt and HEAD metadata needed by existing upload-intent, verification, final-assertion and private-read services.

#### Scenario: Binding or object evidence is invalid

- **WHEN** the binding is missing/malformed or returned key, size, MIME, checksum or required metadata differs
- **THEN** the operation fails closed and existing compensation/cleanup semantics remain responsible for any stored object.

#### Scenario: PUT is ambiguous or its returned receipt is invalid

- **WHEN** the provider may have stored an object before rejecting the PUT promise, or returns a non-null receipt that fails key, size, MIME, checksum, metadata or ETag validation
- **THEN** the storage port marks that the object may exist, the upload service invokes its existing compensation path, successful deletion records `DELETED`, and failed deletion records a concealed, retryable `DELETION_PENDING` without exposing the object key.

### Requirement: Release configuration is explicit, separated and fail closed

The repository SHALL provide distinct staging and production templates. Each SHALL require an operator-supplied account ID, Worker name, exact HTTPS origin/custom-domain hostname, D1 name/ID, R2 bucket name, cron and managed Secrets outside Git. Missing values, placeholder markers, automatic/default resources, duplicate/wrong bindings, origin mismatch or wrong environment SHALL fail preflight.

#### Scenario: Placeholder template is inspected

- **WHEN** the dry-run reads a checked-in template
- **THEN** it reports only the required field and Secret names, marks the configuration blocked for operator input and performs no network or deploy action.

#### Scenario: Rendered configuration is invalid

- **WHEN** a local rendered config retains a placeholder, omits a binding, selects another environment, allows automatic provisioning or mismatches origin and domain
- **THEN** preflight exits non-zero without printing supplied values or Secrets.

#### Scenario: Rendered configuration is located in the repository

- **WHEN** `--config` is relative, lexically inside the repository, is an in-repository symlink, or resolves through an outside symlink back into the repository
- **THEN** preflight rejects it before reading content, reports only a fixed path error field and accepts only an absolute path whose real file is outside the repository.

### Requirement: External and destructive capabilities remain disabled

Staging and production templates SHALL set Scheduler, Staff Auth/Feishu, Drive copy, Drive proxy, Drive R2 delete, Feishu workbench sync/callback, Staff MCP and external alert delivery to disabled/false. R2 deletion required only for failed-upload compensation remains governed by the existing compensation contract; this Change SHALL NOT enable archive deletion.

#### Scenario: Template defaults are reviewed

- **WHEN** either environment template is parsed
- **THEN** every frozen kill switch is explicitly disabled and no provider credential is stored in vars.

#### Scenario: A capability is enabled in release input

- **WHEN** preflight sees any frozen switch enabled
- **THEN** it rejects the input and identifies the switch name without echoing any configuration value.

### Requirement: Web and API share one HTTPS origin with secure SPA hosting

The same Worker SHALL serve the Vite static build and `/api/*` on one operator-supplied HTTPS Custom Domain. Static assets SHALL use SPA fallback for Buyer/Seller/Staff deep links. `/api/*` and `/health` SHALL never fall back to HTML. Responses SHALL apply CSP, HSTS in staging/production, frame denial, MIME, referrer, permissions and bounded cache headers. Cross-origin API requests/preflight SHALL be rejected; wildcard CORS SHALL NOT be emitted. The Web source SHALL contain no JSX inline `style` attribute so `style-src 'self'` remains deployable without `unsafe-inline`; static verification SHALL fail if inline JSX style is introduced.

#### Scenario: Direct SPA deep link

- **WHEN** a browser navigates directly to an unmaterialized Buyer, Seller or Staff client route
- **THEN** the static binding returns the SPA shell with security headers and no protected server data embedded.

#### Scenario: API or cross-origin request

- **WHEN** the path is `/api/*` or `/health`, or an Origin differs from the exact configured application origin
- **THEN** API paths route only to Hono and cross-origin access fails without SPA fallback or wildcard CORS.

### Requirement: Local dry-run and acceptance evidence remain truthful

The dry-run SHALL read local templates and anonymous test bindings only, SHALL redact values, SHALL list owner-required inputs/approvals, SHALL perform zero Provider calls and SHALL contain no deploy operation. Static and automated tests SHALL cover R2 lifecycle/compensation/private reads, runtime bindings, templates, origins, headers, SPA fallback, build artifacts and redaction. Final Production GO evidence SHALL state local implementation present while real resources/config/network/deployment remain unverified and `NO-GO`.

#### Scenario: All local gates pass

- **WHEN** OpenSpec, tests, typecheck, build, migration/security and static verifiers pass
- **THEN** evidence may say `LOCAL_IMPLEMENTATION_READY` but SHALL NOT claim staging/production, real R2, HTTPS, custom domain or network acceptance.

#### Scenario: External evidence is absent

- **WHEN** owner-rendered config, real resources, Secrets, deployment, real-network smoke or final approval is missing
- **THEN** Gate 2 and overall Production GO remain unchecked and `NO-GO`.
