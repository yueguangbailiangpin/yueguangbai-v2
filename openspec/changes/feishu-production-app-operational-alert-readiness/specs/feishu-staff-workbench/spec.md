# Feishu Staff Workbench Delta

## ADDED Requirements

### Requirement: One formal app configuration covers Staff entry, Task v2, callback and safe alerts

The system SHALL provide a zero-network combined activation preflight that requires Staff Auth and Workbench to use the same non-placeholder App ID, Tenant Key and controlled HTTPS application origin, SHALL require the exact OAuth redirect and Workbench callback paths, and SHALL keep test and future AI applications outside this production configuration.

#### Scenario: Complete anonymous combined configuration

- **WHEN** a repository-external rendered config enables Staff Auth, Workbench sync/callback, Feishu-only scheduling and operational alerts with one matching App/Tenant and all managed Secret names declared
- **THEN** preflight reports local structural readiness, exact scopes and paths, zero external calls/mutations, and `PRODUCTION_NO_GO` until real owner evidence exists.

#### Scenario: Application identity or capability conflicts

- **WHEN** Staff Auth and Workbench use different App IDs/Tenants, a test/AI application is mixed in, a callback/origin drifts, or any unrelated external capability is enabled
- **THEN** preflight fails closed and names only the invalid field without printing any value.

### Requirement: The formal app sends only privacy-safe operational alerts

The system SHALL use only `im:message:send_as_bot` and one managed internal chat target to send strict low-cardinality operational notification DTOs, SHALL use a stable Provider UUID, and SHALL keep formal orders, finance, permissions, approvals, archives and customer data in the controlled Web.

#### Scenario: Alert threshold opens or resolves an incident

- **WHEN** the existing signal state machine emits an OPENED, REMINDER or RESOLVED notification
- **THEN** the bot sends one fixed Chinese text containing only server-owned enums, integer incident/count facts, Beijing display time and a controlled `/staff` link.

#### Scenario: Unsafe payload or recipient input is attempted

- **WHEN** a notification contains an unknown field, raw error, customer/order/finance/file fact, arbitrary URL, @mention or recipient from a request
- **THEN** strict parsing or fixed projection rejects/ignores it before any Provider request and no sensitive value is logged or persisted.

### Requirement: Feishu alert delivery is bounded and evidential

The system SHALL retain existing observation deduplication, thresholds, cooldown, recovery and incident versioning, SHALL add a 1–5 per-second local alert limit and stable Provider idempotency, and SHALL persist failed Feishu delivery as the existing payload-free `FEISHU_ADAPTER_FAILURE` signal without misclassifying the independent primary sink.

#### Scenario: Duplicate or burst notification

- **WHEN** the same observation or incident notification is evaluated again, or alert sends exceed the configured local rate
- **THEN** the signal state and Provider UUID prevent duplicate delivery, excess sends fail with a fixed rate-limited category, and no business fact rolls back.

#### Scenario: Provider delivery fails

- **WHEN** token/message calls time out, return 401/429/5xx, exceed the response bound or violate the success contract
- **THEN** finite retry applies, the incident remains durable, a fixed `FEISHU_ADAPTER_FAILURE` observation records failure without recursive delivery, and a later safe evaluation may retry from current state.

### Requirement: Independent primary alerting remains mandatory

The system SHALL treat Feishu operational messages as an auxiliary channel and SHALL NOT report Production GO until an independently operated non-Feishu primary alert receiver has passed delivery, failure and recovery acceptance.

#### Scenario: Feishu is locally ready but independent alert evidence is absent

- **WHEN** the adapter, combined preflight and anonymous tests pass but no independent primary alert acceptance exists
- **THEN** the result remains `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`.
