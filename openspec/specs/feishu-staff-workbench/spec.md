# feishu-staff-workbench Specification

## Purpose

Record that the former Feishu Staff authentication, workbench synchronization, callback and operational-alert integration is retired from the active V2 architecture.

## Requirements

### Requirement: Active runtime has no Feishu integration

The system SHALL NOT register Feishu authentication, callback, workbench synchronization or alert-delivery routes, adapters or scheduled jobs. Business work items and audit facts SHALL remain authoritative in D1 and SHALL be viewed and changed only through the protected Moonwhite Staff Web/API surfaces.

#### Scenario: Worker starts with the current release composition

- **WHEN** the API and scheduler are initialized
- **THEN** no Feishu client is constructed, no Feishu-specific outbox event is emitted or replayed and no Feishu network request can be made.

### Requirement: Release configuration rejects retired Feishu switches

Staging and production templates SHALL contain no `FEISHU_*` or `STAFF_AUTH_FEISHU_*` variable, Secret name, callback URL or activation switch. Release validation SHALL reject reintroduced retired Feishu configuration.

#### Scenario: A stale configuration is rendered

- **WHEN** an operator supplies a Feishu Staff, sync, callback or alert key
- **THEN** local release validation fails closed and grants no deployment authority.

### Requirement: Historical migration evidence remains immutable

Historical migrations and archived Change evidence MAY retain Feishu table names and past decisions solely to preserve schema continuity and audit history. No active service SHALL read those historical tables as current identity, permission, task or alert authority.

#### Scenario: Historical schema is upgraded

- **WHEN** migrations are applied in order
- **THEN** historical Feishu objects remain migration-compatible but inert, and the current Staff runtime continues to use Cloudflare Access plus Moonwhite Staff email identity.
