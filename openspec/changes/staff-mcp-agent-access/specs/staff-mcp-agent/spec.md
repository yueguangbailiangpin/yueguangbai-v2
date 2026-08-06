# Staff MCP and Agent Capability

## ADDED Requirements

### Requirement: MCP authenticates one current Staff actor per session

The system SHALL map each approved MCP client session to exactly one existing ACTIVE Staff user through an approved OAuth flow, SHALL recalculate current D1 authorization and data scope for every tool call, and SHALL NOT use a shared API key, client-provided Staff ID, role or scope as authority.

#### Scenario: Active authorized Staff

- **WHEN** an approved client invokes a tool for a mapped ACTIVE Staff user
- **THEN** the tool evaluates current roles, Personal DENY, Team and resource scope before reading any business data.

#### Scenario: Stale or fabricated identity

- **WHEN** the Staff is inactive, authorization changed, the session expired or the client supplies another Staff identity
- **THEN** the call fails closed without business data disclosure.

### Requirement: Staff MCP v1 exposes bounded read and draft tools only

The first Staff MCP version SHALL expose explicit bounded query tools and draft-generation tools through existing Application Services, SHALL use exact schemas and cursor limits, and SHALL NOT expose generic SQL, arbitrary HTTP paths or formal approval/finance mutation tools.

#### Scenario: Generate a WeChat draft

- **WHEN** an authorized Staff requests a message for one permitted business object
- **THEN** the tool returns a Chinese `DRAFT` with safe source references and performs no send or formal state change.

#### Scenario: Request direct settlement approval

- **WHEN** a caller asks the Agent to finalize a refund, settlement, rate or approval
- **THEN** MCP refuses the formal mutation and returns a controlled Web confirmation link or next-step instruction.

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
