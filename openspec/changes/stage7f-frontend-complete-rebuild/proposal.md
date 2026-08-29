# Proposal: stage7f-frontend-complete-rebuild

## Why

阶段 7.5 全部后端合同收口后（schema 36、240 endpoints、67/67 OpenSpec 任务、1,786 测试全绿），前端停留在阶段 7R 的过渡状态：三端评审环境（`/review/*`）因 demo fixture 未跟进 stage75 batch 1/2/3 合同（订单游标列表、work-item SLA 字段、工作台摘要、结算批次、客服渠道）而大面积报 `MALFORMED_RESPONSE`/`当前面板加载失败`；五份 CSS（9,579 行）同时全局加载且靠文件尾部覆盖修 UI；员工端仍展示"规划中"徽章与无真实页面的假导航；工作台/订单/财务页面视觉语言不统一。本 Change 在不触碰稳定后端合同的前提下，恢复评审环境并彻底重建前端。

## What Changes

严格按子阶段串行执行（7F-1 员工端 → 7F-2 买家端 → 7F-3 卖家端 → 7F-4 收尾）；每个子阶段独立本地提交、全量门禁、真实浏览器视觉验收。

### 7F-1（本轮）：评审环境修复 + 员工端完整返工

1. **三端 Review Runtime 修复**：demo session/demo API/运行时 strict schema 对齐 Schema 36 / API 240 当前合同（补齐 work-items SLA 字段、workbench summary、订单列表分页、finance/orders、seller-settlements、客服渠道、客户目录等全部缺失端点与漂移字段）；禁止 `.passthrough()`/跳过解析/降低 strict；四类员工角色与四类卖家角色全部可进入；页面不得出现 MALFORMED_RESPONSE、服务暂时不可用、当前面板加载失败、读取失败、无限加载、空白页；Demo 数据覆盖正常业务状态。
2. **冻结新设计语言**：以 Google Workspace Admin 框架 + Material 3 交互 + Stripe 财务层级 + Ant Design 列表密度 + Atlassian 导航分组为基线，建立 tokens → reset/base → shared primitives → staff shell → staff page patterns → buyer/seller legacy 隔离层的样式层；员工端 `#f8fafd` 背景、`#0b57d0` 主色、240~256px 侧栏、64px 顶栏、14px 正文、轻边框分区、12~16px 卡片圆角；禁止 AI 模板化大卡片大数字与桌面压手机。
3. **员工端信息架构收口**：删除全部"规划中"徽章、假导航、公共池、抢任务、获客中心、双聊天截图入口、旧订单完整性页、旧费率中心重复入口；评论与凭证走订单详情/工作项；卖家结算并入财务工作区；文件归档走订单详情与运营工具；客服渠道入系统设置；经营看板 Owner-only；权限继续以后端 session 权威值为准。
4. **员工端核心页面彻底重做**：工作台（今天要处理什么）、订单列表（单行工具栏筛选 + 紧凑表格 + keyset 翻页 + 移动 Drawer）、订单详情（业务层级重排、图片带上传人/时间）、客户页面（买家/卖家分开、买家编号为主识别字段、不暴露内部 ID）、产品与预约（紧凑列表）、买家返款（状态/金额/截止/负责人/凭证、按权限显示财务字段）、财务与结算（Stripe 式分区、批次列表与详情真实可用、不在前端重算权威金额）、员工与权限 + 系统设置（列表 + 详情面板 + 确认 Dialog、Owner-only 入口不泄露）。
5. **组件与 CSS 清理**：删除已迁移员工端旧组件与不再引用的旧 CSS；新员工端不依赖旧页面布局选择器；新增源码守卫禁止员工端重新引用已退役旧类名；`main.tsx` CSS 加载顺序写入交接文档；`global.css`/`design-freeze.css` 在买家/卖家迁移完成前保留（legacy 隔离层）。
6. **视觉验收**：真实浏览器逐页截图（员工端 17 项 + 评审恢复证据 4 项），截图前断言无错误态、无加载中、无水平溢出、无规划中、Demo 数据可见；逐张人工复核，不以"截图生成成功"或测试通过冒充视觉完成。

买家端、卖家端本轮只恢复到可正常查看的 Demo 状态，不做视觉重做（留给 7F-2/7F-3）。

## Migration

无。纯前端（`apps/web`）与评审运行时变更；不修改任何后端合同、迁移或稳定端点。

## 权限、隐私影响

- 员工端权限判断继续使用后端 session 权威值（角色/权限/data_scope/Personal DENY），前端不放宽任何可见性。
- Owner-only 入口（经营看板、客服渠道设置）不向其他角色渲染。
- 买家编号为主要识别字段；内部 ID 不进入员工端展示。
- Review Runtime 继续使用真实生产组件，仅替换数据来源；不新增数据出口。

## Impact

- `apps/web/src/review/*`（demo 数据全面重写对齐 Schema 36）
- `apps/web/src/styles/*`（新基础层 + legacy 隔离层）
- `apps/web/src/staff/*`（信息架构、Shell、八个页面组重做）
- `apps/web/src/main.tsx`（CSS 加载顺序）
- 新增源码守卫测试与 Review 合同测试
- 不影响 `apps/api`、`packages/*`、migrations
