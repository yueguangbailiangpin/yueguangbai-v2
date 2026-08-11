# staff-mcp-agent Specification

## Purpose
本规范定义第一阶段 Staff-only MCP v1 的本地合同与安全边界：仅提供受限读取、草稿和受控 Web 下一步，通过当前 Staff 身份与 D1 授权逐调用校验，并以精确输入/输出白名单、低敏不可变审计、限流、重放和 kill switch 保证失败关闭。Buyer/Seller MCP、真实 OAuth、外部注册和生产激活不在本规范的已启用范围内。
## Requirements
### Requirement: MCP authenticates one current Staff actor per session

The system SHALL map each approved MCP client session to exactly one existing ACTIVE Staff user through an approved OAuth flow, SHALL recalculate current D1 authorization and data scope for every tool call, and SHALL NOT use a shared API key, client-provided Staff ID, role or scope as authority.

#### Scenario: Active authorized Staff

- **WHEN** an approved client invokes a tool for a mapped ACTIVE Staff user
- **THEN** the tool evaluates current roles, Personal DENY, Team and resource scope before reading any business data.

#### Scenario: Stale or fabricated identity

- **WHEN** the Staff is inactive, authorization changed, the session expired or the client supplies another Staff identity
- **THEN** the call fails closed without business data disclosure.

#### Scenario: Local-only OAuth boundary

- **WHEN** this Change is run without the explicit local mock gates and an injected adapter
- **THEN** Staff MCP remains disabled and no real OAuth, ChatGPT registration or public MCP endpoint is used.

#### Scenario: Malformed verified-session response

- **WHEN** the OAuth verifier returns unsafe, ambiguous, oversized, duplicated or malformed client, session, Staff, expiry or scope values
- **THEN** the server treats the response as unverified, returns `UNAUTHENTICATED`, and does not use those values in audit, rate-limit or replay keys.

### Requirement: Staff MCP v1 exposes bounded read and draft tools only

The first Staff MCP version SHALL expose explicit bounded query tools and draft-generation tools through existing Application Services, SHALL use exact nested input and output schemas, positive runtime output projection and cursor limits, and SHALL NOT expose generic SQL, arbitrary HTTP paths or formal approval/finance mutation tools.

#### Scenario: Generate a WeChat draft

- **WHEN** an authorized Staff requests a message for one permitted business object
- **THEN** the tool returns a Chinese `DRAFT` with safe source references and performs no send or formal state change.

#### Scenario: Request direct settlement approval

- **WHEN** a caller asks the Agent to finalize a refund, settlement, rate or approval
- **THEN** MCP refuses the formal mutation and returns a controlled Web confirmation link or next-step instruction.

#### Scenario: Strict tools/call parameters, arguments and authority fields

- **WHEN** `tools/call.params` or tool arguments have an unknown field, `limit` above 50, an invalid cursor, client-supplied Staff/role/scope, model-supplied expected version or idempotency authority
- **THEN** server-side validation rejects it before Application Service execution.

#### Scenario: Application Service returns an undeclared output field

- **WHEN** an Application Service returns an unknown nested field, wrong type, oversized string or array beyond the tool-specific output schema
- **THEN** the server rejects the entire result before success audit, records only a safe failure audit, and returns no `structuredContent` or business payload.

#### Scenario: Buyer or Seller MCP discovery

- **WHEN** a client lists tools or tries a Buyer/Seller MCP tool name
- **THEN** only the frozen Staff registry is advertised and the Buyer/Seller tool is not registered.

### Requirement: Necessary raw business data is permitted but credentials remain forbidden

The system SHALL allow complete WeChat IDs and original screenshots only for a specific authorized task/object when required, SHALL preserve file Audience and resource authorization, and SHALL never return passwords, hashes, Cookies, Sessions, one-time tokens, Provider tokens, Secrets or unbounded dataset exports.

#### Scenario: Authorized screenshot request

- **WHEN** a Staff user with current file authority explicitly requests one task-relevant screenshot
- **THEN** the tool returns the protected content or a protocol-supported representation without object keys or storage IDs.

#### Scenario: Credential or bulk export request

- **WHEN** any prompt requests credentials, Secrets or an unbounded Customer dump
- **THEN** the tool rejects it, records a safe security outcome and returns no protected values.

### Requirement: Untrusted content cannot instruct tools or expand authority

The system SHALL treat customer text, reviews, OCR and file content as untrusted data, SHALL keep it separate from tool/control instructions, and SHALL reject any attempt within that content to select unauthorized tools, alter parameters or override D1 authorization.

#### Scenario: Prompt injection in screenshot text

