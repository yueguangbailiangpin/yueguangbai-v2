# Design: Production Readiness, Backup and Validation

## Backup Artifacts

D1 backup 包含 SQL/数据导出、Schema version、table/view/trigger/index inventory、每表 row count、关键财务聚合、文件/事件数量、压缩文件 SHA-256 和生成工具版本。R2/Drive Manifest 按 D1 file object 记录 storage location、object/file reference 的受保护表示、size、MIME、SHA-256、status 和关联数。Manifest 自身加密、访问受限，不进入 Git。

## Restore Rehearsal

每次正式上线候选至少执行一次隔离恢复：新建隔离 D1，按连续 Migration/backup 恢复，运行 Schema/row/hash/financial assertions，再使用匿名或授权的隔离文件位置验证 R2/Drive 读取。恢复环境不得回调生产飞书或发送消息。

## Release Validation

Staging 使用匿名/合成数据覆盖 Buyer、Seller、Staff、财务、文件、Scheduler、飞书、MCP。网络矩阵至少包含中国移动、联通、电信、微信内置浏览器，验证根页、登录、上传、受控图片、长列表、中文/时区和错误恢复。负载按八 Staff、二百订单/日并加入合理峰值突发。

## Observability and Runbooks

上线前配置 5xx、auth anomaly、Job stale/backlog、Outbox/Drive/Feishu/MCP failure、D1/R2 dependency 和容量告警。每个告警有 owner、阈值、诊断、kill switch、恢复和升级路径。飞书故障告警必须有独立主通道。

## Historical Import

旧数据只进入离线 AUDIT/PREVIEW：验证来源、字段映射、重复/冲突、金额、日期、Marketplace 和文件 Manifest；生成不可变 Preview 报告后由业务所有者批准。导入命令幂等、分批、可停止，不覆盖 V2 已完成事实。

## Rollback

部署计划明确兼容窗口。未产生新 Schema facts 时可切回旧 Worker；产生后遵循对应 Change 的 forward recovery/restore 边界。生产 GO、Migration、数据导入、Scheduler/Drive deletion 和 Provider enablement 分开授权。
