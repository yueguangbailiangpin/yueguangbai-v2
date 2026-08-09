## MODIFIED Requirements

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
