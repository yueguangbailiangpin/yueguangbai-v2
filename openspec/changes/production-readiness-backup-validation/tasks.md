# Tasks: Production Readiness, Backup and Validation

## 0. Governance

- [ ] 0.1 Confirm every target Change is verified, synced/archived and cleanly integrated.
- [ ] 0.2 Freeze release inventory, responsible owners, secrets, providers, network matrix and approval gates.
- [ ] 0.3 Obtain separate authorization for each real remote resource/read/write/deploy action.

## 1. Backup and Restore

- [ ] 1.1 Implement D1 full backup, compression, SHA-256 and Schema/row/financial Manifest generation.
- [ ] 1.2 Implement R2/Drive Manifest reconciliation with missing/orphan/mismatch reports.
- [ ] 1.3 Restore into an isolated D1 and verify schema, rows, financial invariants and controlled file reads.
- [ ] 1.4 Document backup retention, encryption, access and recovery ownership.

## 2. Production Controls

- [ ] 2.1 Configure minimal alerts, dashboards, kill switches and provider-independent escalation.
- [ ] 2.2 Produce deployment, Migration, Scheduler, Drive-delete, Provider and rollback runbooks.
- [ ] 2.3 Verify production configuration contains no test Actor bypass, real Secret in Git or unsafe public storage.

## 3. Acceptance

- [ ] 3.1 Run full Staging journeys and anonymous eight-Staff/two-hundred-order capacity/peak tests.
- [ ] 3.2 Test Mobile/Unicom/Telecom and WeChat embedded browser portals and protected images.
- [ ] 3.3 Test real approved R2, Drive OAuth/proxy and Feishu callback with non-sensitive acceptance fixtures.
- [ ] 3.4 Test alert delivery, dependency outage, rollback and restore under controlled failure.
- [ ] 3.5 Complete privacy notice, AI processing disclosure, remaining retention and account-deletion decisions.

## 4. Historical Data and Release

- [ ] 4.1 Generate AUDIT/PREVIEW for any legacy import and obtain explicit business-owner approval.
- [ ] 4.2 Run idempotent staged import and reconciliation only after separate authorization.
- [ ] 4.3 Produce final evidence matrix with P0/P1 status; request a separate Production GO.
- [ ] 4.4 Never infer deployment/main/production authorization from passing tests alone.

## 5. Migration Decision and Rollback

- [ ] 5.1 Prove no Schema Migration is needed for release evidence or create a separately approved minimal consecutive Migration.
- [ ] 5.2 Rehearse compatible Worker rollback and each implemented Change's restore/forward-recovery boundary.
