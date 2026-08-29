# Proposal: stage8-release-config-alignment

## Why

阶段 8 前置审计发现发布配置仍使用已退役的 `DRIVE_ARCHIVE_*` 命名，而
Cloudflare Worker 与冷归档 runtime 实际读取 `ARCHIVE_*`。因此，模板和预检
可能共同“通过”旧开关，却在运行时因新开关缺失而 fail-closed 返回 503；同时
文件读意图测试把随机 token 的偶然字符序列误当作永久 URL，定时任务并发测试
没有在同一测试中立即捕获两个 promise 的 rejection。

## What Changes

- 将四个 `ARCHIVE_*` kill-switch 设为唯一的发布配置规范，并在 staging、
  production、local 活动模板中明确以字符串 `"false"` 默认关闭。
- 让 Cloudflare release preflight、production configuration verifier、
  Google Drive activation preflight 和相关测试都检查同一组名称；缺失、
  非字符串或 `"true"` 均 fail-closed。
- 从活动模板、预检、verifier、合同和 runbook 中移除旧的
  `DRIVE_ARCHIVE_ENABLED`、`DRIVE_ARCHIVE_COPY_ENABLED`、
  `DRIVE_ARCHIVE_PROXY_READ_ENABLED`、`DRIVE_ARCHIVE_R2_DELETE_ENABLED`
  有效语义；历史交接/归档材料只在需要追溯时明确标为旧命名。
- 修正文件读意图 DTO 的结构化安全断言，以及定时任务并发幂等测试的
  rejection 捕获和 `REQUEST_IN_PROGRESS`/409 断言。
- 增加模板渲染产物、旧变量不能满足新校验、runtime 缺失开关不启动等防回归
  覆盖，并更新本 Change 的本地验收记录。

## Migration and non-goals

`NO_SCHEMA_CHANGE`：不修改、不新增、不删除 Migration，不改数据库业务逻辑、
`packages/contracts` 或前端源码/测试；不部署、不 push、不访问或修改任何
Cloudflare、D1、R2、Queues、Google Drive、生产数据，也不使用网络请求验证
真实资源。

## Risk and rollback

统一命名会让仍提供旧变量的渲染配置立即被拒绝，这是预期的安全阻断，避免
两套开关产生分叉状态。回滚仅可通过本地 revert 恢复本 Change 的模板/脚本/
测试/文档变更；绝不把旧变量重新接线为第二套 runtime 状态。
