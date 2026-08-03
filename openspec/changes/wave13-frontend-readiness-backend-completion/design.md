# Design: Wave 13 Frontend Readiness Backend Completion

## 1. Status and Evidence Boundary

Wave 13 的远程实现源码、Migration、Contract、测试源码和静态门禁源码已经写入 Feature。当前证据级别为 `REMOTE_IMPLEMENTATION_EVIDENCE`，实现状态为 `IMPLEMENTED_AWAITING_LOCAL_VALIDATION`，总门禁保持 `NO_GO_PENDING_LOCAL_VALIDATION`。

本 Design 不声称 npm、Vitest、D1、R2、Wrangler、OpenSpec CLI、OpenSpec Verify、浏览器联调或生产飞书应用验证已经运行。任何 GO、P1 正式关闭、Integration 或 main 推进都必须等待本地验收。

## 2. Existing Capability Reuse

| 能力 | Wave 13处理 |
|---|---|
| D1 Staff、Role、Permission、Personal DENY、Team、Department、Assignment、Data Scope | 继续作为唯一 Staff 权威，每请求动态重算 |
| `feishu_staff_identities` | 只负责把经 Provider 验证的稳定身份映射到已有 ACTIVE Staff |
| File upload/read/link/audience/compensation | 复用正式 Service，只补受控 HTTP Adapter |
| Order Evidence、Formal Order、Claim、Snapshot、Seller Payable | 复用 builder，在一个 approve batch 中提交 |
| Buyer Refund Payment/Reversal/OVERPAID | 复用 append-only ledger 和既有 proof authority |
| Audit、Outbox、Idempotency、Transaction Assertions | 复用，不创建第二套基础设施 |

## 3. Staff Identity and Feishu Boundary

D1 `staff_users` 及 D1 中的角色、Permission、Personal DENY、Team、Department、Assignment 和 Data Scope 是唯一 Staff 身份与授权权威。

飞书是第一版 Staff 登录认证 Provider，只证明配置 tenant 中的稳定 `open_id` 已完成认证。Worker 服务端交换 code，验证 tenant/identity，把它映射到已存在的 ACTIVE Staff，再签发自己的 opaque 内部 Session。

禁止：

- 信任飞书 Header、客户端 `staff_id`、role、Permission、Team 或 Scope；
- 使用飞书 Access Token 作为 Staff API Session；
- 未绑定 identity 自动创建 Staff；
- 把角色、Permission 或 Data Scope 复制进 Session；
- 把飞书作为业务、财务或安全事件数据库。

## 4. Migration 0027

`0027_staff_auth_sessions.sql` 从 schema 26 连续升级到 27，范围仅包括：

1. `staff_users.session_version`；
2. `staff_login_states`；
3. `staff_sessions`；
4. `staff_auth_rate_limits`；
5. `staff_auth_security_events`；
6. 必要的 CHECK、unique、FK、状态/expiry 索引与 immutable/lifecycle Trigger。

Customer Auth 表不重建、不复用为 Staff 表。Migration 只做 forward upgrade，不提供 destructive down migration。

## 5. Staff Login and Session

正式端点：

- `POST /api/staff-auth/login/start`
- `GET /api/staff-auth/feishu/callback`
- `GET /api/staff-auth/session`
- `POST /api/staff-auth/logout`
- `POST /api/staff-auth/logout-all`

规则：

- login state 为密码学随机值，D1 只存 hash；
- state TTL 固定 10 分钟且只能原子消费一次；
- Session token 至少 256-bit，D1 只存 hash；
- Cookie 为 `__Host-ygb_staff_session`、HttpOnly、Secure、SameSite=Lax、Path=/、无 Domain；
- Session 为 12 小时绝对 TTL，无 idle timeout、无每请求 `last_seen` 写入；
- inactive、expired、revoked、unknown、tampered、session-version 或 authorization-version 不匹配全部 401；
- 每次有效请求重新解析 D1 授权和 Data Scope。

第一版临时认证数据清理由真实认证流量触发，不增加 Cron 或 Scheduled Handler。`login/start` 在创建 state 前、Feishu callback 在消费 state 与调用 Provider 前，各执行一次有界清理：仅删除 `expires_at`/`updated_at` 均早于 24 小时保留线的 `staff_login_states`，以及 `window_ends_at` 早于保留线且未处于有效 blocked 窗口的 `staff_auth_rate_limits`；每张表每次最多 100 行。清理绝不触及 security events、sessions、audit、idempotency 或业务/财务事实。任一清理 SQL 失败即返回 503 `DEPENDENCY_UNAVAILABLE`，且不继续创建 state、消费 callback state、调用 Provider 或签发 Session。

