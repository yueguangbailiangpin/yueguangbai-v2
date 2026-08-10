# Moonwhite V2 Frozen Product Baseline

Status: **FROZEN** for the implementation branch `feature/frozen-portals-staff-acquisition-core`.

This document is the product source of truth.  Integration work may fix compile errors, schema drift, browser defects, accessibility, tests and real API mismatches.  It must not redesign the frozen product without an explicit new product decision.

## 1. Buyer Portal

Primary navigation is exactly:

- 产品
- 任务
- 我的

`/buyer` enters `/buyer/products`.

### 产品

- S3 compact row list.
- 6 rows per local page.
- Search + task-type filter + local pagination.
- Backend cursor may load additional batches.
- Do not invent a product image API.  Use a neutral product placeholder until a safe image field exists.

### 任务

One task center aggregates existing reservation/order-evidence/review/refund APIs.

Actionable examples:

- 修改订单资料
- 修改评论资料
- 提交订单资料
- 提交评论资料
- 查看下单指引

System-processing states are visually separate and **do not count as buyer actionable N**, including pending reservation/order-evidence/review and refund processing.

### 我的

M2 business center with profile/status, reservation/formal-order/refund summaries and service links.  Do not invent a special summary backend endpoint only for this page.

### Full flow

产品 → 产品详情 → 自费确认/预约 → 预约批准 → 下单指引 → 订单资料 → 修改/PRICE_MISMATCH → 重交 → 正式订单 → 评论 → 修改 → 重交 → 返款。

Existing detail/mutation routes remain the business implementation.

## 2. Seller Portal

Frozen as **V1 professional desktop console**.

- Desktop-first.
- Seller green identity (`#26735a`, soft `#eaf5f0`).
- Left navigation + organization/store context + store selector.
- Keep existing Dashboard / 产品 / 需求 / 订单 / 评论 / 结算 / 设置 business logic.
- Do not rewrite stable Seller business modules only for UI.

Seller order Business Completion must keep all four:

- 评论
- 买家返款
- 卖家本金
- 卖家服务费

Buyer refund is not hidden from Seller.

## 3. Staff Portal

Frozen as a small-team professional console, not an enterprise dispatch ERP.

Visual identity:

- W1: left queue / middle business facts / right current customer + actions + collapsed audit.
- P2 deep-sea blue: `#315f9d`, soft `#edf3fb`.

### Five roles

One employee has one role:

- `owner` = 总管理员
- `acquisition` = 获客
- `pre_sales` = 售前
- `seller_ops` = 卖家对接
- `buyer_refund` = 买家返款

Owner is global.

### Navigation

Owner:

- 工作队列
- 客户开发
- 买家客户
- 卖家客户
- 产品库
- 经营看板
- 本金汇率策略
- 员工管理

Acquisition:

- 客户开发 only

Pre-sales:

- 工作队列
- 买家客户
- 产品库

Seller Ops:

- 工作队列
- 卖家客户
- 产品库
- 本金汇率策略

Buyer Refund:

- 工作队列 only

### Deliberately omitted UI

Do not add these back in the first phase:

- task reassign UI
- task assignment page
- employee availability / accept-work state
- SLA / high-risk quick filters
- Team / Department / Leader management
- raw permission checkboxes
- Marketplace fallback management UI
- Staff message center

The old backend assignment machinery may remain for compatibility, but it is not the daily product surface.

### Work queue

Only:

- 待处理
- 已完成
- task type filter

Normal approval actions do not require an extra confirmation dialog.

Sensitive confirmation is required for:

- buyer refund payment
- buyer refund reversal
- disabling a Staff account
- principal-rate policy confirmation

## 4. Staff Authentication

Active Staff login is **Cloudflare Access + Email OTP**.

- Staff may use personal email.
- No Feishu dependency in the active login/workbench composition.
- No Google account requirement.
- No Moonwhite Staff password.
- Cloudflare proves the email identity.
- Moonwhite remains the authorization source of truth: ACTIVE/DISABLED, role, Marketplace scope, permissions and Staff session.
- Manual Cloudflare Access allow-list management is preferred because the team is very small.
- Keep a backup Owner account using an independent email.

Changing Staff email / role / Marketplace / status invalidates old Moonwhite Staff sessions.

## 5. Staff Marketplace Scope

