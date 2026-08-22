# 隔离 Staging 建设与验收

本 Runbook 只适用于隔离测试环境，不授权生产操作。Staging 可以与 production 使用同一 Cloudflare Account，但必须使用不同的 Worker、D1、R2、Custom Domain、Access Application/Audience、Secrets 和测试身份。这是资源隔离，不是 Account 级信任隔离。

## 1. 开始前固定证据

操作者必须记录：

- 已完成独立审查的精确 40 位 Git SHA；
- Cloudflare Account ID；
- 新建 staging Worker/D1/R2 的名称和 ID；
- staging HTTPS origin、Access team domain、Access application audience；
- staging Secret 的负责人、轮换和吊销计划；
- production Worker/D1/R2 的只读名称清单，作为禁止目标，不读取其中数据。

建议资源名：

```text
Worker: yueguangbai-v2-staging
D1:     yueguangbai-v2-staging
R2:     yueguangbai-v2-staging-files
```

任何名称/ID 与 production/default 重合、配置仍含 `REQUIRED_*`、Git SHA 漂移或工作树不干净时立即停止。Access Audience 是 Cloudflare 自动生成的 opaque tag，不要求包含 `staging` 文本；必须从当前会话只读 Access Application 清单中取得，并与 production Audience 做精确不等比较。

## 2. 远程阶段顺序

每阶段单独记录结果并保留回滚能力，禁止一条脚本把所有远程动作串起来：

1. 创建 distinct staging D1 与 R2；确认没有 production binding。
2. 在 Cloudflare Zero Trust 创建 distinct staging Access Application、Audience 和五个测试 Staff 邮箱的 allow policy。验证码由邮箱所有者输入，不能交给 Agent。
3. 在 Git 外渲染 staging Wrangler config，运行 release preflight；此时不部署。
4. 只对 staging D1 应用 migrations `0001`–`0070`，核对 `app_schema_state=70` 和 Migration ledger。
5. 执行一次性 first-owner bootstrap；同一原子 batch 同时建立唯一的 `staging-buyer-channel`，不得另行手搓 SQL。
6. Owner 首次通过 Access OTP 登录后，用正式 Staff 账号管理界面创建另外四个角色。
7. 用正式 Staff customer onboarding/activation/password 流程创建 synthetic Buyer 和 Seller；不得直写业务表。
8. 注入 staging-only managed Secrets，构建并部署独立审查通过的固定 SHA。
9. 验证 `/health`、`/ready`、五角色权限链、Buyer/Seller 门户、R2 私有文件链。
10. 对 staging D1/R2 做加密备份、恢复到新的隔离目标并核对 Schema/清单/哈希；不覆盖原 D1。
11. 启用 staging Worker observability 和独立外部健康监控，连续观察后再讨论 Production Readiness。

生产资源、生产数据、生产 Secret、生产 DNS、生产 Access、生产 Scheduler 和真实业务账号在以上全部阶段都不得接触。

Migration `0069` 的整库健康检查不得嵌入 D1 migration 事务。应用前后必须分别导出 staging D1，在隔离的原生 SQLite 数据库中重建并执行完整性与外键检查；远程事务自身保留 schema 版本、零存量、对象清单、外键和 `changes()=1` 等有界失败关闭断言。`quick_check` 不能作为替代，因为它在当前完整 Schema 的真实 D1 执行中可能耗尽内存。

## 3. Release preflight

Staging 配置必须位于 Git 仓库外。模板保持：

```text
SCHEDULED_OPERATIONS_ENABLED=false
OUTBOX_DELIVERY_ENABLED=false
ACQUISITION_MAINTENANCE_ENABLED=false
OPERATIONAL_ALERT_MODE=disabled
BUYER_SELF_REGISTRATION_ENABLED=true
BUYER_SELF_REGISTRATION_CHANNEL_ID=staging-buyer-channel
BUYER_SELF_REGISTRATION_HUMAN_VERIFICATION_REQUIRED=false
Cron absent
observability.enabled=true
```

然后执行：

```bash
npm run preflight:cloudflare-release -- \
  --environment staging \
  --config /absolute/outside-git/wrangler.staging.jsonc
```

`LOCAL_CONFIG_VALID` 只证明本地配置结构，不证明资源、Access、Secret、网络或部署成功。

## 4. First Owner

默认命令只做零远程写的 inspect：

```bash
npm run bootstrap:staging:first-owner
```

执行前在仓库外创建权限为 `0600` 的 JSON：

```json
{
  "display_name": "Staging Owner",
  "email": "operator-supplied@example.test",
  "idempotency_key": "operator-generated-staging-key"
}
```

真实邮箱和 key 不得提交 Git、粘贴进任务对话或出现在 shell 参数中。经过单独远程写授权后，操作者才可显式执行：

```bash
node scripts/bootstrap-staging-first-owner.mjs \
  --execute STAGING_FIRST_OWNER \
  --account-id STAGING_ACCOUNT_ID \
  --database-id STAGING_D1_ID \
  --database-name yueguangbai-v2-staging \
  --input /absolute/outside-git/staging-owner.json
```

