# 前端重建阶段 7A-1 交接：员工端设计基础与导航重构

日期：2026-08-26。分支 `feature/staging-workflow-rate-ux`，基线 `754c0f0`。
范围：前端路由盘点、设计 tokens、基础组件、员工端 App Shell 与导航重构。
**零远程操作**：无 push、无部署、无 Cloudflare 写入、无外部资源修改。

> **重要声明**：本阶段为本地前端重构，不代表 Staging 或 Production GO。生产放行仍需遵循 `docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md`。

## 1. 路由盘点摘要

完整清单见 `docs/migration/V2_FRONTEND_ROUTE_REBUILD_INVENTORY.md`。

- 前端路由总数（去重，不含 review 复用）：**58 条**
  - 员工端：19 条（含 2 条重定向旧路径）
  - 买家端：18 条
  - 卖家端：10 条
  - 认证与通用：11 条
- 处理结论分布：
  - KEEP：52
  - MERGE：1（/staff/queue → /staff）
  - REBUILD：1（获客误导文案修正）
  - DELETE：4（RAKUTEN_JP/TIKTOK_JP 标签、退役路由声明清理、误导文案）
  - PLACEHOLDER：0

### 退役项排查结果

| 排查项 | 结果 |
|---|---|
| Staff MCP 前端代码 | 不存在（后端阶段 2 已删除） |
| 飞书前端运行时代码 | 不存在 |
| 关键词图片生成 | 不存在 |
| Rakuten/TikTok 前端 adapter | 仅 `StaffShell.tsx` MARKET_LABELS 常量残留，已删除 |
| legacy marketplace alias | 不存在 |
| trends/drill-down/funnel 前端 | 不存在 |
| 自动获客机器前端 | 不存在 |
| StaffCallbackModule.tsx | 无引用死代码，已删除 |

## 2. 删除的退役入口与残留

1. **`RAKUTEN_JP` / `TIKTOK_JP` 市场标签**：从 `StaffShell.tsx` MARKET_LABELS 移除。后端 canonical registry 仅三码（AMAZON_JP/AMAZON_US/COUPANG_KR），这两个标签永不会被命中。
2. **`StaffCallbackModule.tsx`**：无任何引用的死代码（功能与 StaffRouteModule 重复），已删除。
3. **获客误导文案**：旧 StaffShell context 描述为"渠道、潜在线索与自动开发入口"，"自动开发"暗示机器获客已退役。新 shell 修正为基于导航配置的准确标题。
4. **旧导航标签**：产品与投放→产品与预约、买家与订单→买家、财务配置→财务、员工与访问管理→员工与权限、系统→系统设置。

## 3. 新员工端信息架构（11 项）

| 序号 | 一级导航 | 路径/子项 | 可见角色 | 状态 |
|---|---|---|---|---|
| 1 | 工作台 | /staff | 全部 Active Staff | 真实页面 |
| 2 | 客户 | 获客中心(/staff/acquisition)、买家(/staff/buyer-customers)、卖家(/staff/seller-customers) | 按子项权限 | 真实页面 |
| 3 | 产品与预约 | /staff/products | owner/pre_sales/seller_ops | 真实页面 |
| 4 | 订单 | — | — | 规划中（无列表页，详情通过搜索/工作台进入） |
| 5 | 评论与凭证 | — | — | 规划中（审核通过工作台 work item 进入） |
| 6 | 买家返款 | /staff/refunds | owner/buyer_refund | 真实页面 |
| 7 | 卖家结算 | — | — | 规划中（通过财务页卖家组织维度查看） |
| 8 | 财务 | /staff/finance | owner/seller_ops+SELLER_MANAGE | 真实页面 |
| 9 | 文件归档 | — | — | 规划中（通过运营工具和订单详情触发） |
| 10 | 员工与权限 | /staff/access-management | owner+STAFF_MANAGE | 真实页面 |
| 11 | 系统设置 | 经营看板(/staff/admin-business-dashboard)、运行完整性工具(/staff/operations) | 按子项权限 | 真实页面 |