Core rule:

> Role decides **what** an employee can do.  Marketplace decides **where** they can do it.

Canonical examples:

- `AMAZON_JP`
- `AMAZON_US`
- `COUPANG_KR`
- `RAKUTEN_JP`
- `TIKTOK_JP`

Marketplace is not the same thing as country.

First-phase staffing rule:

> one active primary Staff per `Role × Marketplace`.

Examples:

- Buyer Refund + AMAZON_JP
- Buyer Refund + AMAZON_US
- Buyer Refund + COUPANG_KR

These are the same role, not three different roles.

Non-owner Staff must not receive out-of-scope data even through a copied direct URL.  Server-side enforcement is mandatory.

## 6. Staff Account Management

Owner-facing Staff management is one simple page.

Manage only:

- 姓名
- 登录邮箱
- 岗位
- 负责 Marketplace
- ACTIVE / DISABLED
- 最后登录

Do not expose Team or raw permission codes.

Creating a Moonwhite Staff account does not automatically edit Cloudflare Access.  The Owner manually adds the email to the Access allow policy.

## 7. Customer Development Responsibilities

Critical separation of duties:

- Acquisition Staff / future Codex **finds or attracts customers**.
- Pre-sales does **not** develop Buyer customers.  It adds Buyer WeChat, creates the formal Buyer Lead, confirms source, and handles Buyer business.
- Seller Ops does **not** develop Seller customers.  It adds Seller WeChat/contact, creates the formal Seller Lead, confirms source, and handles Seller business.

Pre-sales page is **买家客户** and never asks the user to choose Buyer vs Seller.

Seller Ops page is **卖家客户** and never asks the user to choose Buyer vs Seller.

## 8. Acquisition Core

Buyer and Seller acquisition share one core:

> Channel → Prospect (optional) → Lead → Customer → Order → Profit

Do not build separate independent Seller-AI and Buyer-AI systems.

### Channel

Owner-configured data, not code enums for every future platform.

Examples:

- 小红书买家推广
- 知无不言卖家推广
- TikTok 买家推广
- Twitter/X 买家开发
- BOSS 卖家开发

A Channel records platform name, Buyer/Seller/Both audience and Marketplace.

Adding a future platform should normally be data configuration, not a code deployment.

### Daily consultation data

Acquisition Staff may record channel-level daily consultation counts.

Downstream add-WeChat / registration / reservation / order / cooperation / profit comes from system facts rather than a second person retyping totals.

### Prospect

Used when a customer has been discovered but has not yet entered formal WeChat/customer intake.

Minimum fields:

- Buyer / Seller
- Marketplace
- source Channel
- name
- optional contact
- optional source URL
- HUMAN / CODEX origin mode
- status
- nullable AI score
- note
- discovered time

Prospect is optional for inbound advertising.  A customer who directly adds WeChat may enter at Lead.

### Human handoff

Acquisition / Owner can mark a Prospect for `HUMAN_HANDOFF`.

- Buyer handoff appears to Pre-sales in the matching Marketplace.
- Seller handoff appears to Seller Ops in the matching Marketplace.
- When formal Lead is created from a Prospect, original channel / source URL / origin mode is inherited.

### Source attribution

Lead source is not a casual note.  It is the business attribution source.

Formal customer linkage writes durable first-touch attribution so downstream reporting can remain tied to the original source.

## 9. Codex / Automation Entrance

Future Codex must **not** automate clicks in Staff Web as its primary integration.

Use a separate machine entrance under `/api/acquisition-machine/*` with an independent machine secret.

Allowed machine actions:

- create Prospect
- add public-information Signal
- update AI score / research status

Not allowed:

- orders
- financial actions
- buyer refunds
- Staff / permissions
- direct customer conversion / deal closing

Human approval / handoff remains the boundary into formal customer business.

Buyer AI and Seller AI reuse the same Acquisition Core and differ only in research/scoring details.

## 10. Future-market timing

Do not prematurely build every future financial rule.

- Current principal-rate business remains JPY → CNY.
- Add USD → CNY when Amazon US is actually launched.
- Add KRW → CNY when Coupang KR is actually launched.
- Add Owner dashboard Marketplace filter when a second Marketplace has real business facts.

The Staff role/Marketplace model is already reserved so these future additions do not require redesigning employee authorization.
