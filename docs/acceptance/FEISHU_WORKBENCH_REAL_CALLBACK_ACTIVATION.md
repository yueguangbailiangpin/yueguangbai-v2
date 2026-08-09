# Feishu Workbench Real Callback Activation

Date: 2026-08-09 (Asia/Shanghai)

## Accepted production facts

- The callback-compatible Worker was deployed as version `4893a81f-5e74-4d38-b497-b6e002f53854`; `/health` returned HTTP 200.
- The real Feishu developer console accepted `https://app.yueguangbai.net/api/feishu-workbench/callback` as a developer-server callback URL. This is the Provider URL-verification acceptance; no synthetic claim is substituted for it.
- Only `card.action.trigger` was subscribed. The legacy callback was not enabled.
- Application version `1.0.1` was published and approved without external-user or external-group bot access.
- The existing `task:task:write` application permission was retained, and the required task member data range was published as all internal members.
- The callback and sync kill switches are enabled. The scheduler is constrained to `feishu_sync`; the six standard jobs are disabled and acquisition maintenance remains disabled.
- The production database had one active Feishu Staff identity, zero open work items, zero pending/failed Staff work-item events, zero mirrors and zero Feishu dead letters at activation time. Therefore the controlled activation produced no Task v2 Provider write and did not create synthetic business data.
- The production activation version is `042ac4e6-63cd-4326-82f5-d60818353101`; `/health` returned HTTP 200 after activation.

## Bounded acceptance statement

Inbound URL verification and production configuration are accepted. The first real Task v2 create/update remains an operational observation tied to the first legitimate D1 Staff work item; it was not fabricated for this release. This does not change D1 authority or make Feishu a business truth source.

## Rollback

1. Set `FEISHU_WORKBENCH_SYNC_ENABLED=false` and deploy, which stops new Provider task writes.
2. If callback isolation is required, set `FEISHU_WORKBENCH_CALLBACK_ENABLED=false` and deploy.
3. Set `SCHEDULED_OPERATIONS_ENABLED=false` and clear the disabled-job list only after sync is off.
4. Keep D1 work items, mirrors, receipts, Outbox and dead-letter records intact. Do not delete or rewrite them during rollback.

No secret values, callback bodies, customer payloads or personal identifiers are recorded here.