规划中项以"规划中"徽章标记，不创建假页面，不创建假路由。

## 4. 设计 Tokens

文件：`apps/web/src/styles/tokens.css`（全面重构）。

统一为语义化命名，一种稳定主色（深蓝 `#2c5aa0`），固定语义色。覆盖：

- **颜色**：canvas/surface/subtle/raised/inset、text 四级、border 三级、primary 四态、success/warning/danger/info 各三态、状态色（neutral/processing/expired/conflict）、三端身份色
- **间距**：8px 体系（0/1/2/3/4/5/6/8/10/12/16）
- **排版**：font-family、7 级 font-size、4 级 line-height、4 级 font-weight
- **圆角**：xs/sm/control/card/panel/pill
- **阴影**：xs/sm/md/lg/focus 五层（克制）
- **焦点环**：width/offset/color + `--focus-ring` 简写
- **z-index**：base/sticky/navigation/dropdown/overlay/drawer/modal/toast/tooltip 九级
- **过渡**：fast/base/slow/reduced + `prefers-reduced-motion` 全局适配
- **表格密度**：row-height/dense/cell-padding/header-height
- **表单控件**：sm/default/lg 高度、padding、font-size、radius
- **布局**：sidebar-width/topbar-height/content-max-width/padding
- **断点**：sm/md/lg/xl/2xl

旧 tokens 中 `--color-staff: #7150b7`（紫色）已统一为主色深蓝，消除"十几套相似颜色"问题。

## 5. 基础组件

文件：`apps/web/src/ui/primitives.tsx`（扩展）。

已有组件（保留并统一）：AppShell、IdentityShell、Button、IconButton、TextInput、Select、SearchInput、Checkbox、FormField、Card、MetricCard、PageHeader、Sidebar、BottomNavigation、StatusBadge、DataTable、Drawer（含 focus trap）、Dialog（含 focus trap/Escape/焦点恢复）、Tabs、Pagination、Breadcrumb、Timeline、Progress、Alert、Toast、EmptyState、LoadingState、ErrorState、PermissionDenied、NotFound、Skeleton、RequestIdDisplay。

**本阶段新增**：
- **Radio**：label + stateLabel，与 Checkbox 一致模式
- **Textarea**：统一 text-input 样式
- **SectionHeader**：title + description + actions
- **DropdownMenu**：trigger + 面板、menuitem 角色、Escape 关闭、点击外部关闭、disabled/danger 项
- **Tooltip**：hover/focus 触发、side 定位、role="tooltip"
- **CursorControls**：独立模块 `CursorPagination.tsx`（cursor 分页，非 page 分页）

所有组件支持 disabled/loading/error 状态，正确处理 focus，状态不只靠颜色表达（StatusBadge 含圆点+文字，Alert 含图标+role）。Dialog/Drawer 已含 focus trap、Escape 关闭和焦点恢复。

## 6. 员工端 App Shell

文件：`apps/web/src/staff/StaffShell.tsx`（重写）、`apps/web/src/staff/staff-navigation.ts`（新增导航配置）、`apps/web/src/styles/staff-shell-v2.css`（新增样式）。

### 桌面端（≥1024px）
- 固定侧边栏（232px，sticky，可滚动）
- 品牌标识 + 主导航（含可展开分组）+ 人员信息 + 退出操作
- 顶栏（sticky 56px）：面包屑 + 页面标题 + 全局搜索 + 会话上下文（姓名/角色/站点范围）
- 内容滚动区，最大宽度 1440px

### 手机/平板（<1024px）
- 侧边栏隐藏，顶栏显示汉堡菜单按钮
- 点击汉堡按钮打开 Drawer（左侧滑入，overlay 遮罩）
- Drawer 含完整导航 + 退出操作
- Drawer 支持 focus trap、Escape 关闭、焦点恢复、点击遮罩关闭
- 390px 下顶栏紧凑，面包屑隐藏，会话上下文隐藏，确保无水平溢出

