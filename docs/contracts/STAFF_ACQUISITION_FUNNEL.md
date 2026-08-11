# 员工获客漏斗合同

## 边界与权威

`/staff/acquisition` 是员工工作台内的稳定中文入口。D1 中的渠道、有效期、日咨询汇总、线索、关联和事件是权威事实；飞书、微信私聊和未来看板都不是权威源。本合同不包含 `admin-business-dashboard` 最终看板。

owner 使用 `ACQUISITION_ADMIN` 管理渠道、Staff 渠道生效期和北京日咨询汇总。pre_sales 只能建立 BUYER 线索，seller_ops 只能建立 SELLER 线索，buyer_refund 没有获客权限。角色默认、个人 GRANT、团队范围和 Personal DENY 依照统一 Staff 授权模型重算，DENY 最终优先。越范围读统一返回 `NOT_FOUND`。

## 身份、渠道与统计口径

- 创建线索的请求不包含 `channel_id`。后端依据可信 Staff、线索类型和 UTC 创建时点，解析唯一生效渠道；零条或多条均失败关闭。
- 微信号复用 Customer Identity 规范化规则，使用服务端秘钥的 HMAC 做同类型去重，并以 AES-GCM 加密保存。列表、API、Audit 和运行事实仅允许掩码，秘钥缺失或无效时失败关闭。
- 同一规范化身份在 BUYER 和 SELLER 类型内各至多一条有效线索。首条有效线索的来源渠道和创建 Staff 永不覆盖；责任人转移只更新 current owner 并写入事件。
- 咨询人数是“渠道 + `Asia/Shanghai` 自然日”的人工去重汇总；同人同渠道当日只计一次，跨渠道各计一次。更正必须提供当前版本与原因，旧值保留在不可变事件中。

## 自动关联和归因

关联器以规范化微信身份连接 Customer Identity，再从现有 Buyer、Seller member、预约和正式订单事实幂等补齐不可变 link。

- 添加微信人数来自有效单人线索，不手工重录汇总。
- “未参加”只适用于有效 BUYER 线索，且该身份截至 `data_as_of` 从未提交任何预约。一旦产生预约 link，不因取消、拒绝或过期重新进入。
- Seller “合作”以关联身份首次成为有效 Seller Organization 的 ACTIVE member 为准；link 一旦建立不因后续停用重写历史。
- 正式订单和内部利润只通过 BUYER 线索的初始来源归因。Seller 漏斗只返回咨询、加微信和合作，没有利润字段。利润只向同时具有 owner 角色和 `FINANCIAL_VIEW` 的 Staff 输出。

## 写入、隐私和留存

所有关键写入使用 `Idempotency-Key`、规范请求哈希、`expected_version` 或唯一业务条件、事务最终断言、不可变领域事件和 Audit。相同幂等键只能重放相同请求与结果；不同请求哈希返回稳定冲突。请求多余字段失败，防止客户端偷渡渠道或私密投影。

未转化线索从最后跟进的北京日历时点起满十二个月后，由租约保护、可重试的维护作业清除微信哈希/密文/IV、显示名和备注。已有 Buyer、预约、正式订单、Seller 组织、Customer 安全事件，或显式 `SECURITY` / `DISPUTE` / `LEGAL` hold 的线索严格豁免。作业 dry-run 只读返回低基数计数，不获取租约、不改业务事实、不输出身份。

Worker 只有在独立 `ACQUISITION_MAINTENANCE_ENABLED` 精确为 `true` 时才调用该维护作业并读取 `CUSTOMER_SECURITY_TOKEN_SECRET`。缺失、`false` 或其他值全部失败关闭，不得因总 Scheduler 或其他作业启用而隐式执行。生产启用前仍须保留既有 dry-run、豁免、租约、审计和恢复验证；该独立门控不削弱任何候选或保留期检查。

## API 约定

权威 path 和 TypeScript DTO 在 `packages/contracts/src/acquisition.ts`。列表采用 `limit` + `cursor` / `next_cursor`；日期使用 `YYYY-MM-DD` 北京业务日，时点使用 UTC 毫秒整数。稳定业务错误包括 `CHANNEL_CONFIGURATION_MISSING`、`CHANNEL_CONFIGURATION_AMBIGUOUS`、`DUPLICATE_LEAD`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT` 和 `REQUEST_IN_PROGRESS`。