工具先只读验证 D1 name/ID，再以仅含字符串的参数数组和单个 D1 transaction batch 写入。数字以十进制字符串绑定，固定 SQL `NULL` 不承载 operator input。成功输出只包含 Staff ID、role/status 和安全状态，不返回邮箱、OAuth token 或 input 内容。重复同一请求安全重放；目标不符、Schema 非 70、已有任何 Staff authority，或 acquisition、Audit/Outbox、Buyer/Customer、file、order、product、review、Seller、finance 受守卫入口表存在业务存量时，均在写入 Owner 前停止；输入变化或批处理失败同样失败关闭。

## 5. 测试身份矩阵

Staff 没有应用密码，使用五个能够独立接收 Access OTP 的邮箱：

```text
owner
acquisition
pre_sales
seller_ops
buyer_refund
```

First Owner 之外的四个账号必须由 Owner 在正式 Staff account management UI/API 中创建。每人严格一个角色；非 Owner 分配 `AMAZON_JP` Marketplace，Owner 保持 GLOBAL 且无 marketplace scope row。

Buyer 与 Seller 使用 synthetic 标识，通过正式 Staff onboarding、invitation registration、activation 和 Customer password-change 流程创建。Buyer registration 只使用 bootstrap 建立的 `staging-buyer-channel`，不临时直写渠道表。临时密码只在受控交付渠道显示一次，登录后立即改为 staging-only 密码；不得写入 Runbook、Git、CI 日志或 PR。验收完成后禁用账号并撤销 Staff Access allow policy。

## 6. Readiness 期望

Staging `/ready` 成功时必须是：

```text
schema=ok
scheduler=not_required
outbox_delivery=not_required
acquisition_maintenance=not_required
operational_alerts=not_required
object_storage=ok
recovery=not_required
staff_access=ok
release=ok
```

这里的 `not_required` 表示 staging profile 明确不运行生产能力，不等于能力健康。即使 `file_objects` 还没有 `VERIFIED` 行，`object_storage=ok` 也必须来自一次真实、只读的 R2 `head` binding probe；未调用 R2 或 probe 抛错都必须报告 `failed`。Staging 这里有五项 `not_required` 和四项 `ok`；Production `/ready` 和 production health monitor 仍按生产合同独立判定，不能拿任何 staging `not_required` 充当 Production GO 证据。Production 自身在 `OUTBOX_DELIVERY_ENABLED=false` 时保留独立的 `outbox_delivery=not_required` 合同，不得被误写为 `ok`。

## 7. 最低验收证据

- 固定 deployed SHA 与 GitHub reviewed SHA 一致；
- staging D1/R2/Worker/Access/域名和 production 清单无 ID 重合；
- migrations `0001`–`0072`、Schema 72、integrity/FK checks；
- `/health=200` 与上述 staging `/ready=200` envelope；
- 五个 Staff 角色的允许/禁止路径，Personal DENY 和 Marketplace concealment；
- Buyer 登录、产品、预约、任务，Seller 登录、组织、产品申请、需求批次；
- R2 upload/head/private-read/authorization/compensation；
- fresh isolated restore 的 D1/R2 清单、哈希和 smoke reads；
- 至少一个连续观察窗口的 5xx、Access、D1、R2 和 readiness 监控。

以上通过只能标记 `STAGING_ACCEPTED`，不能自动标记 `PRODUCTION_GO`。

## 8. Evidence and change boundaries

远程证据必须按独立 Change/PR 分层，不能把基础部署、业务验收和恢复演练写成一份“全量通过”报告：

- **T8 基础激活**只证明隔离 Worker/D1/R2/Access/DNS/Secrets、Schema 72、migrations `0001`–`0072`、first-owner、固定 SHA 部署、`/health`/`/ready` 基线和 disabled/not_required 能力。T8 不包含 A–H 当前枚举的 67 项业务验收，也不包含备份恢复。
- **T9 A–H 验收**单独记录当前枚举的 67 项真实 staging 操作结果，引用 T8 的部署基线；每项使用稳定 ID，不创建资源，不重复写 T8 基础部署，不混入 T10 恢复或 Production GO 结果。
- **T10 隔离恢复**单独记录备份、恢复到新隔离目标、Schema/ledger、完整性/FK、Manifest/hash、行数、财务聚合和 smoke read；不混入 A–H 业务验收。
- **T11 CI**是独立代码 PR，只纳入本地 Playwright 13-spec 测试，不访问 staging、production、Cloudflare 资源或真实数据。

T8 激活前只保留本地代码/准备任务为已完成；远程激活、A–H 验收、隔离恢复和 CI 接入均须在各自实际执行并完成独立证据复核后勾选。资源 ID、Access audience、Secret 值、测试邮箱和原始远程日志必须留在 Git 外；提交到 Git 的只能是脱敏摘要和外部证据引用。