### 导航配置驱动
`staff-navigation.ts` 导出 `STAFF_NAV_ITEMS`（11 项）、`getVisibleNavItems(session)`、`getBreadcrumbForPath()`、`getPageTitleForPath()`、`formatMarketplaceScope()`。所有导航项的可见性由纯函数判定，便于测试。

## 7. 权限处理

- 导航可见性完全基于 `StaffSession.role.code` 和 `permissions[]` 数组
- Owner 专属入口（员工与权限、经营看板）仅 owner + 对应权限可见
- Personal DENY 通过后端在 session permissions 中扣除后体现（前端不自行计算 DENY，只信任 session 中的最终 permissions）
- Marketplace scope 在顶栏和会话上下文中显示
- Seller organization 边界不变（后端控制，前端不越权）
- **前端隐藏不替代后端权限**：所有 API 调用仍由后端校验

## 8. 响应式与无障碍

验证视口：1440px、1280px、768px（通过 1024px 断点覆盖）、390px（Playwright 截图实证）。

- 键盘导航：所有交互元素可 Tab 聚焦，Drawer/Dialog focus trap
- 清晰 focus ring：`--focus-ring` 统一，`:focus-visible` 样式
- 正确 label：IconButton 必须传 label，DropdownMenu/Tooltip 有 aria 属性
- heading 层级：顶栏 h1（页面标题），内容区 h2（SectionHeader）
- 状态文字：StatusBadge 含文字标签，不只靠颜色
- 点击区域：导航项最小 40px 高，子项 34px
- `prefers-reduced-motion`：全局禁用动画和过渡
- Drawer/Dialog 焦点管理：打开时聚焦第一个可聚焦元素，Tab 循环，Escape 关闭，关闭后恢复触发元素焦点
- 手机端导航：汉堡按钮 + Drawer，390px 可操作
- 无水平溢出：390px 截图实证

## 9. 截图

### 重构后截图（Playwright + mock session，本地 vite preview）

路径：`tmp/stage7a1-screenshots/`

| 文件 | 视口 | 说明 |
|---|---|---|
| `staff-shell-after-1440x900.png` | 1440×900 | 员工端主框架，owner 角色，工作台 |
| `staff-shell-after-1280x800.png` | 1280×800 | 员工端主框架，窄桌面 |
| `staff-shell-after-390x844.png` | 390×844 | 手机端，Drawer 关闭 |
| `staff-shell-after-390x844-drawer.png` | 390×844 | 手机端，Drawer 打开 |
| `staff-finance-after-1440x900.png` | 1440×900 | 财务页，验证旧业务页面在新壳层中打开 |

### 重构前截图

**未生成**。原因：本阶段直接在工作树上重构了 StaffShell，旧代码已被替换。旧 shell 的视觉表现可通过 git 查看 `754c0f0` 版本的 `StaffShell.tsx` + `design-freeze.css` 复现。未伪造"重构前"截图。

截图脚本：`apps/web/e2e/stage7a1-screenshots.spec.ts`（使用仓库现有 mock session 模式，与 `screenshots.spec.ts` 一致，不绕过安全认证）。

## 10. 测试结果

### 新增测试
- `apps/web/src/staff/StaffShell.navigation.test.tsx`：35 个测试
  - 导航配置：11 项结构、各角色可见性、Owner-only、Personal DENY 模拟、Marketplace scope
  - 面包屑与页面标题
  - StaffShell 渲染：侧边栏、会话上下文、当前路由高亮、退役入口不存在、规划中徽章
  - 移动端 Drawer：打开/关闭、Escape、焦点恢复、导航后关闭
  - 旧业务路由可进入
- `apps/web/src/ui/primitives.stage7a1.test.tsx`：16 个测试
  - Textarea/Radio/SectionHeader/DropdownMenu/Tooltip 功能
  - disabled/loading/error 状态

### 更新测试
- `apps/web/src/App.routes.msw.test.tsx`：导航标签断言更新为新 IA，补充 FINANCIAL_VIEW 权限

