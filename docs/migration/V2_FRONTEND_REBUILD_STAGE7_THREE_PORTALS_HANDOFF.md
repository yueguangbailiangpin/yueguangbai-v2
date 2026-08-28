# 前端重建阶段 7 交接：三端统一 Material 3 视觉重构（员工/买家/卖家）

日期：2026-08-28。分支 `feature/staging-workflow-rate-ux`，起点 `d244c788`（阶段 6.6E 完成点，schema 30 / 224 端点）。本阶段四个本地提交（未 push）：

| # | SHA | 提交 |
|---|---|---|
| 1 | `f538f890` | `feat(web): rebuild staff portal with moonwhite material design`（含 tokens.css Material 3 重写） |
| 2 | `09d1b4ae` | `feat(web): rebuild buyer portal with moonwhite material design` |
| 3 | `25033eb4` | `feat(web): rebuild seller portal with moonwhite material design` |
| 4 | `4859d150` | `refactor(web): remove superseded portal UI and legacy styles`（清理 + 两个新 e2e spec + 本文档随后提交） |

视觉权威：用户提供的两个设计模板（已读取并在浏览器渲染确认）：
`~/.codex/visualizations/2026/08/24/01a03432-.../moonwhite-google-console.html`（员工端）与 `moonwhite-buyer-seller-portals.html`（买家/卖家端）。

> **声明**：本阶段为本地前端重构，**不是 Staging / Production GO**。未 push、未部署、未触碰任何远程资源。

## 1. 设计系统

- `apps/web/src/styles/tokens.css` 全面重写为模板 Material 3 色板：主蓝 `#0b57d0`（员工/买家），卖家绿 `#137333`（container `#c4eed0`/`#06351c`），canvas `#f8fafd`，选中面 `#d3e3fd`/`#041e49`，边框 `#dde3ea`，语义色固定（success `#137333`/warning `#8a4f00`/danger `#b3261e`）。保留全部变量名使既有组件即时换肤；新增 container/chip 层 tokens（`--color-primary-container`、`--color-seller-container`、`--radius-nav: 20px`、`--radius-panel: 24px`、`--control-height-xl: 48px` 等）。8px 间距、z-index、reduced-motion、focus ring 体系不变。
- 三端共享 primitives（`ui/primitives.tsx`）经 global.css 重样式：胶囊按钮（primary/tonal/danger）、chip 状态徽章、Material 下划线 Tabs、24px 圆角 surface、表格密度（42px 表头/48px 行/右对齐 tabular 数字）、圆形 tinted 头像/图标。
- 新增三张端级样式表：`staff-shell-v2.css`（重写）、`buyer-portal.css`（新增，`.mwb-*`）、`seller-portal.css`（新增，`.mws-*`），统一 64px appbar + 月亮品牌标 + 胶囊搜索 + 240/230px 胶囊导航侧栏 + 移动端 Drawer（focus trap/Escape/焦点恢复）+ 底部导航（买家/卖家）。

## 2. 员工端（7A）

- Shell：64px 顶栏（月亮标+月光白、全局搜索胶囊、会话/头像）、240px 胶囊侧栏（active `#d3e3fd`）、导航仍由 `staff-navigation.ts` 纯函数按真实权限驱动（11 项 IA 不变，规划中项保留徽章）；移动端 308px Drawer。
- 工作台：模板首页布局——建议先处理（round tinted 图标行+主操作）、我的待办/全部待办（owner）、今日已处理、侧栏"今日概览"（仅展示 work-items API 真实可推数量；无 API 支持的逾期/返款金额未展示，不造数）。
- 订单详情：chip+订单号标题、五列关键事实条、凭证与沟通截图分组（付款截图严格一张 + 沟通截图多张带上传人/时间，6.6E 合同）、时间线、右侧参考面板（垫付摘要 buyer_refund/owner 可见；财务快照仅 owner+FINANCIAL_VIEW）。全部沿用既有查询/幂等/版本逻辑。
- 其余页面（买家客户/产品/返款/财务/权限/运营）经 shell+tokens+primitives 自动换肤。

