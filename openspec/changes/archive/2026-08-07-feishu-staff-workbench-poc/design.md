# Design: Feishu Staff Workbench PoC and Integration

## 本地 PoC 与外部 Gate

本 Change 只使用虚构 Staff、Customer、Task 和金额执行本地 adapter/mock/dry-run；它不调用官方 API、不创建飞书资源、不配置 OAuth 或 callback URL。mock 固定受控 task surface 的输入输出、失败、重试、回调签名和容量模型，且不连接生产 D1/R2。真实匿名 PoC 仍须由业务所有者在单独授权后验证应用版本、免费额度、管理员权限、OAuth scope、Task v2/Bitable、回调、深链接和大陆网络；在该外部 Gate 完成前所有 runtime 开关必须 fail closed。

## Identity and Authority

飞书 OAuth 只证明配置租户中的稳定主体；D1 `feishu_staff_identities` 映射到 ACTIVE Staff 后由 Worker 签发内部 Session。每个 callback/action 再解析当前 D1 Staff Authorization、Personal DENY、Team 和 Scope，不信任飞书字段作为角色或权限。

## Sync Model

D1 task command 事务内写既有 `integration_outbox`。`feishu_sync` 只处理 `STAFF_WORK_ITEM`，按 work-item/version 合并未发送事件，并将本地 mock 返回的镜像键和版本保存到 0033 的镜像表。adapter 以不可变 `work_item_id` 作为稳定外部幂等键，因此 Provider 成功后镜像写失败的重试仍为同一对象 upsert。未曾镜像的终态只消费，已有镜像同步终态关闭。摘要字段仅限 work-item ID、类型、状态、负责人、UTC 截止时间（若未来字段可用）、安全中文标题和受控 Web deep link；不发送完整客户、微信号、截图、凭证、财务详情、对象键、token 或原始业务 source ID。

## Callback Model

回调使用配置的 HMAC secret 验证 `timestamp + nonce + body hash`，要求五分钟时间窗和 16 KiB 原始 body 上限，并将已验签 event ID 与 nonce hash 原子写入 0033 回调收据表。完全相同的成功 event 返回已提交结果；hash/nonce 不一致或 nonce collision 固定拒绝，过期 PROCESSING 租约可接管。它再按 `(tenant_key, open_id)` 映射 ACTIVE Staff、重新计算 D1 Authorization（含 Personal DENY、Team 和 scope），且仅允许调用现有 `reassignWorkItem` versioned Application Service。未知/inactive/冲突身份、重复或乱序 event、无权、范围外、签名无效和版本冲突均 fail closed；版本冲突不改业务，但会写最小 reconciliation Outbox，冲突或成功均使镜像最终回写当前 D1 状态。回调不得接受或信任飞书携带的 role、permission、scope、Staff ID 或财务/业务事实。

## Scale and Failure

按八 Staff、每日二百订单只同步 actionable/exception/overdue work item 和聚合摘要。频繁状态变化在 `feishu_sync` 内按 work item 合并。adapter 将 429、5xx、超时和合同错误映射到固定、无敏感内容的失败分类；第 5 次失败以 `job_name=feishu_sync` 进入既有 dead-letter，受控重放只路由回本作业，通用 adapter 永不消费；业务成功不依赖 Provider 成功。连续三次实际 adapter 失败产生固定脱敏观察并可自动恢复。真实 adapter 未注入、开关未显式开启或 secret 缺失时一律 DISABLED，不尝试网络回退。

## Rollback

独立 kill switch 控制 outbound sync 和 inbound callback；既有 Staff login provider 的行为不在本 Change 修改。停用时现有内部 Staff Session 按原 TTL 运行，受控 Web 继续处理业务；镜像可由 D1 重建，D1 不从飞书反向恢复业务事实。
