# V2 模块依赖与开发顺序

## 1. 基础层

```text
foundation
├─ time
├─ money
├─ crypto
├─ validation
├─ http errors
├─ idempotency
├─ audit
└─ observability
```

其他模块不得自行重复实现这些能力。

## 2. 依赖图

```text
Foundation
   ├─ Staff Identity / Permission
   ├─ Customer Auth / Identity
   ├─ Numbering
   └─ R2 Manifest

Seller Organization ──┐
Buyer Customer ────────┼─> Store ─> Product ─> Product Application
Marketplace ───────────┘                    └─> Product Version

Product + Seller ─> Demand Batch ─> Reservation
Buyer ───────────────────────────────┘

Reservation + Daily Rate + Seller Agreement
   └─> Pending Order Evidence
          └─> Formal Order + Financial Snapshot
                 ├─> Review Workflow
                 │      ├─> Buyer Refund Due
                 │      └─> Seller Service Fee Accrued
                 ├─> Seller Principal
                 ├─> Internal Settlement
                 └─> Profit Reporting

All business modules ─> Staff Work Item / Audit / Outbox
```

## 3. 强制开发顺序

1. Foundation。
2. Cloudflare Access / Staff Identity 与权限引擎。
3. Customer Auth、买家、卖家、成员和编号池。
4. 店铺、产品、产品版本和产品申请。
5. 需求批次。
6. 预约状态机和名额锁定。
7. 待核对订单资料。
8. 正式订单、订单号认领和快照。
9. 买卖家门户。
10. 评论工作流。
11. 财务账本、返款、卖家结算、内部结算和利润。
12. 员工工作台与 Cloudflare Access 联调。
13. 迁移、备份、灰度和上线。

## 4. 禁止倒置

- 未完成权限与客户隔离测试前，不开发客户导出。
- 未完成正式订单快照前，不开发评论和财务。
- 未完成不可变财务账本前，不开发利润报表。
- 未完成 R2 补偿测试前，不允许真实图片上传。
- 未完成 Access 策略、已知员工邮箱和权限隔离验收前，不允许真实员工登录。