## 3. 买家端（7B）

- Shell：64px appbar（买家中心标签）、230px 胶囊侧栏（首页/产品与预约/我的订单/评论任务/返款记录/账户资料）+ 底部四项导航 + Drawer；侧栏脚显示真实买家编号+站点（`buyerApi.me`）。
- 首页（新 `BuyerHomePage`）：下一步待办（待改截图>待传截图>待提交评论优先级，来自真实 queries）、进行中订单卡（状态 chip+五段 mini 进度）、当前可预约产品格、账户摘要；无 KPI 墙、无虚构数据。
- 订单详情：五步进度、下单指引 dl+info-note、订单付款截图单张上传（文案"一笔订单一张完整截图"）；买家端无订单沟通截图入口（e2e 断言不存在）。
- 评论/返款文案保持中性，无好评返款绑定表达。

## 4. 卖家端（7C）

- Shell：绿色身份（月亮标绿影、胶囊导航 active `#c4eed0`）、店铺筛选保留（storeId 上下文功能不变）、移动端底部导航+Drawer。
- 首页：组织名标题、建议处理（待结算/沟通截图更新/进行中订单，全部真实数据）、店铺与产品行（ACTIVE 绿/DISABLED 灰"保留历史记录"）、本月概览（结算 summary 权威值，绝不前端重算）、组织成员（Owner 可见）。
- 结算：四列摘要（待结本金/服务费/待认领转入款/待结合计，全部后端冻结值）、结算项目行（状态 chip+应结/已结/未结）、计价规则面板（仅展示最近订单冻结快照+info-note"快照不随规则调整改变"）、明细表右对齐数字；打款/凭证流程原样保留。
- 订单与沟通：跨组织 concealed 404 不变；多张沟通截图；无买家返款/平台利润（e2e 断言为 0 命中）。

## 5. 权限矩阵落地方式

导航可见性全部由 session role/permissions 纯函数决定（staff-navigation、BuyerFrame、SellerLayout）；前端隐藏不替代后端校验。Personal DENY 经后端 session permissions 扣除后体现。权限/隔离 e2e 断言：buyer_refund 见垫付不见利润（stage66e + stage7 spec）、非 owner 无权限管理入口且直访 403、卖家非 OWNER 不见成员管理、跨组织 concealed 404、买家端无卖家财务字段、卖家端无买家返款/利润。

## 6. 后端合同保持

零后端修改：API 224 端点、schema 30、contracts 未动。`verify:api-contract` 0。

## 7. 清理（提交 4）

- 删除组件：`buyer/routes/BuyerLayout.tsx`（纯 re-export，BuyerRouteModule 直接引 BuyerFrame）、`staff/shared/EffectTimeline.tsx`（零引用孤儿）。
- CSS：global.css 删 103 个无引用规则块、design-freeze.css 删 39 块（旧 seller/buyer/staff 壳层、退役邀请 UI、响应式辅助类等；每个类名经全仓字面 grep 证明无引用；动态拼接类族保留）。
- 路由：`/staff/rate-center`、`/staff/seller-principal-rate-policies` 槽位声明**保留**——实测删除后旧路径落到 catch-all 404，破坏既有重定向回归测试（route-slot 架构需要该子 Route 存在）；已在 App.tsx 注释说明。
- verifier 修复：`verify-buyer-portal-contract.mjs` 文件清单移除已删的 BuyerLayout.tsx。
- 全仓废弃功能 grep：公共池/抢任务/获客中心/outbox/dead-letter/financial-projection 运行时零残留（仅退役说明注释与测试负向断言）。

## 8. 保留的历史能力

买家来源渠道（buyer_channels 建档必填）、B/C 编号显示（建档即分配）、邀请绑定激活、预约永久限制提示、财务权威字段（冻结快照直显）、冷归档占位与恢复、DISABLED 店铺历史、历史订单读取（order-integrity events/adjustments 合并展示，D-056 §4.5）。

## 9. 验证结果（真实执行，2026-08-28 最终提交树 4859d150+）

