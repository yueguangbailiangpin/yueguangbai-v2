# Design: Feishu Staff Workbench PoC and Integration

## PoC Gate

PoC 使用虚构 Staff、Customer、Task 和金额，验证当前官方 API、OAuth scope、回调签名/加密、Task v2 或 Bitable 能力、批量/频率限制、深链接和管理员操作。只有记录真实应用版本、免费额度与限制后，才冻结生产 Adapter；PoC 不连接生产 D1/R2。

## Identity and Authority

飞书 OAuth 只证明配置租户中的稳定主体；D1 `feishu_staff_identities` 映射到 ACTIVE Staff 后由 Worker 签发内部 Session。每个 callback/action 再解析当前 D1 Staff Authorization、Personal DENY、Team 和 Scope，不信任飞书字段作为角色或权限。

## Sync Model

D1 task command 事务内写 Outbox。Scheduled Job 按 task/version 合并未发送事件，创建/更新飞书记录并保存 mirror ID/version。摘要字段限定 task number/type/status/priority/due/assignee/safe title 和受控 Web deep link。完整客户、截图和财务详情不进入飞书。

## Callback Model

回调先验证 Provider signature/timestamp/replay key，再映射 Staff 和 D1 task。领取、退回、分派等动作调用相同 Application Service，带 idempotency/expected_version。冲突时拒绝并通过 Outbox 回写最新状态。

## Scale and Failure

按八 Staff、每日二百订单只同步 actionable/exception/overdue task 和聚合摘要。频繁状态变化在 Outbox 合并。Provider 429/5xx 使用 bounded exponential retry/dead-letter；业务成功不依赖 Provider 成功。

## Rollback

独立 kill switch 控制 login provider、outbound sync 和 inbound callback。停用时现有内部 Staff Session 按原 TTL 运行，受控 Web 继续处理业务；镜像可重建，D1 不从飞书反向恢复业务事实。
