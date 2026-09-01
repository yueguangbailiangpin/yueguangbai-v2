# Tasks: stage7f-frontend-complete-rebuild

子阶段严格串行；每个子阶段完成后运行全量门禁并创建独立本地提交，未全绿不得进入下一子阶段。

## 0. 7F-1 前置

- [x] 0.1 验证权威起点：HEAD `a2e4eebb`、分支 `feature/staging-workflow-rate-ux`、工作树干净、领先 42 提交、schema 36、240 endpoints
- [x] 0.2 真实浏览器复现三端故障并定位根因（work-items SLA 字段漂移、summary 端点缺失、订单列表返回聚合、结算/客服/客户目录端点缺失）

## 1. 7F-1：修复三端 Review Runtime（提交 `fix(review): restore schema36 three-portal review runtime`）

### Demo 合同对齐

- [x] 1.1 重写 `apps/web/src/review/demo-data.ts`/`demo-api.ts`：work-items 补 `sla_due_at`/`is_overdue`/`overdue_since`/`next_action`/`responsible_role`/`responsible_staff_name`/`priority`；新增 `/api/staff/me/work-items/summary`、`/api/staff/me/work-items/:id`、`/api/staff/formal-orders` 列表模式（查询串仅 `amazon_order_number` 时保持查单聚合）、`/api/staff/finance/orders/:id`、`/api/staff/seller-settlements/:org/{summary,payables,payments}`、`/api/staff/service-channels`、`/api/staff/customer-onboarding/seller-directory`、`/api/staff/customer-security/seller-invitations{,/current}`、`/api/staff/demand-batches/:id/reservation-schedule` 等全部缺失端点；修正既有 fixture 与 strict schema 的字段漂移
- [x] 1.2 Demo 数据覆盖正常业务状态（订单/待办/客户/产品/返款/结算批次均非零），客服渠道按后端合同种子为空则空（不得编造真实联系方式）
- [x] 1.3 新增 Review 合同测试：对每个评审可达 GET 端点用页面真实 strict schema 解析 demo 响应；角色 × 端点矩阵（四员工角色）不出现 blocked/MALFORMED

### 三端可进入

- [x] 1.4 `/review`、`/review/staff`、`/review/buyer`、`/review/seller` 真实浏览器逐个打开：无 MALFORMED_RESPONSE、无"服务暂时不可用"、无"当前面板加载失败"、无"读取失败"、无无限加载、无空白页
- [x] 1.5 owner/pre_sales/seller_ops/buyer_refund 四类员工角色全部可进入并渲染各自导航；OWNER/OPERATIONS/FINANCE/VIEWER 四类卖家角色全部可进入；买家端正常进入
- [x] 1.6 e2e：评审模式三端冒烟（沿用并修复 `review-mode.spec.ts`）

## 2. 7F-1：新样式基础层（并入提交 `feat(web): rebuild staff portal information architecture and core pages`）

- [x] 2.1 `tokens.css` 新基线令牌（`#f8fafd`/`#0b57d0`/间距/圆角 12~16px/层级）
- [x] 2.2 `base.css` reset + 元素默认；`primitives.css` 共享原子（按钮分级/输入 40px/表格行 44~52px/Badge/Dialog/Drawer/EmptyState）
- [x] 2.3 `staff-shell.css`（240~256px 侧栏、64px 顶栏、导航分组、移动 Drawer）与 `staff-pages.css`（工具栏筛选行/紧凑表格/分区卡片/详情栅格/内容最大宽度）
- [x] 2.4 buyer/seller legacy 隔离层：旧 CSS 职责限定为未迁移页面；`main.tsx` 加载顺序固定并注释职责
- [x] 2.5 禁止文件尾部追加覆盖修 UI（review 工具检查 CSS 重复与覆盖链）

## 3. 7F-1：员工端信息架构收口（并入提交 `feat(web)`）

- [x] 3.1 删除全部"规划中"徽章与假导航（评论与凭证/卖家结算/文件归档）
- [x] 3.2 删除公共池、抢任务、获客中心、双聊天截图入口、旧订单完整性页面入口、旧费率中心重复入口（旧路径保留重定向）
- [x] 3.3 卖家结算并入财务工作区；客服渠道入系统设置；经营看板 Owner-only（其余角色不渲染入口）
- [x] 3.4 四类员工角色导航矩阵测试（入口可见性 = 后端 session 权威值驱动）
- [x] 3.5 源码守卫：员工端不得出现"规划中"文案与已退役导航 ID/路由

## 4. 7F-1：员工端核心页面重做（并入提交 `feat(web)`）

