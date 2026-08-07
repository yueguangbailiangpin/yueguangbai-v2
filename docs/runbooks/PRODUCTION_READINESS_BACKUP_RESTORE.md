# 生产候选备份、恢复、对账与回滚 Runbook

## 安全边界

本 Runbook 当前只允许本地或经批准的隔离环境。不得由本地通过推断生产授权；不得部署、写线上 D1、删除 R2、调用真实 Google/飞书/OpenAI、修改域名/DNS 或配置真实接收人。所有时间事实为 UTC 毫秒，员工展示使用 `Asia/Shanghai`。

真实 D1 SQL、SQLite、压缩包、加密包、Manifest、密钥、OAuth/Provider 配置和含真实行数/金额的结果均不得进入 Git。Git 只提交匿名 Fixture 的汇总证据。备份创建成功不等于可恢复；只有隔离恢复报告为 `PASS` 才可把该备份标为可用。

## Migration 决定

本任务不增加业务事实、权限、状态机或审计表。备份 Manifest 在加密外部包中，发布证据在 Git 匿名文档中，现有业务 D1 无需保存第二份发布事实。因此不创建 `0035`；Migration 链保持连续 `0001`–`0034`，`app_schema_state.schema_version=34`。如果未来必须在 D1 持久化生产发布事实，必须另建 OpenSpec Change，并使用届时下一连续 Migration。

## 本地/隔离备份

1. 在仓库外创建权限受限的工作目录和 32 字节随机密钥；密钥与备份分开保管，均设为仅所有者可读。
2. 输入必须是本地或隔离 SQLite/D1 导出，不得直接把生产数据库路径或 Secret 写进命令历史、日志或 PR。
3. 执行：

   ```text
   npm run backup:d1:local -- \
     --database /outside-git/source.sqlite \
     --output-dir /outside-git/backup-candidate \
     --key-file /outside-git/keys/d1-backup.key \
     --expected-schema 34
   ```

4. 工具先创建一致快照，再执行完整 SQL dump、gzip、SHA-256、schema/table/view/trigger/index inventory、全部表行数、关键财务聚合、关系完整性、关键应用 smoke read 和 Node/npm/SQLite/Wrangler 版本采集。
5. 明文 SQL、压缩包和完整 Manifest 只存在于受限临时目录；最终写出 AES-256-GCM 加密包和最小 attestation，文件权限为 `0600`。attestation 不含数据库路径、对象 key、Drive ID、客户字段或财务行内容。
6. 若未来经逐项授权执行真实 D1 export，先把远程 SQL 导出到仓库外受限目录，再导入新的隔离 SQLite，运行本工具；不得直接访问旧生产资源或提交导出物。

## 隔离恢复

执行：

```text
npm run restore:d1:local -- \
  --bundle /outside-git/backup-candidate/d1-backup.bundle.aes256gcm \
  --restore-database /outside-git/restore-rehearsal/restored.sqlite \
  --key-file /outside-git/keys/d1-backup.key \
  --expected-schema 34
```

恢复目标必须不存在，工具禁止覆盖。恢复依次验证 AES-GCM auth tag、压缩/明文 SHA-256、schema version/fingerprint、四类 schema inventory、全部 row counts、关键财务聚合、`integrity_check`、`foreign_key_check` 和 Staff/Buyer/Seller/订单/文件/调度 smoke reads。任一差异返回 `FAIL` 或直接拒绝，不能把备份标为 usable。

恢复环境保持 Scheduler、Drive、飞书和 MCP hard-disabled，不配置回调或接收人。恢复演练输出只保留匿名汇总；隔离数据库完成审计后按受控临时数据流程销毁。

## R2 / Drive 离线对账

只允许离线 JSON Fixture/Manifest；脚本不调用 Provider、不删除 R2。每项格式为：

```json
{
  "authority_hash": "64位小写SHA-256",
  "protected_ref": "64位小写SHA-256",
  "byte_size": 1024,
  "mime_type": "image/jpeg",
  "sha256": "64位小写SHA-256",
  "public_url": null
}
```

`authority_hash` 由 D1 file ID 单向保护生成；`protected_ref` 由 R2 object key 或 Drive file ID 加存储类型前缀后单向保护生成。命令：

```text
npm run reconcile:files:offline -- \
  --database /outside-git/isolated.sqlite \
  --r2-manifest /outside-git/r2-manifest.json \
  --drive-manifest /outside-git/drive-manifest.json
```

报告固定覆盖 missing、orphan、duplicate、protected-ref、size、MIME、SHA-256 mismatch 和裸公开链接；只输出哈希 authority，不输出原始存储标识或 URL。任何 finding 阻断 Production GO。`DRIVE_ARCHIVED` 期望 Drive，其余稳定状态期望 R2；影子双副本必须在阶段证据中显式处置，不能静默当成最终稳定状态。

## 容量与峰值

`npm run dry-run:production-readiness` 使用 8 Staff、200 订单/日、15 分钟 50 单峰值、每单 4 个文件（共 800）、50 个可处理摘要、50 条批次上限运行匿名对账。必须得到 4 个订单批次、16 个文件批次、每 Staff 最多 25 单、零 finding、零外部调用。该结果证明本地算法在冻结规模内可执行，不替代真实 Provider 配额、D1/R2 容量或大陆网络验收。

## 告警、kill switch 与独立升级

发布合同固定覆盖 Worker 5xx、登录异常、job stale/backlog、文件、Drive、飞书、MCP、D1、R2 和容量。每项必须有阈值、低敏诊断、kill switch、恢复方法和 `PROVIDER_INDEPENDENT_REQUIRED` 升级通道。不得在仓库配置真实接收人；飞书失败时主升级通道必须独立于飞书。没有真实接收人和时间戳投递证据时保持 `OWNER_ACTION_REQUIRED / PRODUCTION_GO_BLOCKED`。

关键 kill switch：

- Scheduler：全局和逐 Job 禁用，等待租约到期后有界重放。
- Drive：copy、proxy-read、R2-delete 分阶段关闭；永不自动删除 Drive 永久副本。
- 飞书：sync 与 callback 分别关闭，D1/Web 继续权威运行。
- MCP：全局和逐工具关闭，受控 Web 不受影响。
- 文件/R2：停止新上传与 archive delete；只在 HEAD/SHA 验证后补偿或回灌。
- D1/发布：停止新写入，切回 schema-compatible Worker 或从已隔离验证的备份恢复。

## 部署与回滚边界

本任务不执行部署。经最终批准后的顺序必须是：确认 release SHA/配置快照/备份可恢复 → 保持外部开关关闭 → 应用获批 Migration（本候选无 0035）→ 部署兼容 Worker → 匿名 smoke → 分阶段启用 Provider/Job。Migration、部署、Scheduler、Drive delete、Provider 和 Production GO 必须分别批准。

首次 R2 删除前可切回 R2-only Worker。首次 R2 删除后，目标 Worker 必须支持 Drive proxy；否则必须按不可变 Manifest 将所有受影响对象 Drive→R2 回灌并 HEAD/SHA 验证，少一个都阻断回滚。已提交业务/财务事实不覆写或删除，只走领域前向补偿、更正或审计重放。

## 保留、加密与责任

- 备份密钥与密文分离，最小权限、MFA、双人恢复可用性和轮换由业务所有者在生产前确认。
- 备份保留周期、异地副本、恢复负责人、演练频率和销毁审批属于老板外部清单；未批准前不推断默认值。
- 任何删除前必须有最近一次隔离恢复成功证据、明确目标和可恢复性；本任务不删除任何真实数据。
