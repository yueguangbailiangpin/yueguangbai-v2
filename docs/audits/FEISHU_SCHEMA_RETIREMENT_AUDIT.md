# Feishu Schema Retirement Audit

## Scope and conclusion

本审计基于 `feature/frozen-portals-staff-acquisition-core` 的 `8cb39ed870df1fc5c6874dd4e5b86e12e22c39d2`，在隔离 worktree 内执行完整 0001–0065 fresh/sequential Migration inventory。用户确认系统从未投入使用且不存在业务/审计数据；未读取生产 D1。

结论：新增前向 `0065_retire_feishu_artifacts.sql`。0001–0064 字节保持不变；0065 删除飞书专属对象、旧登录/绑定临时表及已失去用途的 `staff_auth_cleanup` Schema 分支，并从共享 Scheduler/告警约束移除飞书值。

## Runtime result

- Worker/Web 没有飞书登录、绑定、同步、回调、任务镜像或告警执行路径。
- staging/production/local 核心模板不含 `FEISHU_*` 或 `STAFF_AUTH_FEISHU_*` 配置。
- 源码和发布预检中的飞书字符串只用于拒绝旧 Header/配置的负向安全规则。
- 历史 Migration、旧验收记录和负向测试不构成运行能力。

## Exact Schema inventory after 0064

### Feishu-named historical tables

| Table | Origin | Fresh rows | Reverse foreign keys | Retention decision |
| --- | --- | ---: | ---: | --- |
| `feishu_staff_identities` | 0002 | 0 | 0 | 0065 删除 |
| `feishu_workbench_mirrors` | 0033 | 0 | 0 | 0065 删除 |
| `feishu_workbench_callback_receipts` | 0033 | 0 | 0 | 0065 删除 |

三张表另有 4 个显式索引和 6 个不可变/转换 Guard Trigger。没有其他表通过 Foreign Key 引用它们；0065 删除表时一并删除这些专属对象。

### Shared or neutral-named historical objects

- `staff_login_states`、`staff_auth_rate_limits`、`staff_auth_security_events`：只服务旧飞书 Staff 登录；0065 删除。
- `staff_binding_invitations`、`staff_binding_login_states`：只服务旧飞书绑定邀请；0065 删除。
- `scheduled_job_states`：0065 重建并移除 `feishu_sync`、已无实现的 `staff_auth_cleanup`。
- `scheduled_operational_signals`、`scheduled_alert_states`：0065 重建并移除 `FEISHU_ADAPTER_FAILURE`，保留通用外部适配器告警能力。

重建过程先断言所有目标表为空；任何意外业务、登录、调度或告警行都会使整个 Migration 回滚。空系统重建后恢复索引，并通过 `integrity_check`、`foreign_key_check`、fresh/sequential、空系统升级和非空拒绝测试。

## Migration result

0065 后 Schema 中 name/SQL 均不再包含 `feishu`，表/索引/Trigger/View inventory 为 `214/612/406/12`。当前 Cloudflare Access `staff_sessions`、Staff email/role/Marketplace authority、通用审计和五个有效 Scheduler job 保持不变。

Migration 只在本地验证，未远程执行。项目未来若上线，应以 65 为唯一目标 Schema；不得重新引入飞书表、枚举、配置或运行入口。

## External boundary

`PRODUCTION_D1_READS=0`、`PRODUCTION_D1_WRITES=0`、`REMOTE_MIGRATIONS=0`、`FEISHU_RESOURCES_TOUCHED=0`。