- **WHEN** an authorized screenshot contains instructions to reveal other customers or call a finance tool
- **THEN** those instructions are treated as data and no additional resource or tool authority is granted.

#### Scenario: Tool parameter escalation

- **WHEN** model-generated parameters exceed the current Staff scope or schema
- **THEN** server-side validation rejects the call before Application Service execution.

### Requirement: Every MCP call is auditable and independently disableable

The system SHALL record Staff, client, tool/version, bounded business scope, outcome, request ID and time for every call, SHALL exclude raw secrets and file bytes from audit, and SHALL provide global and per-tool kill switches that do not affect controlled Web.

#### Scenario: Successful tool audit

- **WHEN** a Staff tool call succeeds
- **THEN** an immutable safe audit event links the actor, tool and business object without storing the full model conversation.

#### Scenario: MCP rollback

- **WHEN** MCP or one tool is disabled
- **THEN** new calls fail safely while D1 business facts and Web workflows remain available and unchanged.

#### Scenario: Replay, concurrency and rate limit

- **WHEN** the same client/session/request ID is replayed with the same hash, a conflicting hash, concurrently, or above the bounded rate
- **THEN** the server respectively returns the original result, rejects the conflict, reports in-progress, or rate-limits without repeating business execution.

#### Scenario: Audit dependency unavailable

- **WHEN** the immutable audit event cannot be persisted
- **THEN** the tool fails closed and returns no business payload.

### Requirement: Migration 0038 owns only production transport security state

The Change SHALL append continuous Migration `0038` and SHALL create only hashed OAuth subject bindings, token revocations, durable MCP replay, durable MCP rate state and MCP runtime controls. It SHALL reuse `staff_users` and immutable `audit_events` as authorities and SHALL NOT store a bearer token, Secret, prompt, Provider identifier or raw screenshot in replay, audit or logs. Ordinary replay JSON SHALL be text-only and no larger than 256 KiB.

#### Scenario: Migration is applied safely

- **WHEN** migrations `0001`-`0038` are applied once to a fresh local database
- **THEN** schema version becomes 38 and all MCP security constraints exist.

#### Scenario: Migration is skipped or repeated

- **WHEN** `0038` runs without schema 37 or is repeated
- **THEN** it aborts without partial DDL or version drift.

### Requirement: The HTTPS resource is strict and independently disabled

The Worker SHALL expose only `POST /mcp` for JSON-RPC and public RFC 9728 metadata at `/.well-known/oauth-protected-resource/mcp`. It SHALL reject non-HTTPS resource configuration, query parameters, batch payloads, malformed JSON, non-JSON content, oversized bodies, unsupported methods and malformed/missing bearer authorization. Disabled or incomplete MCP SHALL fail closed without making Web, `/health` or `/api/*` unavailable.

#### Scenario: An unauthenticated client discovers authorization

- **WHEN** a client requests the protected resource without a bearer token
- **THEN** it receives 401 and a sanitized Bearer challenge containing only the configured protected-resource metadata URL.

#### Scenario: MCP is disabled or invalid

- **WHEN** either switch, a required dependency or the D1 GLOBAL control is disabled/unavailable
- **THEN** MCP rejects without tool execution while ordinary Web/API health remains independent.

### Requirement: OAuth validation is audience-bound and fails closed

The resource server SHALL require exact authorization-server issuer metadata, authorization-code grant, PKCE S256, exact HTTPS authorization/token/JWKS/revocation endpoints, RS256 JWT signature, one signing key ID, exact issuer, configured audience and resource, valid expiry/issued-at/not-before and bounded token lifetime, unique required scope, subject, client ID, session ID and JTI. Unsupported headers/algorithms, ambiguous keys, unknown keys after one forced refresh, provider outage, revoked JTI or database failure SHALL reject.

#### Scenario: Anonymous valid token is verified

- **WHEN** a locally signed anonymous token and anonymous metadata/JWKS satisfy every claim and signature rule
- **THEN** the verifier continues to D1 binding and current Staff authorization without logging the token.

#### Scenario: A key rotates or provider fails

- **WHEN** `kid` is not in the first JWKS response
- **THEN** one forced refresh may select the new exact key; an absent/ambiguous key or refresh failure rejects.

### Requirement: One token maps to one current ACTIVE Staff

The keyed issuer/subject hashes SHALL select exactly one ACTIVE binding and one currently ACTIVE `staff_users` row. OAuth claims SHALL NOT grant roles, permissions, Team scope, Customer/Seller/Store access or File Audience. Current D1 authorization SHALL be recalculated on every catalog and tool call.

#### Scenario: Binding or Staff is not active

- **WHEN** the binding is missing/revoked/ambiguous or the Staff row is absent/inactive
- **THEN** the request is unauthenticated and no business data is returned.

