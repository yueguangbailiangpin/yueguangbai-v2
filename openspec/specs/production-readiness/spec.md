# production-readiness Specification

## Purpose
定义月光白 V2 在本地或隔离环境中的生产候选备份、恢复、文件对账、容量验证、告警与回滚控制，以及外部 Production GO 边界；只有绑定明确 release commit 且经过认证的备份与验收证据才能进入放行审计。
## Requirements
### Requirement: D1 backups are complete, hashed and restorable

The release process SHALL produce an encrypted D1 backup with Schema inventory, row counts, critical financial aggregates, tool/version metadata and SHA-256 Manifest, SHALL authenticate a separate attestation bound to an explicitly supplied release commit, and SHALL prove restoration in an isolated database before Production GO.

#### Scenario: Backup and restore agree

- **WHEN** the candidate backup is restored into an isolated D1
- **THEN** attestation, release commit, bundle, Manifest, schema, row, relationship and financial assertions agree and application smoke reads succeed.

#### Scenario: Backup is incomplete or corrupt

- **WHEN** attestation authentication, release provenance, hash, schema, row or financial assertions differ
- **THEN** the release is blocked and the backup is not marked usable.

### Requirement: R2 and Drive files reconcile to D1 Manifest

The release process SHALL reconcile every formal D1 file object to exactly its expected R2 hot object or Drive archived object, SHALL verify status, size, MIME and checksum evidence, and SHALL report missing, orphaned, duplicate or mismatched content.

#### Scenario: Healthy file inventory

- **WHEN** the reconciliation runs against an approved environment
- **THEN** each formal file has one expected storage location and no unauthorized public link.

#### Scenario: File mismatch

- **WHEN** a D1 row lacks content, content lacks D1 authority or a checksum differs
- **THEN** Production GO is blocked until an auditable repair/recovery completes.

### Requirement: Production controls detect and contain failures

The system SHALL alert on Worker 5xx, authentication anomalies, stale/failed jobs, Outbox backlog, file/Drive/Feishu/MCP dependency failures and capacity thresholds, SHALL provide independent escalation when Feishu fails, and SHALL document tested kill switches and recovery runbooks.

#### Scenario: External Provider fails

- **WHEN** Drive, Feishu or MCP becomes unavailable
- **THEN** an independent alert identifies the dependency, affected scope and safe kill switch while D1 business integrity is preserved.

#### Scenario: Alert path is untested

- **WHEN** no receiver/time-stamped evidence exists for a required alert
- **THEN** production readiness remains incomplete.

### Requirement: Mainland and workload acceptance use the approved operating envelope

The release SHALL validate portals and protected images on China Mobile, China Unicom, China Telecom and the WeChat embedded browser, and SHALL run anonymous capacity and peak tests representing at most eight Staff and two hundred daily orders.

#### Scenario: Network matrix passes

- **WHEN** each required network completes the critical Buyer/Seller/Staff journeys
- **THEN** latency, upload/read results and request IDs are recorded as release evidence.

#### Scenario: One required network fails

- **WHEN** a critical journey or protected image consistently fails on a required network
- **THEN** Production GO is blocked or the business owner explicitly narrows rollout with recorded risk.

### Requirement: Production mutations require separate explicit authorization

The process SHALL keep main advancement, remote Migration, real data import, provider enablement, Scheduler/Drive deletion and deployment as separate approvals, and SHALL NOT infer authorization from planning, tests, Integration or OpenSpec completion.

#### Scenario: Tests pass without deployment approval

- **WHEN** all local and Staging gates pass but no explicit Production GO exists
- **THEN** no deployment or production resource mutation occurs.

#### Scenario: Approved rollback

- **WHEN** a release fails within its documented compatibility boundary
- **THEN** operators execute the tested stop/switch/restore or forward-recovery runbook and preserve audit evidence.
