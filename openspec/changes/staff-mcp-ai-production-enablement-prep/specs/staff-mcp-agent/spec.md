# Staff MCP and AI Production Enablement Preparation Specification

## ADDED Requirements

### Requirement: Protected resource metadata publishes reviewed public guidance

Production Staff MCP SHALL require exact same-origin HTTPS developer-documentation and privacy/data-use policy URLs, SHALL publish them as RFC 9728 `resource_documentation` and `resource_policy_uri`, and SHALL include only the static minimum `staff:mcp` scope with the protected-resource metadata URL in an unauthorized Bearer challenge. Missing, placeholder, credential-bearing, query-bearing, fragment-bearing, root, MCP-resource or cross-origin URLs SHALL fail closed.

#### Scenario: A client discovers reviewed public guidance

- **WHEN** a client reads valid protected-resource metadata
- **THEN** it receives the exact resource, authorization server, `staff:mcp` scope, developer-documentation URL and privacy/data-use policy URL without Secret, account or token data.

#### Scenario: Public guidance configuration is unsafe

- **WHEN** either public URL is missing, a placeholder, non-HTTPS, cross-origin, credential-bearing, root, query/fragment bearing or aliases the MCP resource/metadata path
- **THEN** production MCP metadata and transport remain unavailable while Web and ordinary API health remain independent.

### Requirement: Production tool discovery requires an explicit capability allowlist

Production Staff MCP SHALL require a non-empty, duplicate-free exact enabled-tool allowlist. It SHALL advertise and execute only listed, currently implemented D1-authoritative read/draft tools. Missing, empty, unknown, duplicate or unavailable projection names SHALL prevent production runtime construction. `STAFF_MCP_DISABLED_TOOLS` MAY further reduce the catalog and SHALL NOT re-enable any tool.

#### Scenario: Read-only phase is configured

- **WHEN** the approved allowlist contains only implemented read tools
- **THEN** discovery and direct calls expose only those reads, while draft and formal-write capabilities remain unavailable.

#### Scenario: An unavailable projection is requested for activation

- **WHEN** the allowlist contains `read_task_screenshot_v1` without an approved File Audience/Read Intent provider or contains `list_staff_exceptions_v1` without a D1 exception projection
- **THEN** production runtime fails closed and does not return mock data or an authoritative-looking empty result.

#### Scenario: A formal action is requested

- **WHEN** an MCP result suggests a finance, order, permission, approval or external-write action
- **THEN** MCP performs no mutation and returns at most the existing controlled Staff Web next step for fresh authorization and explicit confirmation.

### Requirement: Production preflight pairs configuration with Git-external activation evidence

The zero-network preflight SHALL validate a Git-external rendered configuration and a Git-external non-secret activation-evidence document. It SHALL require exact custom-domain/resource/public-URL alignment, one supported OAuth client-registration mode, exact HTTPS redirect URIs, PKCE `S256` and equality between the approved enabled-tool set and runtime configuration. It SHALL reject repository-located files, placeholders, supplied Secrets, unknown fields and drift, SHALL print no supplied values, and SHALL have no network, provider, deploy or mutation mode.

#### Scenario: Checked-in templates are inspected

- **WHEN** preflight reads the staging or production template without external files
- **THEN** it reports `DISABLED_BY_DEFAULT`, requires no MCP Provider field or service binding and records zero external calls, Provider calls, deployments and resource mutations.

#### Scenario: Local external files are structurally valid

- **WHEN** Git-external anonymous configuration and evidence satisfy every structural rule
- **THEN** preflight reports `LOCAL_CONFIG_AND_EVIDENCE_VALID_PRODUCTION_NO_GO` without printing their URLs, client identifiers or redirect values.

#### Scenario: Client registration evidence drifts

- **WHEN** client mode, client metadata/registration endpoint, redirect URI, PKCE method, resource, policy URLs or tool catalog is missing or differs from rendered configuration
- **THEN** preflight reports `BLOCKED` and performs no external action.

### Requirement: Production activation remains an owner-controlled external procedure

Local artifacts SHALL enumerate the minimum owner-controlled OpenAI/ChatGPT workspace, OAuth authorization-server administration, Cloudflare account/zone/custom domain, public reviewed privacy/data-use page, managed Secret names, D1/Service Binding validation, staged tool rollout and rollback steps. They SHALL NOT create or register accounts, clients, domains, Secrets or deployments and SHALL retain `PRODUCTION_NO_GO` until separate external evidence and owner approval exist.

#### Scenario: Local gates pass

- **WHEN** OpenSpec, preflight, timeout, redirect, non-JSON, replay, audit-failure, authorization, type and repository gates pass
- **THEN** only local implementation readiness is established; real registration, DNS/TLS, Provider behavior, privacy approval, deployment and production data remain unverified.

#### Scenario: Rollback is required

- **WHEN** an authorized future activation must be stopped
- **THEN** operators first disable the environment or D1 global MCP control, preserve Migration 0038 and immutable facts, verify Web/API health, and restore a prior schema-compatible Worker only while MCP remains disabled.
