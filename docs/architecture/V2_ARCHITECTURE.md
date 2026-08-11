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
  ├─ Staff Access Auth
  ├─ Permission Engine
  ├─ Catalog
  ├─ Demand Batches
  ├─ Reservations
  ├─ Pending Order Evidence
  ├─ Formal Orders
  ├─ Reviews
  ├─ Financial Facts / Reporting
  ├─ Staff Work Items / Outbox
  └─ Audit / Observability
        │
        ├──────── D1（权威事实）
        └──────── R2（正式图片）

Cloudflare Access ──验证邮箱──▶ Staff Access Auth
```

## 2. 应用目录

```text
apps/
  api/          Workers + Hono
  web/          React/Vite 门户与内部受控页面
packages/
  contracts/    API DTO、错误码、事件合同
  domain/       纯领域函数、状态机、金额、身份规范化
  ui/           通用 UI
  testkit/      D1/R2/Access 匿名测试工具
migrations/     V2 D1 Migration 历史
docs/
scripts/
test/
```

## 3. 数据权威性

| 数据 | 权威来源 |
|---|---|
| 客户、产品、订单、评论、财务 | D1 |
| 正式图片 | R2 + D1 Manifest |
| 员工账号、角色、权限、负责站点 | D1；Cloudflare Access 只证明邮箱身份 |
| 员工任务 | D1 权威，通过受控员工 Web/API 操作 |
| 私人微信聊天 | 非正式沟通，不自动入库 |
| 必要微信截图 | R2，按业务对象关联 |
| Google Drive | 后期第二备份，不是在线源 |

## 4. 模块边界

每个模块必须只通过明确的 Application Service / Command 调用下游，不允许页面或路由直接跨模块随意更新表。

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

- 条件 INSERT / UPDATE；
- `db.batch()`；
- 唯一约束；
- 版本字段；
- 断言表 / 断言触发器；
- 事务内事件；
- 幂等记录；
- 冲突后重新读取并映射为稳定错误码。

禁止“先读、长时间等待、再无条件写”。

## 6. R2 一致性策略

数据库和对象存储不能天然形成单一事务，采用上传意图和补偿模式：

```text
预检查
→ 写上传意图 / 租约
→ R2 put
→ R2 head 校验
→ D1 最终条件提交
→ 成功标记
```

失败时删除已上传对象。重试必须能识别已完成、正在处理和残留对象。

## 7. 员工身份与工作台

- Cloudflare Access 校验签名、团队域名、应用 Audience 和邮箱等身份声明。
- 员工账号状态、唯一岗位、负责站点、PRIMARY/SUPPORT 和 Personal DENY 每次由 D1 计算。
- 任务、领取、处理和正式状态写入均在月光白受控 Web/API 内完成。
- 现行系统不注册飞书认证、同步、回调、任务或告警运行入口。

## 8. 部署环境

至少区分：

- local
- staging
- production

各环境应使用隔离的：

- D1；
- R2；
- Secrets；
- Cloudflare Access 应用与策略；
- 域名 / 路由；
- Rate Limit namespace。

真实资源 ID、生产状态和生产验收结果不得写成仓库内默认事实；生产操作必须单独授权。

当前文档描述现行 V2 架构边界，不再代表早期“模块 0”冻结阶段。业务实现与完成度以 `docs/CURRENT_SYSTEM_STATE.md`、Contracts、Acceptance Matrix、当前 OpenSpec 和真实测试结果为准。
