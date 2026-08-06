# V2 数据库约定

## 1. 基础类型

- 主键：`TEXT`，使用全新 UUID。
- 时间点：UTC 毫秒 `INTEGER`。
- 中国业务日期：`TEXT`，格式 `YYYY-MM-DD`，由 `Asia/Shanghai` 推导。
- 布尔：`INTEGER NOT NULL CHECK(value IN (0,1))`。
- 枚举：`TEXT` + CHECK 或应用层严格枚举。
- JSON：`TEXT`，写入前规范化并限制大小。
- 金额、汇率、利润：禁止 `REAL`。

## 2. 金额

- 所有金额：整数最小货币单位 + ISO `currency_code` + 冻结 exponent。
- JPY/KRW exponent 为 0；USD/CNY exponent 为 2。
- 汇率：保存来源币种、报价币种、整数值、整数比例尺与取整规则，禁止含糊的无方向 `rate`。
- 计算先使用 BigInt 或等价安全整数逻辑，最后检查 JavaScript 安全整数范围。
- 每个财务事实保存币种和比例尺。
- JSON 金额使用十进制字符串；财务计算使用 BigInt，禁止浮点转换。

## 3. 版本和并发

可变聚合根必须有：

```text
version INTEGER NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

更新使用：

```sql
UPDATE ...
SET ..., version=version+1, updated_at=?
WHERE id=? AND version=?;
```

受影响行数不是 1 时返回版本冲突。

## 4. 删除规则

- 财务事实、审计事件、编号认领、订单号认领不得删除。
- 客户、产品、店铺使用停用/归档，而不是物理删除。
- 仅未被引用且不影响审计的临时草稿可以物理清理。
- 禁止对核心表使用危险的级联删除。

## 5. 事件和不可变事实

状态变化必须有事件表。事件至少保存：

- event_id
- aggregate_type
- aggregate_id
- previous_state
- next_state
- actor_type
- actor_id
- actor_roles
- idempotency_key
- request_hash
- reason
- created_at

财务事实采用追加式账本。更正通过：

```text
原事实
→ reversal
→ correction/reposting
```

## 6. 幂等

关键命令必须使用幂等记录：

- actor；
- key；
- action；
- target；
- request_hash；
- PROCESSING/COMMITTED/FAILED；
- lease_token；
- lease_expires_at；
- response_json；
- result IDs。

相同 Key、相同请求返回原响应；相同 Key、不同请求返回 409。

## 7. 快照

正式订单至少保存：

- 买家；
- 卖家组织；
- 卖家成员/渠道；
- 店铺；
- 产品和产品版本；
- Marketplace；
- 平台中性订单/产品标识；
- 付款金额、ISO 币种和 exponent；
- 需求批次；
- 评论/任务类型；
- 最终支付金额；
- 买家日汇率版本和值；
- 卖家协议汇率版本和值；
- 服务费规则版本和值；
- 创建时业务日期。

快照不得通过 JOIN 当前默认值动态替代。

## 8. Migration

- V2 从 `0001_...sql` 重新开始。
- 不迁入旧 Migration。
- 每个 Migration 从空库连续执行。
- Migration 不读取生产数据。
- Schema、Trigger、Index 和 Seed 都必须可重复验证。
