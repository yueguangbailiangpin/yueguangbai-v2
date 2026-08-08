# Design: Feishu Workbench Production Adapter Activation

## Authority and Runtime Assembly

D1 `staff_work_items`、`feishu_staff_identities`、Staff Authorization、`integration_outbox`、0033 镜像/回调收据和 0034 死信继续是唯一事实。`resolveFeishuWorkbenchAdapter` 只有在同步开关为 `true`、API origin 精确为官方 HTTPS origin、tenant/app 配置与两个 Secret 全部有效时才构造 production adapter；测试仍可显式注入 adapter。production release runtime 不再把“可构造但 disabled”与“允许激活”混为一谈：模板保持 false，独立飞书预检只做本地配置验证且不发网络。

Staff Auth 与 Feishu workbench 使用独立开关、配置和代码路径。启用工作台不要求 `STAFF_AUTH_ENABLED=true`，也不签发或改变 Staff Session。

总 Scheduler 只负责进入定时 handler，不隐式授权独立获客维护。`runAcquisitionMaintenance` 仅在 `ACQUISITION_MAINTENANCE_ENABLED === 'true'` 的分支内调用，且专用 `CUSTOMER_SECURITY_TOKEN_SECRET` 也只在该分支读取。staging/production release runtime 与飞书激活预检都要求飞书专用组合中的该开关精确为 `false`，同时要求六个标准作业 disabled；因此该组合唯一会取得运行租约并写入 `scheduled_job_runs` 的作业是 `feishu_sync`。

## Outbound Contract

同步消费 `STAFF_WORK_ITEM` 后重新读取当前 work item，并以配置 tenant 查找负责人唯一 ACTIVE `feishu_staff_identities.open_id`；缺失、冲突或 inactive 均在网络前以 `contract_rejected` 失败。Adapter 使用官方自建应用 token endpoint与 Task v2：

1. `POST /open-apis/auth/v3/tenant_access_token/internal`，严格发送 `app_id`/`app_secret`，严格读取 `code=0`、非空 token 与整数 `expire`。
2. 无镜像时 `POST /open-apis/task/v2/tasks?user_id_type=open_id`，请求仅含中文 `summary`、受控深链 `description`、一个 `assignee` open_id 与稳定 `client_token`。
3. 有镜像时 `PATCH /open-apis/task/v2/tasks/{guid}?user_id_type=open_id` 更新标题、描述与 `completed_at`；如负责人变化，由幂等成员接口收敛到当前 open_id。任何 Provider GUID 只作为 0033 mirror key，不进入客户端 DTO。

`client_token` 从固定命名空间与不可变 work item ID做 SHA-256 后截取为 Provider 允许长度，避免在 Provider body 暴露裸内部 ID。唯一允许携带 work item ID 的位置是批准 origin 下的受控深链；打开后仍由当前 Staff Session、Personal DENY 和 Scope 授权。

## Token, Timeout, Rate and Retry

adapter 实例在 Worker isolate 内内存缓存 tenant token，并在 Provider `expire` 前三分钟或剩余不足安全窗口时刷新；并发请求共享一个 refresh promise。401 只允许清除 token 后重取一次。token/业务请求均有 AbortController 超时，响应 body 有 64 KiB 上限。

本地 token bucket 把实际调用限制在官方上限以下；桶耗尽不发网络并分类 `RATE_LIMITED`。429 与明确 Retry-After、408/425/5xx/网络/超时按可重试错误处理，最多三次且等待有硬上限；400/403/404、严格响应失败与未知非零 code 为 `CONTRACT`。所有抛出错误只含固定 code，不保存或返回 Provider body、token、Secret、URL query 或 open_id。

## Callback Contract

公开 callback 先在 16 KiB 原始 UTF-8 上限内读取，再按官方算法验证：

`sha256(X-Lark-Request-Timestamp + X-Lark-Request-Nonce + EncryptKey + rawBody)`

Timestamp 按 Unix 秒解释并限制五分钟；随后用 `sha256(EncryptKey)` 作为 AES-256-CBC key，首 16 bytes 为 IV，解密 `{"encrypt":"..."}`。解密后只接受 URL challenge 或 `schema=2.0`、`event_type=card.action.trigger` 的严格匿名合同；同时核对 Verification Token、App ID、配置 tenant、operator tenant 与 action value。

action value 只允许 `REASSIGN_WORK_ITEM`、Provider task GUID、expected version、目标 `open_id` 与中文原因。来源和目标 open_id 均在同一 tenant 映射为唯一 ACTIVE D1 Staff，task GUID 再由现有 mirror 解析为内部 work item；不接受回调内 Staff ID、work item ID、role、permission 或 scope。既有 0033 receipt 继续以 event ID、nonce hash 和 decrypted payload hash 实现 exact replay、nonce collision 拒绝、处理中返回和过期租约接管。最终复用 `reassignWorkItem`，版本冲突只写 reconciliation Outbox。

## Message and Formal Action Boundary

飞书只显示中文最小任务标题、状态、北京时间提示和受控网页深链。任何审核、返款、结算、汇率、权限、归档或业务状态确认都不出现在 Provider action 中。callback 唯一写动作仍是低风险任务改派；员工必须打开月光白网页查看最新 D1 事实并确认正式动作。

## Migration, Transaction and Audit

`NO_SCHEMA_CHANGE`。同步仍使用现有 Outbox lease、镜像原子提交、第五次隔离和受控 replay。callback 仍使用 0033 receipt lease和既有 versioned command 的 Idempotency/Audit/Outbox/transaction assertions。Provider 成功但 D1 mirror 失败时，稳定 client token 与同一 GUID 收敛，绝不创建第二个 D1 事实。

## Rejected Alternatives

- 不引入飞书 SDK：原生 fetch/Web Crypto 已覆盖必要合同，避免 Node/Workers 运行差异和新依赖；所有协议字段由匿名测试锁定。
- 不持久化 tenant token：短期 Secret 不是业务事实，D1 持久化会扩大泄露与轮换风险。
- 不复用 Staff Auth 配置：会错误强制绑定身份登录并混淆两个独立能力。
- 不以消息/任务 payload 携带完整 D1 DTO：会暴露内部 ID、客户和财务事实。
- 不新增 0038：现有 0033/0034 已满足持久化边界，空 Migration 会制造并行竞争。

## Rollback and NO-GO

回滚顺序为 sync false → callback false → 核对 acquisition maintenance false → 必要时 Scheduler 禁用 `feishu_sync`；保留镜像、收据、Outbox 与死信。真实应用/scope/额度/机器人、生产 callback、移动端/三运营商、独立告警和老板分阶段批准仍未执行，因此本 Change 完成后只能报告 `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`。
