# 产品预约排序与下单日期排期 Runbook

## 1. 适用范围

本手册只覆盖 OpenSpec Change `staff-product-reservation-order-scheduling`。数据库目标为 schema 37、Migration `0037_product_reservation_order_scheduling.sql`。所有日期按 `Asia/Shanghai` 自然日解释；不部署、不连接生产 D1，也不触碰 R2、飞书、Drive、DNS、域名或真实 secrets。

实施前必须重新获取 `origin/main`，确认它仍是已归档 M15 的基线，确认 Migration `0001`–`0036` 连续，并确认所有本地 worktree、远程引用和活跃 OpenSpec Change 都没有另一个 0037 或并行 Migration writer。任一断言失败即停止，不抢号、不替其他 Change 重编号。

## 2. 权威业务检查

- 新产品版本必须保存正整数 N/M；修改只能新增版本。
- 角色始终硬限制为 owner/seller_ops。产品申请拒绝只要求 `PRODUCT_REVIEW`，批准额外要求 `DEMAND_PUBLISH`；需求拒绝/关闭只要求 `DEMAND_PUBLISH`，发布额外要求 `PRODUCT_REVIEW`。产品创建、新增版本、排期预览/确认仍要求双权限；pre_sales、buyer_refund 即使个人授权也不得写。
- 产品申请审核、需求审核上下文和需求审核必须在读出权威 Source 后重新解析当前授权和数据范围，对权威卖家组织执行 Scope；工作项指派继续校验，但不得把工作项组织元数据当成资源 Scope 权威。
- `DEMAND_REVIEW` 工作项先从 `GET /api/staff/demand-batches/:id/review-context` 读取权威需求版本与产品节奏，再以该 `expected_version`、北京时间首单日期和幂等键调用现有 review POST；不得把工作项版本当成需求版本。
- 发布需求时锁定首单日期和当时产品版本节奏；拒绝则保留审核原因且不创建排期版本。
- 有效预约按 `submitted_at ASC, id ASC`，仅含 `PENDING_REVIEW`、`APPROVED`。
- 排名 r 的日期为 `首单日期 + floor((r-1)/M) × N` 个自然日。
- 目标数量的最后理论日期不得晚于北京时间下单截止日。
- 改期必须先服务端预览，再以相同 `expected_version`、`preview_hash`、原因和 `Idempotency-Key` 确认。
- 新增产品版本和确认改期遇到响应不明时，未改变内容的主按钮、Enter 和“重试原请求”都必须以完全相同的 action/path/body/`Idempotency-Key` 重试；请求在途时锁定输入，确定性 4xx、成功、输入修改或重新提交预览后才释放旧请求。
- 排期版本、审计和 Outbox 只追加。预计日期不写订单资料、平台下单日期、正式订单或财务快照。
- 旧数据无完整事实时显示“尚未配置排期”。

## 3. 本地验证

在仓库根目录运行：

```sh
npm run db:verify
npm run verify:migration-guards
npm run db:migrate:local
npm run verify:product-reservation-scheduling
npm run test:product-reservation-scheduling
npm run test:product-reservation-scheduling:browser
```

验收必须同时覆盖 fresh、36→37、错序、重复、无部分 DDL、迁移前备份恢复、恢复后前向迁移、SQLite integrity/FK、本地 D1、权限/Scope、Buyer/Seller 隐私、预约状态压缩、日历边界、幂等重放、版本冲突、预览哈希失效以及订单/财务事实不变。

## 4. 迁移前备份、恢复与前向恢复

生产执行不属于本 Change。未来经老板批准进入生产窗口时，先按 [`PRODUCTION_READINESS_BACKUP_RESTORE.md`](./PRODUCTION_READINESS_BACKUP_RESTORE.md) 生成、加密并校验 schema 36 备份；备份清单、校验和、恢复演练证据和批准记录缺一不可。

若 0037 尚未成功且没有产生任何 schema 37 业务事实：

1. 停止 API/Web 写入并保留失败日志和迁移产物。
2. 恢复已校验的迁移前 schema 36 备份到隔离目标。
3. 验证 `PRAGMA integrity_check`、`foreign_key_check`、schema_version、核心表行数以及预约/订单/财务样本。
4. 修复 Migration 后从恢复副本前向执行 0037，再重复完整验收。

禁止在未校验的目标上继续尝试，也禁止删除/重建其他 Change 的 Migration。

## 5. 应用回滚

API/Web 可回滚到不暴露产品排期路由和导航的上一兼容版本，但数据库保持 schema 37。应用回滚不得删除 `demand_order_schedule_versions`、修改历史预约顺序、回写订单日期或改动财务事实。旧应用忽略新增的可空产品版本列与新表；恢复服务前先确认没有新旧应用交替写入同一需求。

一旦 schema 37 已产生排期版本、审计或 Outbox 事实，不执行 down migration，不 DROP 表/列/触发器。修复必须使用新的前向 Migration，并由新的串行 Migration writer 取得唯一编号。

## 6. 失败关闭与排障

- `VERSION_CONFLICT`：刷新需求与队列，再重新预览。
- `SCHEDULE_PREVIEW_STALE`：预览内容、队列或当前排期已变化，必须重新预览，不能复用旧哈希。
- `SCHEDULE_WINDOW_CONFLICT`：最后理论名额超过下单截止日，调整首单日期、N/M 或新建合适的产品版本后重试。
- `FORBIDDEN` / `SCOPE_FORBIDDEN`：检查唯一 Staff 角色、Personal DENY、权限和卖家/买家 Scope；不得临时扩大查询范围。
- “尚未配置排期”：属于合法历史状态，不能以当前产品节奏回填。

任何异常都应保留 request ID、幂等键、预览哈希、expected_version、审计事件和恢复证据；不得记录买家微信等超出最小投影的身份信息。