#### Scenario: A token names business authority

- **WHEN** arbitrary role, permission, team or audience claims are present
- **THEN** they are ignored and cannot expand D1-derived authority.

### Requirement: Replay, rate, audit and kill switches are durable and composed

Production transport SHALL use D1-backed replay, fixed-window rate and GLOBAL/TOOL controls. Request keys and OAuth identifiers SHALL be keyed hashes. A repeated replayable request with the same canonical hash returns only a validated completed text result; a different hash conflicts; processing leases and records expire. Screenshot completion SHALL persist no response body and the same request SHALL return an explicit `REPLAY_NOT_AVAILABLE` without re-reading or returning image bytes. Rate limits apply globally and per tool. Every terminal tool outcome SHALL use immutable audit, and audit failure SHALL override success.

#### Scenario: A request repeats across adapters

- **WHEN** another adapter instance receives the same session/request ID and canonical arguments
- **THEN** D1 returns the original validated completed result without re-executing the application service.

#### Scenario: A screenshot request repeats

- **WHEN** a completed `read_task_screenshot_v1` request is repeated with the same request ID and arguments
- **THEN** D1 contains no image/base64 response and the request returns `REPLAY_NOT_AVAILABLE` without re-executing the file read.

#### Scenario: A control or audit dependency fails

- **WHEN** GLOBAL/TOOL control is disabled/unavailable or audit insertion fails
- **THEN** the tool fails closed and exposes no business result.

### Requirement: Expired security state has bounded cleanup

Production activation SHALL require an explicit cleanup switch. Each cleanup pass SHALL delete no more than a configured bound from each expired replay, rate and token-revocation table and SHALL fail closed on database error. It SHALL NOT delete subject bindings, runtime controls or immutable audit.

#### Scenario: Expired rows are cleaned

- **WHEN** cleanup is enabled and an MCP request arrives with expired and current rows present
- **THEN** only bounded expired replay/rate/revocation rows are deleted and current rows plus bindings, controls and audit remain.

#### Scenario: Cleanup is disabled or unavailable

- **WHEN** cleanup is not explicitly enabled or its D1 operation fails
- **THEN** production MCP does not activate or rejects the request while Web remains available.

### Requirement: Production composition uses supported Cloudflare bindings

The production Worker SHALL construct its application service from D1 and its token-status provider from a configured Cloudflare Service Binding. It SHALL NOT require JavaScript service objects in Wrangler vars. The token-status adapter SHALL send only keyed identifier fingerprints, use a fixed internal HTTPS target, enforce a timeout and bounded exact JSON response, reject redirects and fail closed on unavailable, malformed or inactive results.

#### Scenario: Supported bindings are present

- **WHEN** D1, the token-status Service Binding, managed hash Secret and complete non-secret configuration are present
- **THEN** the production runtime is constructible without mock or JavaScript object injection.

#### Scenario: Token-status binding is unsafe or unavailable

- **WHEN** the binding times out, redirects, returns an oversized/non-JSON/malformed body or reports inactive
- **THEN** token verification rejects without logging or persisting Provider identifiers.

### Requirement: Existing limited read/draft authority remains unchanged

The transport SHALL expose no new formal write tool. Existing Personal DENY, Team/Customer/Seller/Store scopes, File Audience and 404 isolation remain authoritative. A formal action SHALL return only a controlled origin-relative `/staff/...` path, where the employee must freshly authorize and explicitly confirm in Web.

#### Scenario: A formal action is requested

- **WHEN** an MCP draft or fact suggests an actual business mutation
- **THEN** no mutation occurs and the only next step is a controlled relative Staff Web path.

### Requirement: Templates, preflight and evidence are local and truthful

Checked-in staging and production templates SHALL keep MCP disabled and SHALL omit MCP Provider variables, OAuth endpoints, tool lists, Secrets and service bindings. Preflight SHALL be zero-network, accept only local template or Git-external rendered configuration, print field/Secret names rather than values, reject placeholders/missing/unsafe configuration and have no deploy mode. A separate approved activation configuration must supply and validate the complete MCP dependency graph. Acceptance SHALL not describe anonymous mocks/templates as real OpenAI/ChatGPT/provider verification.

#### Scenario: Checked-in template is inspected

- **WHEN** preflight reads a repository template
- **THEN** it reports MCP disabled by default with no Provider field or service binding, performs no fetch and emits no supplied values.

#### Scenario: Local gates pass

- **WHEN** all specified local tests and gates pass
- **THEN** only local implementation readiness is proven; real registration, issuer, JWKS, token, deployment, networking and production behavior remain unverified blockers.
