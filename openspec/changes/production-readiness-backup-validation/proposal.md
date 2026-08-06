# Production Readiness, Backup and Validation

## Why

本地测试和 OpenSpec Verify 不能证明生产可恢复、真实 R2/Drive/飞书可用或中国大陆网络可访问。上线前仍需 D1 完整备份、R2/Drive Manifest、隔离恢复、监控告警、容量/负载、历史数据 Preview、移动/联通/电信和微信内置浏览器验收。

## What Changes

- 建立 D1 全量导出、压缩、SHA-256、Schema/row-count Manifest 和加密保管流程。
- 建立 R2 热文件与 Google Drive 冷归档 Manifest 对账及缺失/孤立报告。
- 在隔离环境执行 D1 恢复、R2/Drive 读取、登录与关键业务回读。
- 冻结生产告警、runbook、kill switch、部署/回滚和数据导入审批证据。
- 以最多八 Staff、每日二百订单运行匿名容量/峰值验收。
- 完成移动、联通、电信、微信内置浏览器及真实飞书回调/R2/Drive 依赖验收。

## Non-Goals

- 不在该 Change 开发新业务功能。
- 不自动创建/修改生产资源、导入真实数据、部署或推进 main。
- 不把备份成功等同于恢复成功。
- 不从旧生产数据直接导入；必须 Preview 后人工批准。

## Migration and Contract Impact

默认不需要业务 Schema Migration；若必须记录 backup/restore deployment evidence，应优先使用不可变外部 Manifest/审计产物，只有证明现有 Audit 无法满足时才通过独立连续 Migration 增加最小表。Contracts 包括 backup Manifest、restore report、release checklist、production smoke result 和 rollback record。

## Dependencies

依赖所有目标业务 Change 完成、OpenSpec sync/archive、干净 Integration，以及 Scheduled Operations、Drive、飞书和 MCP 各自通过匿名/本地验收。任何真实远程动作均需用户在当前会话逐项明确授权。

## Rollback Boundary

部署前保存应用版本、Migration 状态、D1/R2/Drive Manifest 和配置快照。Schema 变更按照其 Change 的回滚边界处理；不执行破坏性 down migration。发布失败先停新写入/外部 Job，切回兼容 Worker，必要时从隔离验证过的备份恢复。

## Acceptance

只有备份、恢复、Manifest、负载、告警、网络、浏览器、Provider、回滚和数据 Preview 全部具备时间戳证据且无 P0/P1，才可由业务所有者单独签发 Production GO。
