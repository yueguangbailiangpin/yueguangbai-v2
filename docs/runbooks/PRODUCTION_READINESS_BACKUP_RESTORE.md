# 月光白 V2 — 生产备份、恢复与发布 Readiness Runbook

## 当前权威基线

本分支目标数据库为连续 Migration `0001`–`0058`，`app_schema_state.schema_version=58`。

生产上线前必须同时证明：

1. release SHA 与待部署代码一致；
2. D1 从生产只读导出后可以恢复到全新隔离数据库；
3. 恢复库 `schema_version=58`、`integrity_check=ok`、`foreign_key_check=0`；
4. D1 row counts、关键财务聚合、Buyer/Seller/Staff/订单/文件/调度 smoke read 与 Manifest 一致；
5. R2 Manifest 与 D1 `file_objects` 对账无 missing/orphan/hash/size/MIME 冲突；
6. 至少抽样读取真实备份对应的 R2 对象并校验 byte size + SHA-256；
7. 生成与 release SHA、Schema 58、D1 Manifest SHA、R2 Manifest SHA 绑定的恢复证明；
8. `/ready` 返回 `ready`，包括数据库、Scheduler、获客维护、对象存储和恢复证明全部通过。

任何一项失败都保持 Production NO-GO。

## 安全边界

真实 SQL、SQLite、R2 Manifest、加密包、密钥、OAuth/Provider 配置、客户数据、真实金额和对象 key 均不得进入 Git。工作目录必须位于仓库外并限制权限。备份密钥与密文分开保存。

恢复演练只允许写入新的隔离数据库，不覆盖任何生产数据库，不删除 R2，不部署 Worker，不修改 DNS/Cloudflare Access，不调用真实业务写接口。

## D1 备份

```text
npm run backup:d1:local -- \
  --database /outside-git/source.sqlite \
  --output-dir /outside-git/backup-candidate \
  --key-file /outside-git/keys/d1-backup.key \
  --release-commit-sha 40位小写候选Git提交SHA \
  --expected-schema 58
```

要求：

- release SHA 必须显式传入，禁止从 HEAD 猜；
- 输出使用 AES-256-GCM，派生认证密钥与加密密钥分离；
- 完整 Manifest 包含 schema inventory、全部表行数、关键财务汇总、完整性与 smoke read；
- 明文 dump/Manifest 只存在于受控临时目录；
- 最终密文、attestation 使用私有文件权限。

## D1 隔离恢复

```text
npm run restore:d1:local -- \
  --bundle /outside-git/backup-candidate/d1-backup.bundle.aes256gcm \
  --attestation /outside-git/backup-candidate/d1-backup.attestation.json \
  --restore-database /outside-git/restore-rehearsal/restored.sqlite \
  --key-file /outside-git/keys/d1-backup.key \
  --expected-release-commit-sha 40位小写候选Git提交SHA \
  --expected-schema 58
```

恢复目标必须不存在。恢复完成后再次检查：

- `app_schema_state.schema_version=58`；
- Migration `0001`–`0058` 连续；
- `PRAGMA integrity_check=ok`；
- `PRAGMA foreign_key_check` 无结果；
- 所有 Manifest 表行数一致；
- 关键财务聚合一致；
- Staff Cloudflare Access 身份表、Marketplace scope、Buyer/Seller、正式订单、渠道归因、Schema 51–58 新完整性表均可读。

## R2 Manifest 与抽样恢复

恢复证明必须与 D1 同一 release SHA 生成 R2 Manifest。Manifest 对每个稳定文件保存受保护引用、byte size、MIME、SHA-256，不把对象 key 或公开 URL写入 Git。

离线对账：

```text
npm run reconcile:files:offline -- \
  --database /outside-git/restore-rehearsal/restored.sqlite \
  --r2-manifest /outside-git/r2-manifest.json \
  --drive-manifest /outside-git/drive-manifest.json
```

必须无 missing、orphan、duplicate、size/MIME/SHA mismatch。随后从 R2 抽样 read-back 并校验 D1/Manifest 的 size + SHA。没有真实 read-back 只能说明“Manifest 自洽”，不能生成生产恢复证明。

## 恢复证明

Migration 0058 的 `production_recovery_attestations` 是当前 Schema 的恢复证明记录。只有完成真实隔离恢复 + R2 抽样后才允许写入：

- release SHA；
- schema_version=58；
- D1 Manifest SHA-256；
- R2 Manifest SHA-256；
- restored database integrity/fk 均通过；
- R2 sample read-back 通过；
- 证据说明与确认人。

该记录 append-only。旧 Schema 的恢复演练不会满足新版 `/ready`。

## Scheduler / Acquisition Maintenance 上线 Gate

生产模板要求：

```text
SCHEDULED_OPERATIONS_ENABLED=true
ACQUISITION_MAINTENANCE_ENABLED=true
```

发布后不得只看 Worker 200。`/ready` 要求关键 Job 有近期成功运行记录，并要求 Acquisition Maintenance 有近期成功记录。未实际成功运行过时 Production GO 不成立。

关键 Job：

- reservation_expiry
- instruction_expiry
- outbox_delivery
- file_orphan_cleanup
- staff_auth_cleanup

## Cloudflare Access Gate

Staff 正式认证是 Cloudflare Access + Moonwhite Staff email/role/Marketplace authority。生产必须配置：

```text
STAFF_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
STAFF_ACCESS_AUD=<Access Application AUD>
STAFF_AUTH_ALLOWED_ORIGINS=https://正式域名
```

不得再使用旧 Feishu Staff Auth Provider 作为生产登录路径。Feishu Workbench 旧兼容变量保持关闭，不等于 Staff 登录依赖飞书。

## 发布顺序

1. checkout 精确 release SHA；
2. 运行 Migration/contract/typecheck/test/build/browser 全量验收；
3. 使用生产 D1 只读副本执行 0001–0058 升级 dry-run；
4. 完成 D1 + R2 恢复演练并记录 Schema 58 recovery attestation；
5. 校验 Cloudflare Access 配置与 Owner email；
6. 校验 Scheduler 与 Acquisition Maintenance 生产开关；
7. 仅在明确批准后执行生产 Migration；
8. 部署 schema-compatible Worker；
9. 验证 `/health` 与 `/ready`；
10. Scheduler 至少成功运行并重新检查 `/ready`；
11. 才可进入 Production GO。

## 回滚原则

已经确认的订单、财务快照、客户登记、渠道来源事实不得删除或覆写。业务异常使用前向补偿/冲正/审计事件。数据库灾难恢复只能恢复到新隔离目标并经核验后按批准流程切换，不允许工具自动覆盖生产。