### 全量测试
- `npm run typecheck`：**PASS**（0 错误）
- `npm test`：**PASS**（259 测试文件，1776 测试全部通过）
- `npm run build`：**PASS**
- `openspec validate --all --strict`：**PASS**（63 items）
- `npm run verify:api-contract`：**PASS**（248 端点不变）
- `npm run verify:web-source-boundaries`：**PASS**（14 rules, 0 violations）
- `npm run check`：运行中，结果待确认

### Playwright 截图测试
- `stage7a1-screenshots.spec.ts`：**5/5 PASS**

## 11. Bundle 变化

构建产物（`apps/web/dist`）：

| Chunk | 大小 | gzip |
|---|---|---|
| index (主入口) | 242.19 kB | 71.44 kB |
| session-invalidation | 109.55 kB | 30.57 kB |
| runtime | 62.24 kB | 22.30 kB |
| StaffRouteModule | 28.00 kB | 9.49 kB |
| StaffFinanceRouteModule | 29.90 kB | 8.64 kB |

- 路由级 code splitting 保留（各业务模块独立 chunk）
- 未引入大型 UI 框架或动画依赖
- 新增 CSS（staff-shell-v2.css）约 10.8 kB，合并入主 bundle
- 设计 tokens 未显著增加 bundle 体积（纯 CSS 变量）

## 12. 未解决问题

1. **规划中导航项（订单/评论与凭证/卖家结算/文件归档）**：当前以"规划中"徽章显示但不可点击。后续阶段 7A-2 及以后需补齐对应列表页。
2. **重构前截图未生成**：因直接在工作树重构，未保留旧 shell 运行态截图。可通过 git stash 旧版本后运行截图脚本补拍。
3. **侧边栏内容密度**：1440×900 下 11 项导航（含展开分组）+ 页脚人员信息接近充满侧边栏，较小屏幕可能需要滚动。已设置 `overflow-y: auto`。
4. **全局搜索组件**：沿用现有 `GlobalSearchDropdown`，未在本阶段重构。
5. **Buyer/Seller 端未重构**：本阶段仅重构员工端，Buyer/Seller 门户保持原样。

## 13. 明确声明

- **不代表 Staging/Production GO**：本阶段为本地前端重构，未部署、未推送、未触碰任何远程资源。
- 后端 API 合同未修改（248 端点不变）。
- Schema 未修改（仍为 26）。
- 未进入阶段 7A-2（工作台/订单列表/订单详情重构）。
- 未进入 Buyer/Seller 重构。
- 未进入阶段 8（部署准备）。

## 14. 文件清单

| 操作 | 文件 |
|---|---|
| 新增 | `docs/migration/V2_FRONTEND_ROUTE_REBUILD_INVENTORY.md` |
| 新增 | `docs/migration/V2_FRONTEND_REBUILD_STAGE7A1_HANDOFF.md`（本文件） |
| 新增 | `apps/web/src/staff/staff-navigation.ts` |
| 新增 | `apps/web/src/staff/StaffShell.navigation.test.tsx` |
| 新增 | `apps/web/src/styles/staff-shell-v2.css` |
| 新增 | `apps/web/src/ui/primitives.stage7a1.test.tsx` |
| 新增 | `apps/web/e2e/stage7a1-screenshots.spec.ts` |
| 修改 | `apps/web/src/styles/tokens.css`（全面重构） |
| 修改 | `apps/web/src/ui/primitives.tsx`（新增 5 组件） |
| 修改 | `apps/web/src/staff/StaffShell.tsx`（重写） |
| 修改 | `apps/web/src/auth/staff/StaffSessionBoundary.tsx`（导出 context） |
| 修改 | `apps/web/src/main.tsx`（引入新 CSS） |
| 修改 | `apps/web/src/App.routes.msw.test.tsx`（更新导航断言） |
| 删除 | `apps/web/src/staff/StaffCallbackModule.tsx`（死代码） |
