# V2 总体架构

## 1. 逻辑结构

```text
普通微信买家/卖家
        │ 日常沟通
        ▼
     私人微信
        │ 发送门户链接、提醒
        ▼
  买家门户 / 卖家门户
        │ HTTPS
        ▼
Cloudflare Workers + Hono
  ├─ Customer Auth
  ├─ Staff/Feishu Auth
  ├─ Permission Engine
  ├─ Catalog
  ├─ Demand Batches
  ├─ Reservations
  ├─ Pending Order Evidence
  ├─ Formal Orders
  ├─ Reviews
  ├─ Financial Ledger
  ├─ Feishu Sync Outbox
  └─ Audit / Observability
        │
        ├──────── D1（权威事实）
        └──────── R2（正式图片）
                         │
飞书员工工作台 ◀──── 同步/回调
```

## 2. 应用目录建议

```text
apps/
  api/          Workers + Hono
  web/          React/Vite 门户与内部受控页面
packages/
  contracts/    API DTO、错误码、事件合同
  domain/       纯领域函数、状态机、金额、身份规范化
  ui/           通用 UI
  testkit/      D1/R2/飞书匿名测试工具
migrations/     V2 全新 D1 Migration
docs/
scripts/
test/
```

## 3. 数据权威性

| 数据 | 权威来源 |
|---|---|
| 客户、产品、订单、评论、财务 | D1 |
| 正式图片 | R2 + D1 Manifest |
| 员工身份映射、角色、权限 | D1 |
| 飞书用户 ID | D1 映射 |
| 飞书任务卡片 | 飞书镜像，D1 任务为权威 |
| 私人微信聊天 | 非正式沟通，不自动入库 |
| 必要微信截图 | R2，按业务对象关联 |
| Google Drive | 后期第二备份，不是在线源 |

## 4. 模块边界

每个模块必须只通过明确的 Application Service/Command 调用下游，不允许页面或路由直接跨模块随意更新表。

推荐分层：

```text
Route
→ Authentication
→ Authorization
→ Input Parser
→ Application Command
→ Domain Validation
→ Repository/D1 Batch
→ Event/Outbox
→ DTO Projection
```

## 5. D1 事务策略

D1 的关键命令使用：

- 条件 INSERT/UPDATE；
- `db.batch()`；
- 唯一约束；
- 版本字段；
- 断言表/断言触发器；
- 事务内事件；
- 幂等记录；
- 冲突后重新读取并映射为稳定错误码。

禁止“先读、长时间等待、再无条件写”。

## 6. R2 一致性策略

数据库和对象存储不能天然形成单一事务，采用上传意图和补偿模式：

```text
预检查
→ 写上传意图/租约
→ R2 put
→ R2 head 校验
→ D1 最终条件提交
→ 成功标记
```

失败时删除已上传对象。重试必须能识别已完成、正在处理和残留对象。

## 7. 飞书集成

- 飞书用于员工 OAuth、任务摘要和提醒。
- 正式权限每次由 D1 计算。
- 任务领取、分派和正式状态写入必须先落 D1。
- 飞书卡片或多维表格通过 Outbox 异步更新。
- 飞书更新负责人、协作者、优先级、截止时间时，通过回调进入 D1 命令；版本冲突则拒绝并回写最新状态。

## 8. 部署环境

至少：

- local
- staging
- production

每个环境使用不同的：

- D1；
- R2；
- Secrets；
- 飞书应用；
- 域名/路由；
- Rate Limit namespace。

模块 0 不包含任何真实资源 ID。
