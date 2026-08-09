# Google Drive 冷归档运行与回滚 Runbook

## 默认状态

代码、D1 和本地配置均默认 hard-disable。四个环境开关和 D1 三个阶段开关必须分别批准；仅启用 M6 scheduler 不会启动归档。第一版容量按最多 8 名员工、每日约 200 单，批次上限 50，不引入新队列或数据库。

## 本地验收

1. 运行 `npm run check:drive-archive`。
2. 确认真实 scheduler runner dry-run 输出 Drive/R2 调用和 archive/Manifest/reconciliation/rehydration 业务事实写入均为 0。允许记录 `scheduled_job_states` / `scheduled_job_runs` 运行事实，不得把它们描述为归档业务写入为 0。
3. 使用 mock adapter 验收六个月边界、四类白名单、断点续传、并发租约、Drive 回读校验、R2 删除失败和受控读取。
4. 检查 `file_drive_archive_manifests` 不可更新/删除，`npm run db:verify` 与 migration guards 通过。

## 分阶段启用

1. **到期事实**：保持全部环境开关关闭，只产生经业务流程确认的订单关闭事实。
2. **影子复制**：开启全局归档与 copy；D1 `copy_enabled=1`，保持 proxy/read 与 delete 关闭。R2 仍是读取源。
3. **代理读取**：M10/最终老板外部接入清单完成后开启环境和 D1 proxy read；用匿名文件逐个验证 Buyer、Seller、Staff Audience 与 404 隐藏边界。
4. **删除 R2**：只有影子复制和代理读取验收通过后，才同时批准环境与 D1 delete。数据库约束要求 copy 和 proxy 已启用。

任何阶段失败先关闭后续阶段开关。不要删除 Drive 中已验证对象。

## 告警与恢复

- `authorization_failed`：停止删除，检查账号授权和 token 轮换；不得改为公开分享。
- `manifest_mismatch` / `drive_missing`：停止该文件和删除，核对 D1 Manifest、Drive 对象与账号目录。
- `r2_delete_failed`：文件停留在 `R2_DELETE_PENDING`，R2 保持；依赖恢复后由相同租约流程重试。
- 租约丢失或进程中断：等待 90 秒租约到期后续跑；resumable session 只保存在 D1 内部事实。

## 回滚

首次删除 R2 之前，可关闭 copy/proxy/delete 并回滚到 R2-only Worker。

首次删除 R2 之后，禁止直接部署不支持 Drive 代理的旧 Worker。必须逐个运行 owner-only rehydration：Drive 读回 → 校验不可变 Manifest → 写回原 R2 key → HEAD 校验。全部受影响对象恢复并核对后才能回滚；rehydration 不删除 Drive 永久副本。若任何对象无法校验，回滚必须阻断。

## 数据备份与恢复验收

发布前导出完整 D1，并分别保存 R2 清单与 Drive Manifest。当前候选的隔离恢复演练必须验证连续 `0001`–`0042`、schema 42、0032 引入的归档表与约束、Manifest 数量/哈希、已归档文件 Drive 可读、已回灌对象 R2 HEAD 一致、所有原 Audience 仍有效。未来 Migration 推进后必须使用当时重新核验的连续末号，不得继续硬编码 42。生产 D1、R2、Drive 的真实写入不属于本地验收。
