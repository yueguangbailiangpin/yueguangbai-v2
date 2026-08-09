# feishu-staff-workbench Specification

## Purpose
在保持 D1 为员工身份、权限、任务和业务事实唯一真值的前提下，提供默认关闭的飞书员工工作台生产适配：仅镜像最小任务摘要与受控深链接，并将通过官方验签、解密和重放保护的低风险回调重新授权后路由到既有 D1 命令。真实飞书激活仍须老板本人完成匿名 PoC 和 Production GO。
## Requirements
### Requirement: Anonymous PoC gates real Feishu integration

The system SHALL provide a production-capable but default-disabled Feishu Task v2 adapter and official callback boundary, and SHALL keep every real Feishu integration switch disabled until the final business owner verifies current application scopes, bot/task capability, callback, deep-link, administrator, quota and mainland-network behavior using anonymous data.

#### Scenario: Local implementation is complete but owner evidence is absent

- **WHEN** all anonymous local adapter, factory, callback, D1 and preflight tests pass but no real owner evidence exists
- **THEN** the result is `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO` and all production Feishu switches remain false.

#### Scenario: Required capability is insufficient

- **WHEN** a real owner-authorized PoC later finds a missing scope, unsupported action, quota shortfall or unsafe callback behavior
- **THEN** activation remains disabled and the system requests an explicit design decision instead of weakening D1 authority or security.

### Requirement: D1 remains identity, permission and task authority

The system SHALL map both source and target Feishu `open_id` within one configured tenant to unique ACTIVE D1 Staff users, SHALL recalculate the current unique role, Personal DENY, Team and Scope before every callback action, and SHALL keep Staff Auth activation independent from workbench activation.

#### Scenario: Workbench enabled while Staff Auth remains disabled

- **WHEN** only the workbench sync prerequisites are valid and Staff Auth is disabled
- **THEN** the adapter may be constructed for the scheduled sync path without enabling or changing Staff login or internal Sessions.

#### Scenario: Provider claims D1 authority

- **WHEN** callback data includes or attempts to substitute a Staff ID, role, permission, scope, business state or financial fact
- **THEN** strict parsing rejects it and no D1 business fact changes.

### Requirement: Feishu receives only actionable safe task summaries

The system SHALL use the official self-built-app tenant-token and Task v2 APIs to create or update one provider task per actionable D1 work item, SHALL send only a Chinese safe title, controlled HTTPS deep link, minimal status/completion projection and current assignee `open_id`, and SHALL use a hashed stable `client_token` rather than a bare internal identifier.

#### Scenario: Actionable work item is created

- **WHEN** a current D1 OPEN work item has exactly one ACTIVE configured-tenant assignee identity and no mirror
- **THEN** one Task v2 create request uses the stable client token and persists only the returned provider GUID as mirror key after strict success validation.

#### Scenario: Unsafe identity or summary data is present

- **WHEN** the assignee identity is missing/conflicting/inactive or the DTO/deep link violates the whitelist
- **THEN** the event is classified `contract_rejected` before a Provider task request and no customer, finance, proof, Secret, Provider body or bare Staff ID is emitted.

### Requirement: Feishu task actions use versioned D1 commands

The system SHALL accept only official signed and encrypted `card.action.trigger` callbacks or verified URL challenges, SHALL bind callback app/tenant/token/operator/action fields to configuration, and SHALL route the sole `REASSIGN_WORK_ITEM` action through the existing idempotent expected-version D1 command.

#### Scenario: Valid encrypted reassignment callback

- **WHEN** the X-Lark signature and five-minute timestamp pass, AES-CBC decrypt succeeds, Verification Token/App ID/tenant match, event and nonce are new, and both open IDs map to authorized ACTIVE Staff
- **THEN** the existing D1 reassignment command executes atomically and the callback returns a Chinese safe result without IDs or business details.

#### Scenario: Replay, mismatch or version race

- **WHEN** an exact successful event is repeated, an event/nonce/payload mismatches, or expected version is stale
- **THEN** exact success replays the committed receipt, mismatches return `401`, and version conflict changes no business fact while enqueueing minimal reconciliation from current D1.

### Requirement: Provider failure never rolls back business facts

