# production-cloudflare-web-r2-release-configuration Delta

## MODIFIED Requirements

### Requirement: Release configuration is explicit, separated and fail closed

The repository SHALL provide distinct staging and production templates. Each SHALL require an operator-supplied account ID, Worker name, exact HTTPS origin/custom-domain hostname, D1 name/ID, R2 bucket name and managed Secrets outside Git. Production SHALL additionally require its reviewed Cron. Staging SHALL omit Cron while scheduled operations are disabled, enable observability, use staging-specific Worker/D1/R2/hostname/Access-audience identities and explicitly configure invitation-based Buyer registration against `staging-buyer-channel`. Missing values, placeholder markers, production/default or automatic staging resources, duplicate/wrong bindings, origin mismatch, wrong environment or a staging Cron SHALL fail preflight.

#### Scenario: Placeholder template is inspected

- **WHEN** the dry-run reads a checked-in template
- **THEN** it reports only the environment-applicable required field and Secret names, marks the configuration blocked for operator input and performs no network or deploy action.

#### Scenario: Rendered configuration is invalid

- **WHEN** a local rendered config retains a placeholder, omits a binding, selects another environment, targets production/default resources, lacks the governed Buyer registration configuration, allows automatic provisioning, mismatches origin and domain, disables observability or configures a staging Cron
- **THEN** preflight exits non-zero without printing supplied values or Secrets.

#### Scenario: Rendered configuration is located in the repository

- **WHEN** `--config` is relative, lexically inside the repository, is an in-repository symlink, or resolves through an outside symlink back into the repository
- **THEN** preflight rejects it before reading content, reports only a fixed path error field and accepts only an absolute path whose real file is outside the repository.