| 命令 | 退出码 |
|---|---|
| `npm run typecheck` | 0 |
| `npm test` | 0（250 文件 / 1,694 用例全过） |
| `npm run build` | 0 |
| `npm run check` | 0 |
| `openspec validate --all --strict` | 0（62/62） |
| `npm run verify:api-contract` | 0 |
| `npm run verify:web-source-boundaries` | 0（14 规则 0 违规） |
| `npm run verify:web-static-build` | 0 |
| Playwright `stage7-three-portals.spec.ts`（16 用例）+ `stage7-three-portals-screenshots.spec.ts`（12 用例） | 28/28 PASS |
| Playwright `stage66e`(7) `staff-workbench`(4) `stage7a1-screenshots`(5) `seller-visual-refresh`(6) | 全过（员工端 spec 头部文案断言已随重命名更新） |
| 废弃功能残留全仓扫描 | 运行时 0 引用 |

Bundle（dist 主要 chunk，raw）：index 262.4 kB / identity-request 109.9 kB / runtime 62.2 kB / StaffWorkItemRouteModule 48.5 kB / SellerRouteModule 47.9 kB / demo-api 惰性 chunk 42.6 kB。未新增依赖。

## 10. 截图

`tmp/stage7-three-portals-screenshots/`（gitignore，磁盘留存，vite preview + 确定性 mock 生成）：
staff-workbench / staff-order-detail / staff-mobile / staff-mobile-drawer、buyer-home / buyer-order-detail / buyer-mobile / buyer-mobile-drawer、seller-home / seller-settlement / seller-mobile / seller-mobile-drawer（均含 1440x900 或 390x844 后缀）。

说明：任务清单中的 "Staff Order List 1440" 以 staff-order-detail 替代——员工端**没有订单列表页**（后端仅有 `GET /api/staff/formal-orders?amazon_order_number=` 单单查询，见 §11 阻塞项）。

## 11. 阻塞项与后端合同缺口（记录，未自行扩后端）

1. **员工端订单列表页**：无列表端点（无 cursor 分页/状态筛选的 formal-orders 列表 API）→ 订单导航仍为"规划中"，列表页未建，未造假页面。
2. **订单详情固定负责人/下一步**：`GET /api/staff/formal-orders/:id` 无负责人字段 → 参考面板省略该分区。
3. **工作台 SLA/逾期/今日返款金额**：work-items API 不暴露 → 今日概览仅展示可推导计数。
4. **卖家端产品主要对接人**：seller-portal products DTO 无对接人字段、无设置端点 → 首页该分区省略（查看/设置为模板要求，待后端）。
5. **卖家端沟通截图上传人/时间**：seller DTO 的 communication_screenshots 无 uploaded_by/uploaded_at（仅员工端 DTO 有）→ 卖家端暂只展示截图本身。
6. **卖家结算批次化**（周批次/批次确认/导出）：后端仅 summary/payables/payments → 以"结算项目"行呈现。
7. **买家端固定联系人**：buyer-portal 无 assigned-staff DTO → 首页"需要帮助"分区省略。

## 12. 既有 e2e fixture 漂移（非本阶段引入）

`module1-buyer`/`buyer-visual-pilot`/`buyer-remaining-visual`/`customer-security` 等买家 e2e 存在 25 个基线即失败的用例（fixture 落后合同：PAYMENT_REVERSED 文案、FileDropZone aria、注册成功页需手动点击进入等）；7B 代理经干净基线构建比对确认与本次重构无关。`seller-visual-refresh` 的 fixture 漂移（settlement_account_* / legacy_projection / main_image / order_screenshot）已在该 spec 内修复。

## 13. 远程操作

零：未 push / 未建 PR / 未触碰 Cloudflare、Google Drive、GitHub 远端、真实数据。未进入营销官网、阶段 8、部署。

## 14. 下一步

等待 ChatGPT 统一总审（代码 + 截图 + 权限 + 业务流程）。审后可选项：§11 阻塞项逐个开 OpenSpec Change 补后端合同，再补对应前端页面。