The system SHALL cache tenant tokens in memory with early expiry and concurrent refresh coalescing, SHALL bound request time and response size, SHALL apply a conservative local rate limit and finite retry policy, SHALL retry only safe transient failures, and SHALL expose only fixed redacted failure categories to Outbox/dead-letter/alerts.

#### Scenario: Token or Provider is transiently unavailable

- **WHEN** token/task calls time out, return 408/425/429/5xx, or fail at the network boundary
- **THEN** the adapter performs at most the configured finite retries, respects only bounded Retry-After, emits `RATE_LIMITED` or `UNAVAILABLE`, and leaves D1 business facts committed.

#### Scenario: Configuration or response contract is unsafe

- **WHEN** a required switch/Secret/origin/app/tenant value is absent, a response is oversized/malformed, or Provider returns a non-retryable contract error
- **THEN** activation fails closed without network where possible, the error is `CONTRACT` or disabled, and no raw response, token, Secret or open_id is persisted in logs or client responses.

### Requirement: Activation preflight is local, staged and non-authorizing

The system SHALL provide default-disabled staging/production template fields, exact managed Secret names and a local preflight that validates an external rendered config without making network calls, deployments or resource mutations.

#### Scenario: Template or incomplete config is inspected

- **WHEN** an operator inspects repository templates or omits any required Feishu production prerequisite
- **THEN** the result is blocked, all switches remain false, and output names missing fields without printing their values.

#### Scenario: Anonymous rendered config is structurally valid

- **WHEN** an external anonymous config satisfies origin, app, tenant, timeout/rate/retry and separate sync/callback prerequisites
- **THEN** preflight reports only local structural readiness and still states that real Feishu scopes, callback, quota, mobile/network and owner approval are unverified.

### Requirement: Feishu-only scheduling excludes acquisition maintenance

The system SHALL gate acquisition maintenance behind an independent `ACQUISITION_MAINTENANCE_ENABLED` switch that defaults closed, SHALL read its dedicated identity Secret only after that switch is exactly `true`, and SHALL require the switch to be exactly `false` for Feishu workbench activation.

#### Scenario: Exact Feishu-only schedule is triggered

- **WHEN** `SCHEDULED_OPERATIONS_ENABLED=true`, `FEISHU_WORKBENCH_SYNC_ENABLED=true`, all six standard scheduled jobs are disabled, and `ACQUISITION_MAINTENANCE_ENABLED=false`
- **THEN** the handler runs and records only `feishu_sync`, creates no acquisition maintenance run, reads no acquisition identity Secret, and performs no acquisition anonymization or other maintenance write.

#### Scenario: Acquisition maintenance is missing or enabled during Feishu activation

- **WHEN** a rendered Feishu activation config omits `ACQUISITION_MAINTENANCE_ENABLED` or sets it to any value other than exact `false`
- **THEN** activation preflight and release runtime fail closed without treating the configuration as Feishu-only.

### Requirement: Real Feishu callback activation preserves a no-write registration boundary

The system SHALL accept a Feishu callback URL-verification request without formal signature headers only when the bounded body is an exact plaintext challenge or exact encrypted wrapper, the decoded object contains only `challenge`, `token` and `type`, `type` is `url_verification`, and the Verification Token matches the managed secret in constant time. This registration path SHALL NOT read or write D1, resolve Staff authority or execute any action. Every non-registration callback SHALL continue to require all formal signature, timestamp, nonce, Encrypt Key, Verification Token, App/Tenant, replay, Staff authorization, Personal DENY, Scope, version, idempotency, Audit and Outbox controls.

#### Scenario: Real console verifies the callback URL

- **WHEN** Feishu sends a bounded plaintext or encrypted URL challenge without `X-Lark-*` signature headers and with the configured Verification Token
- **THEN** the Worker returns only the same challenge within the Provider deadline and performs no D1 operation

#### Scenario: Unsigned action attempts to use the registration exception

- **WHEN** a request without all formal authentication headers contains an event, card action, extra field, wrong token or partially supplied authentication headers
- **THEN** the Worker rejects it without a D1 read, write or business action

#### Scenario: Formal card action remains strongly authenticated

- **WHEN** Feishu delivers a non-registration card callback
- **THEN** the existing signature window, encrypted exact contract, replay receipt, current Staff authorization, Personal DENY, Scope and versioned D1 command remain mandatory
