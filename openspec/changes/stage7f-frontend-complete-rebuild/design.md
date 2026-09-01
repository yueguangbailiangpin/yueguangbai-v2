# Design: stage7f-frontend-complete-rebuild

## Context

起点 `a2e4eebb`（schema 36、240 endpoints、阶段 1~7.5R 后端全部完成）。前端是阶段 7R 遗留的过渡态：真实组件 + 旧布局混排，五份 CSS 全局叠加（9,579 行），评审 demo fixture 停留在 stage75 之前的合同。生产环境尚未存在（无生产数据库/用户/图片），可以大幅重构、替换、删除前端旧代码，但不得修改稳定后端合同迁就旧前端。

## Goals / Non-Goals

**Goals（7F-1）**

- `/review`、`/review/staff`、`/review/buyer`、`/review/seller` 全部真实可用：真实生产组件 + Demo 数据 + 当前 strict schema。
- 员工端按新设计语言完整重做核心页面并收口信息架构。
- CSS 分层明确，员工端摆脱旧布局选择器。

**Non-Goals（7F-1）**

- 不重做买家端/卖家端业务页面（只恢复可正常查看的 Demo 状态）。
- 不进入阶段 8，不开发营销官网。
- 不修改后端合同、迁移、API 行为。

## Proposed Design

### 1. Review Runtime 修复策略

根因：`apps/web/src/review/demo-api.ts` 的 fixture 停留在 stage75 之前——
- `workItems()` 缺 `sla_due_at`/`is_overdue`/`overdue_since`/`next_action`/`responsible_role`/`responsible_staff_name`/`priority`（Stage 7.5 batch 1 扩展）；
- `/api/staff/me/work-items/summary`、`/api/staff/me/work-items/:id`、`/api/staff/formal-orders` 列表模式、`/api/staff/finance/orders/:id`、`/api/staff/seller-settlements/*`、`/api/staff/service-channels`、客户目录/邀请等端点完全未覆盖（落入 `blocked()`）；
- `/api/staff/formal-orders` 查单模式与列表模式共存（查询串仅 `amazon_order_number` 时返回聚合）。

方案：以 `src/staff/contracts/runtime.ts`（与 `packages/contracts` 对齐的前端 strict schema）为唯一依据重写 demo fixture；新增 `review-contract` 测试逐端点用页面真实 schema 解析 demo 响应，fixture 漂移即测试失败。评审角色切换（owner/pre_sales/seller_ops/buyer_refund × OWNER/OPERATIONS/FINANCE/VIEWER）全部端到端可进入。

### 2. 设计语言冻结（样式层）

```
tokens.css        —— 颜色/字号/间距/圆角/阴影/层级令牌（新基线：#f8fafd 背景、#0b57d0 主色…）
base.css          —— reset + 元素默认（替换 global.css 的 reset 职责，仅新层使用）
primitives.css    —— 共享原子组件（按钮/输入/表格/Badge/Dialog/Drawer…）
staff-shell.css   —— 员工端 Shell（240~256px 侧栏、64px 顶栏、导航分组）
staff-pages.css   —— 员工端页面模式（工具栏筛选行、紧凑表格、分区卡片、详情栅格）
legacy/*.css      —— buyer/seller legacy 隔离层（旧 global/design-freeze/buyer-portal/seller-portal 仅服务未迁移页面）
```

`main.tsx` 实际加载顺序：tokens → buyer/seller/旧员工 legacy 隔离层 → `.staff-app` scoped base → `sa-` primitives → `staff-shell` → `sp-` staff pages。概念依赖仍为 tokens → base → primitives → shell → pages；但 legacy 必须先加载、员工端 scoped 权威层后加载，避免 `global.css`/`design-freeze.css` 在层叠顺序上覆盖新员工端，同时新层不得使用会影响买家/卖家端的裸全局选择器。员工端新页面只允许引用新层类名；源码守卫测试扫描 `src/staff/**` 禁止引用已退役旧类名清单。

### 3. 员工端信息架构

侧栏分组（Atlassian 式）：
- 工作台（默认页 = 我的一天）
- 业务：订单、买家客户、卖家客户、产品与预约、买家返款
- 财务：财务工作区（含结算批次、费率）
- 管理（Owner/授权角色）：员工与权限、系统设置（含客服渠道）、经营看板（Owner-only）

删除：全部"规划中"徽章、评论与凭证/卖家结算/文件归档假导航、公共池、抢任务、获客中心、双聊天截图入口、旧订单完整性入口、旧费率中心重复入口（旧路径 302 到财务工作区）。

### 4. 员工端页面模式

- **列表页**：页标题 + 结果计数 → 单行工具栏（搜索 + 紧凑筛选 + 清除）→ 紧凑表格（行高 44~52px、状态 Badge、行级进入详情）→ keyset 翻页。移动端：搜索 + "筛选"按钮开 Drawer + 卡片列表。
- **详情页**：身份摘要条 → 责任/阶段/截止 → 业务分区（按业务层级）→ 财务敏感区按权限渲染。
- **工作台**：问候/日期/角色 + 我的待办摘要 + 即将超时 + 异常工作项 + 最近处理 +（Owner）简化经营摘要。
- **URL 即状态**：筛选条件全部进 query string，可分享可回退。

## Risks / Trade-offs

- **demo fixture 体量大**：用 review-contract 测试锁住，未来合同演进时测试精确指出漂移点。
- **旧 CSS 暂留**：买家/卖家页面仍依赖 global/design-freeze/buyer-portal/seller-portal；本轮以 legacy 隔离层约束其影响范围，待 7F-2/7F-3 迁移完成后删除。
- **旧组件双套风险**：已迁移的员工端旧组件直接删除（不留双套），源码守卫防回归。

## Migration Plan

无数据库迁移。前端纯重构；评审环境与本地预览即可验证。

## Open Questions

无——设计语言、信息架构、页面清单、验收标准均已在任务指令中冻结。
