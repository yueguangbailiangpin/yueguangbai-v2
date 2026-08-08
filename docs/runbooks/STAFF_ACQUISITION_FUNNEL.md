# 员工获客漏斗本地运行与恢复手册

## 启用前条件

Migration `0036_staff_acquisition_funnel_workbench.sql` 只允许从 schema 35 前向升级。升级前必须完成可验证备份，确认 schema 35、`PRAGMA integrity_check=ok`、`PRAGMA foreign_key_check` 无行，并保持员工获客入口与定时维护关闭。微信身份秘钥必须是经批准的服务端 Secret，不得写入代码、日志、备份附件或前端。

本 Change 只完成本地实现与演练，不批准 Production GO。正式开放入口、设置 Secret、开启 Worker 或远程 Migration 都必须经总控单独授权。

## 本地验证

1. 运行 `npm run check:staff-acquisition`，确认迁移、合同、权限、幂等、隐私、自动关联、北京日期、前端和构建一致。
2. 运行 `npm run dry-run:staff-acquisition`。输出只能包含候选、豁免和可关联数量，不得包含微信号、hash、ciphertext、IV、姓名或备注。dry-run 前后业务表、租约、运行和 Audit 计数必须不变。
3. 使用隔离的匿名 fixture 演练一次非 dry-run，确认已有业务/财务/安全/争议/法务事实的线索不被匿名化，并确认重试不重复产生关联或匿名化事实。

## 日常观测与失败关闭

维护作业使用 `acquisition_maintenance_state` 的限时租约，每次只处理有界批次。观测 `last_started_at`、`last_succeeded_at`、`last_failed_at`、`last_error_code` 和 `acquisition_maintenance_runs` 中的低基数计数；不记录原始错误或身份值。

如秘钥缺失/无效、schema 未到 36、租约长期不释放、连续失败或候选数异常，立即关闭获客入口和定时调用，保留数据与审计事实，不降级为明文、不跳过隐私检查、不手工改状态。

## 回滚、恢复与前向修复

- DDL 执行失败：事务断言必须使全部 0036 DDL 回滚，schema 仍为 35。不得手工删除部分表；修复迁移后按 ledger 重试。
- 已成功升级但应用未开放：保持入口/作业关闭，可使用升级前已验证备份恢复到新的隔离数据库，再核对 schema 35、完整性、外键和行数。不在原库做局部 down migration。
- 已有获客事实：不回放旧程序覆盖渠道/身份/关联。通过新的连续 Migration 前向修复，保留原事件、Audit、幂等结果和不可变来源。
- 匿名化已成功：已清除的私人身份不从日志、缓存或临时文件恢复。如发现豁免规则缺陷，先停作业，保留审计事实，经独立决策后前向修复。

恢复或前向修复后重新运行专项、全仓和 OpenSpec strict 验证。该 Change 已完成本地验收、同步并归档，但归档不构成生产 Secret、远程 Migration、入口、定时作业或 Production GO 授权；这些外部项目仍须由总控逐项批准。
