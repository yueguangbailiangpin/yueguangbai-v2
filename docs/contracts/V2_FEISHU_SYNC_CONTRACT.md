# V2 飞书员工工作台合同

## 权威与范围

`staff_work_items`、D1 Staff identity、当前授权、既有 versioned command 和 `integration_outbox` 是唯一权威。飞书只接收可处理任务的最小镜像与月光白受控深链接；它不是订单、财务、权限、审计或任务事实库。

本合同包含可由运行时工厂构造的 Task v2 production adapter，同时测试只注入匿名 transport/mock。缺少显式开关、官方 API origin、HTTPS 工作台 origin、tenant/app 配置、托管 App Secret 或调度 tenant 时 outbound sync 为 `HARD_DISABLED`；缺少 callback 开关、Encrypt Key、Verification Token、App ID 或 tenant 时 inbound callback 也为 `HARD_DISABLED`。Staff Auth 是独立能力，启用工作台不要求 `STAFF_AUTH_ENABLED=true`。本 Change 不创建或调用真实飞书资源。

## D1 → 飞书摘要 DTO

严格对象仅包含：

- `work_type`、`status`、`work_item_version`、负责人 `assignee_open_id`、`updated_at`；
- 中文 `safe_title`；
- 仅指向 `/staff/work-items/{work_item_id}` 的 HTTPS `deep_link`；
- `time_basis: UTC_MS` 与 `display_timezone: Asia/Shanghai`。

不得包含完整客户资料、微信号、订单/来源 ID、截图、凭证、财务金额、对象键、Drive ID、token、secret 或任意裸链接。adapter 必须按负责人最小可见范围投递，不能把团队外或跨组织任务广播给其他员工。

`feishu_sync` 只消费 `STAFF_WORK_ITEM` Outbox；现有通用 Outbox delivery 排除这一 aggregate。每次同步重新读取当前 D1 work item，持久化镜像键与镜像版本到 `feishu_workbench_mirrors`。OPEN 正常创建/更新镜像；从未有镜像的 `COMPLETED`/`CANCELLED` 项只安全消费事件，不创建新卡片；已有镜像仍同步终态以关闭卡片。

adapter 的第三个入参是固定命名空间与不可变 `work_item_id` 的 SHA-256 截断值，绝不等于或包含裸内部 ID。即使 Provider 已成功而 D1 镜像提交失败，重试也是同一 `client_token` 的 upsert，绝不重复创建。生产 transport 只允许 `https://open.feishu.cn`，tenant token 提前三分钟过期、并发刷新合并；请求超时、1 秒本地限流、64 KiB 响应上限、最多三次重试和最多 1 秒 `Retry-After` 都有硬边界。429、服务不可用和合同错误分别归类为 `provider_rate_limited`、`provider_unavailable`、`contract_rejected`；第 5 次失败会在同一 D1 原子批次中按当前 Outbox lease 写入死信。错误不得包含 token、Secret、open_id 或 Provider body。

## 飞书 → D1 回调

本期唯一允许动作是 `REASSIGN_WORK_ITEM`：

```json
{
  "event_id": "opaque-event-id",
  "tenant_key": "configured-tenant",
  "open_id": "stable-provider-subject",
  "action": "REASSIGN_WORK_ITEM",
  "task_guid": "opaque-provider-task-guid",
  "expected_version": 1,
  "target_open_id": "stable-provider-subject",
  "reason": "中文改派原因"
}
```

回调 Header 必须提供官方 `X-Lark-Request-Timestamp`、`X-Lark-Request-Nonce`、`X-Lark-Signature`。签名为 `sha256(timestamp + nonce + EncryptKey + rawBody)`，时间按 Unix 秒且窗口为五分钟。签名通过后才以 `sha256(EncryptKey)` 为 AES-256-CBC key、密文首 16 bytes 为 IV 解密 `{"encrypt":"..."}`；仅接受严格 URL challenge 或 `schema=2.0` 的 `card.action.trigger`，并同时核对 Verification Token、App ID、configured tenant 和 operator tenant。完全相同且已成功的 event 返回原已提交结果，处理中返回 `IN_PROGRESS`，过期租约可被同一哈希安全接管；任何 event/nonce/decrypted-payload 哈希冲突固定以 `401 UNAUTHENTICATED` 拒绝。

服务端根据同一 `(tenant_key, source/target open_id)` 找到唯一 ACTIVE `feishu_staff_identities`，以 `task_guid` 查现有唯一 mirror，再重新计算 D1 ACTIVE、角色、Personal DENY、Team 与 data scope。绝不接受回调内 Staff ID、work item ID、role、permission 或 scope。最终调用既有 `reassignWorkItem`，携带 event-derived idempotency key 和 `expected_version`；未知/停用/无权/跨范围/冲突均 fail closed。

## HTTP 与迁移审计

公开 callback 在读取前以 16 KiB 原始 UTF-8 body 上限流式限制，随后对同一原文验签；安全中文 toast 指示员工回月光白网页确认正式动作，响应为 `Cache-Control: no-store`。本 Change 的 Migration 决策是 `NO_SCHEMA_CHANGE`：0033 已提供 mirrors/receipts，0034 已提供三种飞书死信分类，现有 identity 表已提供 tenant/open_id 映射；不得修改历史 Migration 或新建空 Migration。

## 回滚

关闭 outbound 或 inbound 开关即可停止相应入口；既有内部 Staff Session、受控 Web 和 D1 业务继续运行。镜像可从 D1 重建，回滚不得从飞书恢复或覆写业务事实，不得撤销已经合法完成的 D1 命令。
