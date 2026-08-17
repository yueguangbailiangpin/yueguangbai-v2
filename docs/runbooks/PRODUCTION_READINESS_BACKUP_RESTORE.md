# 月光白 V2 — 生产备份、恢复与发布 Readiness Runbook

## 当前权威基线
本分支目标数据库为连续 Migration `0001`–`0070`，`app_schema_state.schema_version=70`。

生产上线前必须同时证明：
1. `APP_RELEASE_SHA` 与待部署代码精确一致；
2. D1 生产只读导出可恢复到全新隔离数据库；
3. 恢复库 `schema_version=70`、`integrity_check=ok`、`foreign_key_check=0`；
4. D1 row counts、关键财务聚合、Buyer/Seller/Staff/订单/文件/调度/获客 smoke read 与 Manifest 一致；
5. R2 Manifest 与 D1 `file_objects` 无 missing/orphan/hash/size/MIME 冲突；
6. 抽样读取真实 R2 对象并校验 byte size + SHA-256；
7. recovery attestation 同时绑定当前 release SHA、Schema 70、D1 Manifest SHA、R2 Manifest SHA；
8. `/ready` 返回 ready，并通过 schema/scheduler/acquisition_maintenance/operational_alerts/object_storage/staff_access/release/recovery 全部检查。

任何一项失败都保持 Production NO-GO。

## 安全边界
真实 SQL/SQLite/R2 Manifest/加密包/密钥/Provider 配置/客户数据/真实金额/对象 key 均不得进入 Git。工作目录必须位于仓库外并限制权限；备份密钥与密文分开保存。

恢复演练只写新隔离数据库，不覆盖生产数据库、不删除 R2、不部署 Worker、不修改 DNS/Cloudflare Access、不调用真实业务写接口。

## D1 备份
```text
npm run backup:d1:local -- \
  --database /outside-git/source.sqlite \
  --output-dir /outside-git/backup-candidate \
  --key-file /outside-git/keys/d1-backup.key \
  --release-commit-sha 40位小写候选Git提交SHA \
  --expected-schema 70
```

release SHA 必须显式传入；输出使用既有 AES-256-GCM + release-bound attestation。Manifest 必须覆盖 schema inventory、表行数、财务汇总、完整性和 smoke read。

## D1 隔离恢复
```text
npm run restore:d1:local -- \
  --bundle /outside-git/backup-candidate/d1-backup.bundle.aes256gcm \
  --attestation /outside-git/backup-candidate/d1-backup.attestation.json \
  --restore-database /outside-git/restore-rehearsal/restored.sqlite \
  --key-file /outside-git/keys/d1-backup.key \
  --expected-release-commit-sha 40位小写候选Git提交SHA \
  --expected-schema 70
```

恢复目标必须不存在。恢复后确认：Schema 70、Migration 0001–0070 连续、integrity/FK、Manifest row counts、财务聚合，以及 Cloudflare Access Staff、Role×Marketplace、Buyer/Seller 多身份、Seller 多成员、订单异常、评论展示、提前本金凭证/超额余额、渠道归因、Agent scope、文件权限和调度对象可读。

## R2 Manifest 与抽样恢复
```text
npm run reconcile:files:offline -- \
  --database /outside-git/restore-rehearsal/restored.sqlite \
  --r2-manifest /outside-git/r2-manifest.json \
  --drive-manifest /outside-git/drive-manifest.json
```

必须无 missing/orphan/duplicate/size/MIME/SHA mismatch；随后真实抽样 R2 read-back。只验证 Manifest 自洽不能生成生产恢复证明。

## 恢复证明
只有完成真实 D1 隔离恢复 + R2 抽样后才允许 Owner 调用：
```text
POST /api/staff/production-readiness/recovery-attestations
```

请求必须包含：
- `release_sha = 当前 APP_RELEASE_SHA`
- `schema_version=70`
- D1 Manifest SHA-256
- R2 Manifest SHA-256
- restored database integrity=true
- restored foreign keys=true
- R2 sample read-back=true
- 证据说明

API 本身不执行备份。恢复证据应保存在受控外部位置；旧 release/旧 Schema 的 attestation 不满足新版 `/ready`。

## Scheduler / Acquisition Maintenance Gate
生产必须：
```text
SCHEDULED_OPERATIONS_ENABLED=true
ACQUISITION_MAINTENANCE_ENABLED=true
```

关键 Job：reservation_expiry / instruction_expiry / outbox_delivery / file_orphan_cleanup。

`/ready` 要求近期成功、最近失败不晚于成功，并检查 backlog 上限。Acquisition Maintenance 也必须近期成功。

## Cloudflare Access Gate
生产必须：
```text
APP_RELEASE_SHA=<当前部署Git SHA>
STAFF_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
STAFF_ACCESS_AUD=<Access Application AUD>
STAFF_AUTH_ALLOWED_ORIGINS=https://正式域名
```

旧 Feishu Staff Auth/Workbench 不是生产 Staff 身份依赖。

## 本地与外部检查分离
本地：
```text
npm run check:production-readiness
npm run verify:final-production-go:local
```
必须保持离线，不读取生产。

只有明确要检查当前生产时才执行：
```text
node scripts/probe-production-readiness.mjs
```
该命令会真实读取固定 HTTPS `/ready`。

## 发布顺序
1. checkout 精确候选 release SHA；
2. 全量 migration/typecheck/Vitest/build/Playwright；
3. 真实历史 D1 副本前向 upgrade dry-run（历史副本 → 当前 Schema 70）；
4. D1 + R2 recovery rehearsal；
5. 部署配置填入精确 `APP_RELEASE_SHA`、Access、Scheduler；
6. 只有在候选 release 已可验证的受控阶段登记同 SHA 的 Schema 70 recovery attestation；
7. 明确批准后执行生产 Migration / Worker 部署；
8. 验证 `/health`（liveness）与 `/ready`（release-bound readiness）；
9. Scheduler/Acquisition Maintenance 实际成功后再次检查 `/ready`；
10. 显式执行 production readiness probe；
11. 才可进入 Production GO。

## 回滚原则
确认订单、财务快照、客户登记、渠道来源等历史事实不得删除/覆写。业务异常用前向补偿/冲正/审计。灾难恢复先恢复到隔离目标并验收，再按批准流程切换；任何工具不得自动覆盖生产。
