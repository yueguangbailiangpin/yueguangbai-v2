# production-cloudflare-web-r2-release-configuration Delta

## MODIFIED Requirements

### Requirement: The Change makes no schema or remote-resource change

The repository-side staging bootstrap implementation SHALL declare `NO_SCHEMA_CHANGE`, SHALL preserve the continuous `0001`–`0070` Migration chain without modifying those Migration files, and SHALL NOT create `0071`. Repository validation SHALL NOT call Cloudflare APIs, deploy, mutate DNS/domains/routes, apply a remote Migration, read real Secrets or access production data. Any separately authorized staging activation SHALL use an independently reviewed fixed SHA and Git-external configuration/evidence, and SHALL remain outside production resources and real business data.

#### Scenario: Local implementation is complete

- **WHEN** all source, template, test and runbook work passes locally
- **THEN** the repository Migration tail remains `0070`, repository validation performs zero remote writes and Production GO remains blocked.

#### Scenario: A required external value is unavailable

- **WHEN** a D1/R2/account/domain/Secret/route value or external approval is missing
- **THEN** it remains an operator-required field and is neither guessed nor written to Git.

### Requirement: Release configuration is explicit, separated and fail closed

The repository SHALL provide distinct staging and production templates. Each SHALL require an operator-supplied account ID, Worker name, exact HTTPS origin/custom-domain hostname, D1 name/ID, R2 bucket name and managed Secrets outside Git. Production SHALL additionally require its reviewed Cron. Staging SHALL omit Cron while scheduled operations are disabled, enable observability, use staging-specific Worker/D1/R2/hostname identities and explicitly configure invitation-based Buyer registration against `staging-buyer-channel`. Its Cloudflare-generated opaque Access audience SHALL be compared against current-session production Access inventory rather than name heuristics. Missing values, placeholder markers, production/default or automatic staging resources, duplicate/wrong bindings, origin mismatch, wrong environment or a staging Cron SHALL fail preflight.

#### Scenario: Placeholder template is inspected

- **WHEN** the dry-run reads a checked-in template
- **THEN** it reports only the environment-applicable required field and Secret names, marks the configuration blocked for operator input and performs no network or deploy action.

#### Scenario: Rendered configuration is invalid

- **WHEN** a local rendered config retains a placeholder, omits a binding, selects another environment, targets production/default resources, lacks the governed Buyer registration configuration, allows automatic provisioning, mismatches origin and domain, disables observability or configures a staging Cron
- **THEN** preflight exits non-zero without printing supplied values or Secrets.

#### Scenario: Rendered configuration is located in the repository

- **WHEN** `--config` is relative, lexically inside the repository, is an in-repository symlink, or resolves through an outside symlink back into the repository
- **THEN** preflight rejects it before reading content, reports only a fixed path error field and accepts only an absolute path whose real file is outside the repository.