- [x] 4.1 工作台：问候/日期/角色/刷新、我的待办摘要、即将超时、异常工作项、最近处理、Owner 简化经营摘要；无公共池/抢任务；不做大面积财务 BI
- [x] 4.2 订单列表：删纵向全宽筛选表单；桌面单行工具栏（搜索+业务阶段+异常+负责人+日期+清除）、结果计数、紧凑表格、状态 Badge、后端 keyset 翻页、整行进详情；移动端搜索+筛选 Drawer+卡片列表、无横向溢出；筛选入 URL 状态测试
- [x] 4.3 订单详情：身份摘要→阶段/负责人/下一步/截止/异常→买家卖家→付款截图→沟通截图（含上传人/时间）→评论与返款→卖家结算→按权限财务区；不重复标题/面包屑
- [x] 4.4 客户页面：买家/卖家分开；统一列表/搜索/状态/负责人/详情入口；买家编号为主识别字段；不暴露内部 ID
- [x] 4.5 产品与预约：产品/店铺/名额/主要对接人紧凑列表；预约规则/异常/人工例外层级清楚
- [x] 4.6 买家返款：状态/金额/截止/负责人/提醒/凭证；仅显示当前角色被授权财务字段
- [x] 4.7 财务与结算：Stripe 式分区（摘要/应付/批次/付款进度/异常）；结算批次列表与详情真实可用；导出保留后端合同；前端不重算权威金额
- [x] 4.8 员工与权限 + 系统设置：列表+详情面板+确认 Dialog；Personal DENY/角色/状态区分明确；Owner-only 入口不泄露
- [x] 4.9 组件测试（MSW/jsdom）：核心页面渲染/筛选状态/移动 Drawer/权限字段隔离
- [x] 4.10 Playwright：正常态 + 空态 + 错误恢复流（员工订单列表/详情/财务、买家与卖家 Foundation/视觉矩阵已直接验证；未把 gated screenshot skip 当作通过）

## 5. 7F-1：组件与 CSS 清理（提交 `refactor(web): retire migrated staff legacy styles`）

- [x] 5.1 盘点员工端组件与选择器；已迁移旧组件删除（不留双套）
- [x] 5.2 删除员工端不再引用的旧 CSS 规则；新员工端零依赖旧页面布局选择器
- [x] 5.3 源码守卫：员工端禁止引用已退役旧类名清单；旧类名清单入测试
- [x] 5.4 交接文档写明 `main.tsx` CSS 加载顺序与各层职责、仍保留旧 CSS 的原因

## 6. 7F-1：验证与收口（提交 `docs(web): close stage7f1 staff portal rebuild`）

- [x] 6.1 真实执行并记录退出码：typecheck / test / build / check / openspec validate（本 change 与 --all --strict）/ verify:api-contract / verify:web-source-boundaries / verify:web-static-build / verify:css-duplicates / 既定 Playwright 终门 / 新增视觉 Playwright / git diff --check；禁止管道后 `$?` 冒充（2026-08-31 本地证据见交接文档 §16）
- [x] 6.2 视觉验收截图（员工端 17 项 + 评审恢复证据 4 项）逐张人工复核；截图前断言：关键正常数据可见、无错误 Alert、无加载中、无服务暂时不可用、无 MALFORMED_RESPONSE、图片真实解码、无水平溢出、无规划中/公共池/抢任务/获客中心；本地证据见 `stage7f-visual-evidence-fixture-repair/evidence.md`，当前主证据目录为 `tmp/stage7f-visual-evidence-repair-20260831-final/`
  - [x] 6.2a 员工端视觉纠偏第一版：按 `moonwhite-google-console.html` 逐区块移植 Shell + 工作台样板（64px 顶栏、240px 侧栏、圆形月亮标、48px 搜索、20px 导航胶囊、24px Surface、建议先处理/我的工作/315px 右栏、390px 真手机布局与可操作 Drawer）；只覆盖本轮样板，不代表员工端 17 项视觉验收完成
  - [x] 6.2b 使用真实 `/review/staff` 验证 owner + pre_sales 权限与字段隔离，并生成、程序化断言及逐张人工复核本轮三张证据：`tmp/stage7f1-staff-visual-correction/staff-workbench-owner-{1440x900,390x844}.png`、`staff-workbench-owner-drawer-390x844.png`
  - [x] 6.2c 员工端其余页面与完整 17 项 + 4 项评审恢复视觉矩阵（本地专用 evidence spec、21 张截图及逐张人工复核见 `stage7f-visual-evidence-fixture-repair/evidence.md`；另有三项失败优先回归断言）
  - [x] 6.2d 员工端订单列表、订单详情、财务工作区视觉样板：沿用已验收 Shell；完成桌面/手机订单列表、筛选 Drawer、订单详情与财务结算分区；使用真实 `/review/staff` Demo 数据完成六张截图、图片解码、权限隔离、无横向溢出与无错误状态断言；仅代表本轮三个页面视觉证据，不代表 7F-2/7F-3 或完整视觉矩阵完成
- [x] 6.3 独立本地提交（不 amend）；报告：三端可打开结论、完成/未完成页面清单、删除清单、保留旧 CSS 原因、四角色结果、截图路径与复核结果、全部退出码、提交与 HEAD、工作树状态、未 push/未部署/未进入阶段 8（2026-08-31 本地证据见交接文档 §16）

## 7. 7F-2+（后续子阶段，本轮不执行）

- [x] 7.1 买家端视觉重做（7F-2）：首页、产品/预约、订单详情、手机布局、Drawer 与单张付款截图语义均由真实路由/fixture 验证；本轮补齐三端 Material Symbols 统一适配
- [x] 7.2 卖家端视觉重做（7F-3）：首页、店铺/产品、订单沟通截图、结算、手机布局、Drawer 与权限边界均由真实路由/fixture 验证；本轮补齐三端 Material Symbols 统一适配
- [x] 7.3 legacy CSS 全量退役与收尾（7F-4）。子 Change `stage7f4-legacy-css-retirement` 已完成（`isComplete=true`、13/13 tasks），当前 CSS/source/static guards 复核通过；子 Change 仍未归档。父级证据见 `evidence.md`。
