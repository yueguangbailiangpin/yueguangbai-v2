# V2 飞书员工工作台合同

## 权威与范围

`staff_work_items`、D1 Staff identity、当前授权、既有 versioned command 和 `integration_outbox` 是唯一权威。飞书只接收可处理任务的最小镜像与月光白受控深链接；它不是订单、财务、权限、审计或任务事实库。

本合同当前只实现本地 adapter/mock。缺少显式开关、HTTPS 工作台 origin 或注入的本地 adapter 时 outbound sync 为 `HARD_DISABLED`；缺少 callback 开关或最少 32 字符 secret 时 inbound callback 也为 `HARD_DISABLED`。不得创建或调用真实飞书资源。

## D1 → 飞书摘要 DTO

严格对象仅包含：

- `work_item_id`、`work_type`、`status`、`assigned_staff_id`、`updated_at`；
- 中文 `safe_title`；
- 仅指向 `/staff/work-items/{work_item_id}` 的 HTTPS `deep_link`；
- `time_basis: UTC_MS` 与 `display_timezone: Asia/Shanghai`。

不得包含完整客户资料、微信号、订单/来源 ID、截图、凭证、财务金额、对象键、Drive ID、token、secret 或任意裸链接。adapter 必须按负责人最小可见范围投递，不能把团队外或跨组织任务广播给其他员工。

`feishu_sync` 只消费 `STAFF_WORK_ITEM` Outbox；现有通用 Outbox delivery 排除这一 aggregate。每次同步读取当前 D1 work item，持久化镜像键与镜像版本到 `feishu_workbench_mirrors`。429、服务不可用和合同错误分别归类为 `provider_rate_limited`、`provider_unavailable`、`contract_rejected`，使用既有 bounded retry/dead-letter；业务命令不等待同步成功。

## 飞书 → D1 回调

本期唯一允许动作是 `REASSIGN_WORK_ITEM`：

```json
{
  "event_id": "opaque-event-id",
  "tenant_key": "configured-tenant",
  "open_id": "stable-provider-subject",
  "action": "REASSIGN_WORK_ITEM",
  "work_item_id": "existing-d1-id",
  "expected_version": 1,
  "target_staff_id": "existing-d1-id",
  "reason": "中文改派原因"
}
```

回调 Header 必须提供 `X-Feishu-Workbench-Timestamp`、`X-Feishu-Workbench-Nonce`、`X-Feishu-Workbench-Signature`。签名为 `HMAC-SHA-256(secret, "timestamp.nonce.sha256(raw-body)")`，时间窗为五分钟。已验签的 event ID、nonce hash、payload hash 与结果存入 `feishu_workbench_callback_receipts`；重复 event 返回幂等结果，处理中返回 `IN_PROGRESS`，nonce 或载荷不一致拒绝。

服务端只根据 `(tenant_key, open_id)` 找到 ACTIVE 的 `feishu_staff_identities`，再重新计算 D1 ACTIVE、角色、Personal DENY、Team 与 data scope。绝不信任回调内或 Header 内的 Staff ID、role、permission、scope。最终调用既有 `reassignWorkItem`，携带 event-derived idempotency key 和 `expected_version`；未知/停用/无权/跨范围/冲突均 fail closed。

## 回滚

关闭 outbound 或 inbound 开关即可停止相应入口；既有内部 Staff Session、受控 Web 和 D1 业务继续运行。镜像可从 D1 重建，回滚不得从飞书恢复或覆写业务事实，不得撤销已经合法完成的 D1 命令。
