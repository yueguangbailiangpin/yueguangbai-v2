# Change Proposal: Staff Portal Visual Refresh

## Why

Staff 已有可信独立会话、四角色授权、队列/详情/受控动作、获客登记、产品预约排期和总管理员经营看板，但真实页面仍由重复页头、宽松卡片和彼此独立的布局组成。工作队列没有形成参考方向中的高效率桌面工作台，其余 Staff 页面也缺少统一的侧栏、筛选、列表、详情和操作层级。需要一个只改 Staff 展示的 Change，在不改变业务事实、权限或合同的前提下统一全部真实 Staff 页面。

## What Changes

- 统一 `/staff/login`、受保护 Staff 壳层、工作队列/详情/受控操作、客户邀请与账号恢复、获客登记、产品库/产品详情/预约排期和总管理员经营看板的视觉层级。
- 桌面端使用清晰侧栏、紧凑上下文栏和高密度内容区；工作队列保持队列 → 详情 → 受控操作 DOM 与权限顺序，窄屏按同一语义顺序自然重排。
- 压缩重复品牌、页面标题和说明，只保留真实工作语境、筛选、状态、主要动作、必要恢复与安全说明。
- 导航、字段和动作继续只依据可信 Staff Session 中后端投影的唯一角色、有效权限和服务端 DTO；直接 API 仍由后端重新校验 Scope、Personal DENY、负责人权限包与资源归属。
- 保留 `/staff/acquisition` 稳定可收藏入口；总管理员、售前和卖家对接仅在后端投影允许时看到入口，买家返款不得看到登记入口或控件。
- 保持经营看板的预计利润与已完成利润分离，保持北京时间、整数金额、审计/文件/归档语义和全部既有受控动作不变。
- 生成确定性的 before/after 响应式截图并逐张复核，验证四角色矩阵、键盘/200%/减少动态效果/44px/横向溢出和按需加载；记录同环境生产构建 raw/gzip before/after。

## Scope

- `apps/web` 中 Staff 登录的展示分支。
- `/staff`、`/staff/queue`、`/staff/work/:workItemId`、`/staff/acquisition`、`/staff/admin-business-dashboard`、`/staff/products`、`/staff/products/:productId`、`/staff/demands/:demandId/reservations`。
- Staff 壳层、Staff 页面专用展示组件/样式、Staff 专用测试与确定性证据。
- 本唯一 OpenSpec Change `staff-portal-visual-refresh`。

## Out of Scope

- Buyer 或 Seller 页面、壳层、路由、组件行为、文案或视觉修改。
- API、Contract、Domain、Migration、Schema、DTO、请求体、响应字段、状态机、权限目录、角色默认值、Personal DENY、Scope、负责人权限包、Session、缓存命名空间、幂等、Audit、Outbox、文件授权、归档/备份或生产配置变化。
- 新动作、字段、筛选、统计、总数、客户资料、内部利润口径、获客归因、预约排序、排期或自动关联。
- 新 UI/表格/表单框架、运行时依赖、外部中文字体、暗色主题、全站玻璃/模糊或第二套 token。
- 依赖清单、部署、生产 Migration、Cloudflare/D1/R2、Drive、飞书、OpenAI/ChatGPT MCP、域名/DNS、真实 secrets、Git 远程、PR、Integration 或自动化操作。

## Migration and Contract Impact

`NO_SCHEMA_CHANGE`。现有 Staff Session、运行时 DTO、API 路由、版本/幂等语义、后端权限/Scope/Personal DENY、Query keys、受保护文件读取和财务合同继续是唯一真值。本 Change 不改 Contract、Domain、API、Migration、Schema、依赖或生产配置。

## Security and Privacy Impact

每名 ACTIVE Staff 仍恰有一个 ACTIVE 四角色；登录不选择角色。页面只按后端 Session 投影显示导航，所有读取和写入仍由后端重新计算权限、Personal DENY、负责人权限包、客户/组织/店铺/资源 Scope，并保持越权资源 404、401 清缓存、受控短文件读取和敏感字段最小投影。买家返款不得看到或调用获客登记；非 owner 或缺少 `FINANCIAL_VIEW` 的 Staff 不得看到经营看板及内部利润。

## Risk and Rollback

风险包括高密度布局造成窄屏溢出、固定导航遮挡焦点、压缩标题时误删安全恢复说明、权限投影与导航不一致、列表/详情 DOM 顺序漂移、状态/金额语义被视觉合并、路由分包耦合，以及截图 Fixture 偏离真实合同。回滚仅撤回本 Change 的 Staff 前端展示、Staff 专用测试和证据；无 Migration，不回滚或修改任何业务、财务、权限、审计、文件、归档、备份或外部事实。