## 6. Logout-All Replay Safety

首次 ACTIVE Session 的 logout-all 继续使用一个顶层 Idempotency-Key、一个 canonical request hash 和一个 D1 batch，递增 `session_version`、撤销全部 ACTIVE Sessions、写 Audit、完成幂等记录并清 Cookie。

丢失 HTTP 响应后的重试采用严格受限的只读恢复路径：

1. Cookie 只能定位 `REVOKED` 且 `revoked_reason='LOGOUT_ALL'` 的 Session；
2. Session 绝对 `expires_at` 必须仍在未来；
3. 只读取 `session_id`、`staff_id`、`issued_session_version`；
4. 使用同一 actor/action/target、同一 Idempotency-Key 和由原 `issued_session_version` 计算的同一 request hash；
5. 只接受已经 `COMMITTED` 且 response JSON 结构正确的记录；
6. 命中时返回首次业务响应并清 Cookie，不创建新 Claim、不递增版本、不写 Audit、不撤销 Session、不创建 `staffAuthorization`；
7. 不同 Key、普通 LOGOUT、其他 revoke reason、expired/unknown/forged Cookie 返回 401；
8. 该旧 Cookie 访问任何其他 `/api/staff/**` 仍返回 401。

## 7. Default App Middleware

生产注册顺序固定为：

1. 公共 Staff Auth Routes；
2. `/api/staff/*` Session Middleware；
3. Assignment、Catalog、Review、Seller Settlement、Settlement Proof、Internal Finance、Staff File、Order Evidence、Buyer Refund 等受保护路由。

Middleware 是唯一 `staffAuthorization` 生产者。测试通过 Fake Provider 完成真实 login/start → callback → Cookie → Default App 请求，不允许直接 `context.set(staffAuthorization)` 代替生产链路。

## 8. File HTTP Active Scope

Wave 13 活动上传 Intent 仅包括五种已有 Purpose：

| Route family | FilePurpose | 固定 Visibility |
|---|---|---|
| Buyer Order Evidence | `ORDER_EVIDENCE` | `BUYER_VISIBLE` |
| Buyer Review Evidence | `REVIEW_EVIDENCE` | `SELLER_VISIBLE` |
| Seller Product Application Image | `PRODUCT_APPLICATION_IMAGE` | `SELLER_VISIBLE` |
| Staff Buyer Refund Proof | `BUYER_REFUND_PROOF` | `INTERNAL_ONLY` |
| Staff Seller Settlement Proof | `SELLER_SETTLEMENT_PROOF` | `INTERNAL_ONLY` |

`ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 的全局常量和历史 schema 能力保留，但 Wave 13 不注册活动 Intent Route、不放入 `STAFF_UPLOADS`，也不创建通用 Link/Grant 替代。原因是当前没有冻结的实体消费命令、Link 和 Audience 流程。该能力正式归属 Wave 15 内部 Staff 运营工作台。

File 生命周期继续使用：purpose-bound intent → multipart upload → R2 receipt → complete/HEAD → VERIFIED → 业务命令内 Link/Audience → short read intent。响应不得泄漏 object key、永久 URL 或存储凭据。

## 9. Active Route Count

Pre-Wave 13 静态正式路由基线为 108。Wave 13 活动新增为 30：

- Staff Auth：5；
- 五个活动 Purpose Intent：5；
- Buyer/Seller/Staff File Lifecycle：12；
- Staff Order Evidence：4；
- Staff Buyer Refund：4。

静态总路由预期为 138。延期的内部沟通 Purpose Route 不计入活动新增数量。

## 10. Staff Order Evidence and PRICE_MISMATCH

Order Evidence list/detail 使用 `ORDER_VIEW` 并在 SQL 中下推 Buyer/Team/Global Scope。Scope miss 返回 404。

Request Changes 复用现有两小时修改期限。

Approve body：

- 必填 `expected_version`；
- 可选 `internal_note`；
- 可选 `price_mismatch_acknowledged`；
- 可选 `price_mismatch_reason`。

截图证明的 `final_paid_jpy` 是财务权威。存在 reference mismatch 时必须 ack=true 且提供非空内部 reason；缺失或 false 返回 409 `PRICE_MISMATCH`，ack=true 但无 reason 返回 400。无 mismatch 时无意义 ack/reason 返回 400。

Atomic approve 使用一个 Actor、一个 Key、一个 request hash、一个最终响应和一个 D1 batch，包含 Evidence transition、Amazon order claim finalize、Formal Order、financial snapshot、Seller principal payable、Instruction completion、Evidence consume、Work Item completion、Audit、Event、Outbox、Idempotency 和 Assertions。

## 11. Staff Buyer Refund

- list/detail：`BUYER_REFUND_VIEW` + Buyer/Team/Global Scope；
- payment/reversal：`BUYER_REFUND_RECORD` + processing assignment/scope；
- money 使用整数分并以十进制字符串出 DTO；
- Payment 和 Reversal append-only，不 UPDATE/DELETE 原事实；
- OVERPAID 不截断；
- proof 固定 `BUYER_REFUND_PROOF / INTERNAL_ONLY`，业务命令创建明确的 Staff audience；
- 不复用 Seller Settlement 或 Internal Finance Permission/DTO/ledger。

## 12. Permission and Disclosure

- 无有效 Session：401；
- 有 Session 但缺操作 Permission：403；
- 有 Permission 但资源超 Assignment/Data Scope：404；
- Buyer/Seller 跨租户：404；
- File token 错误：403；资源 Scope miss：404；已知 intent 过期：410；
- Personal DENY 最终优先；
- Internal Finance 继续要求 Active system owner + `FINANCIAL_VIEW`，export 另需 `FINANCIAL_EXPORT`。

## 13. R2 Compensation

任何成功 R2 put 后，如果 receipt、HEAD、prefix/digest 或 D1 final commit 失败，调用既有 compensation：

- delete 成功：对象不可完成或链接；
- delete 失败：进入 `DELETION_PENDING`、增加 attempts、计算 retry time，并返回 503 `FILE_COMPENSATION_REQUIRED`；
- cleanup retry 必须幂等；
- 错误、Audit、Outbox 和 DTO 不得泄漏 object key。

## 14. DTO Isolation

- Buyer DTO 不得包含 Staff note、mismatch internal reason、Seller internals、其他 Buyer 或 storage authority；
- Seller DTO 不得包含 Buyer Refund cost/proof、Buyer privacy 或 internal profit；
- Staff DTO 不得包含 Session token/hash、Provider token/secret、R2 key 或永久 URL；
- File intent 首次响应的一次性 upload token 只允许出现在明确的首次 token 路径，Replay 不重新发放。

运行时 DTO 测试源码递归遍历 Default App 实际 response object，不只 grep 源码。

## 15. Test Source Coverage

已写入但尚未运行的测试源码包括：

- Staff Auth state/session/Cookie/Provider；
- logout-all 首次、丢失响应 replay、不同 Key/reason、过期、伪造、其他 Staff Route 401、并发一次提交；
- Default App 九个 Staff 路由家族的有效 Session、无 Session、Permission 403、Scope 404 和 Header bypass；
- 空库 0001–0027、26→27、state 并发、Session version/revoke、STRICT/Trigger/FK/Assertion/integrity；
- 正式 Atomic Approve、Refund Payment、Refund Reversal 最终 batch 故障注入与无部分事实；
- R2 put、receipt、HEAD、D1 final commit、compensation delete 成功/失败、delete pending、cleanup retry；
- 五种活动 Purpose/Visibility；
- 递归实际 DTO 泄漏检查。

## 16. OpenSpec Classification

本 Change 保持 52 Requirements 和 104 Scenarios。远程静态分类：

| 分类 | Requirements | Scenarios |
|---|---:|---:|
| `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | 37 | 74 |
| `PARTIAL` | 5 | 10 |
| `APPROVED_WAVE13_SCOPE_REDUCTION` | 1 | 2 |
| `LOCAL_VALIDATION_REQUIRED` | 9 | 18 |
| 合计 | 52 | 104 |

Scope reduction 专指 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 活动 HTTP Route 延期到 Wave 15，不表示删除全局 Purpose。

## 17. Remaining Gates

以下仍未完成：

- 实际 `npm run check`、Vitest、build；
- 真实 D1 migration/behavior 和 R2 fault/compensation 运行；
- 本次 Spec 语义更新后的 OpenSpec strict validation；
- OpenSpec Verify；
- Ponytail；
- 浏览器、飞书应用和中国大陆网络联调；
- PR、Integration、部署或 main 推进。

因此 Pre-Wave 13 的 P1 只能标记为 `IMPLEMENTED_AWAITING_LOCAL_VALIDATION`，不得标记正式关闭。
