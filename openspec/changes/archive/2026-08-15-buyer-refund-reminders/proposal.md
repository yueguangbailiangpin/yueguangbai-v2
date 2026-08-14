## Why

买家在返款到期后没有受控的催办入口，只能依赖线下沟通，Staff 也看不到是否被催办。该入口必须是受限、可审计的业务请求，不能把催办误做成付款、任务或外部消息投递。

## What Changes

- 新增买家拥有的返款催办能力：仅可信 Buyer Session 对本人仍待返的返款义务可请求催办。
- 新增前向 Migration 0070 的不可变催办事实、幂等键、索引和来源/不可变触发器，并将本地 Schema guard 推进 69→70。
- 买家返款详情展示催办与 24 小时已催状态；Staff 返款详情只读展示催办次数和最后催办时间。
- 禁止创建 Staff task、改变队列排序、Outbox、外部消息、Seller Allocation 或历史订单导入。

## Capabilities

### New Capabilities

- `buyer-refund-reminders`: Buyer-owned, rate-limited reminder commands and safe Buyer detail projection.

### Modified Capabilities

- `staff-buyer-refund-api`: Staff refund detail gains a read-only reminder count and last reminder time.

## Impact

- Affects Migration 0070, Buyer refund contracts/read model/route, Staff refund read projection, Buyer/Staff React surfaces, local migration verifiers, and focused D1/UI tests.
- No Cloudflare resource, remote D1/R2, deployment, Seller DTO, payment/reversal fact, integration Outbox, or external notification changes are authorized.
