# Stage 7F 父 Change 本地收口验收证据

## 验收结论

- 验证日期：2026-08-31；本次修复固定起点为 branch `feature/staging-workflow-rate-ux`、HEAD `1a1148a4e0f1c54ef3a39074c246fe6842c6b776`；起点工作树干净，`HEAD...@{upstream}` 为 `85 0`。本次证据生成与门禁均在该源码 HEAD 上完成，文档及代码随后纳入一个原子本地提交。
- `6.2`：**已勾选**。专用本地 evidence spec 真实生成并逐张人工复核“员工端 17 项 + 评审恢复 4 项”共 21 张 PNG；证据、manifest、截图前严格断言和退出码见 `openspec/changes/stage7f-visual-evidence-fixture-repair/evidence.md`。
- `7.3`：**已勾选，仅表示父级记账完成**。子 Change `stage7f4-legacy-css-retirement` 当前 `isComplete=true`、13/13 tasks 完成；其 CSS 实现自子 Change 收口后无漂移，当前 CSS/source/static guards 仍通过。子 Change **未归档**，不把未归档写成未完成。
- 本文记录父 Change 的验收证据与 7.3 记账；本次仅纳入视觉证据 fixture/harness、Seller 首页现有 DTO schema 对齐、一个 Dashboard 专属 44px 规则及文档，未修改后端业务、API、权限、数据库、子 Change 或远程资源。

## 21 项视觉证据逐项状态

父 task 只给出“员工端 17 项 + 评审恢复 4 项”的数量，没有附带独立的 item/route manifest。以下 17 行按 parent 4.1–4.8 与当前可追溯 route/state 形成审计清单；它们用于明确证据边界，不替代缺失的权威矩阵。

状态含义：`PASS` = 当前 HEAD 新生成、断言与人工查看均合格；`MISSING` = 没有可追溯合格截图；`BLOCKED` = 有 fixture/加载/错误态缺口；`NOT_ACCEPTED` = 页面断言或人工查看有结果，但没有满足本项要求的落盘截图集。

| # | 目标视觉项 | 状态 | 当前证据 / 缺口 |
|---:|---|---|---|
| 1 | 员工工作台桌面正常态 | PASS | `tmp/stage7f-visual-evidence-repair/staff-workbench-owner-1440x900.png`；关键待办、概览和订单可见，人工查看通过。 |
| 2 | 员工工作台 390px 正常态 | PASS | `tmp/stage7f-visual-evidence-repair/staff-workbench-owner-390x844.png`；移动卡片、底部导航和待办可见，人工查看通过。 |
| 3 | 员工工作台 390px Drawer | PASS | `tmp/stage7f-visual-evidence-repair/staff-workbench-owner-drawer-390x844.png`；真实导航 Drawer、遮罩和 Owner 菜单可见，人工查看通过。 |
| 4 | 员工订单列表 1440px | PASS | `tmp/stage7f-visual-evidence-repair/staff-orders-owner-1440x900.png`；5 条正常订单、筛选工具栏和分页可见，人工查看通过。 |
| 5 | 员工订单列表 1280px | PASS | `tmp/stage7f-visual-evidence-repair/staff-orders-owner-1280x900.png`；紧凑表格和工具栏无溢出，人工查看通过。 |
| 6 | 员工订单列表 390px 卡片 | PASS | `tmp/stage7f-visual-evidence-repair/staff-orders-owner-390x844.png`；移动卡片和底部导航可见，人工查看通过。 |
| 7 | 员工订单列表 390px 筛选 Drawer | PASS | `tmp/stage7f-visual-evidence-repair/staff-orders-owner-filter-drawer-390x844.png`；真实筛选 Drawer 字段与操作可见，人工查看通过。 |
| 8 | 员工订单详情 1440px | PASS | `tmp/stage7f-visual-evidence-repair/staff-order-detail-owner-1440x900.png`；身份、阶段、凭证/沟通、计价区和真实解码图片可见，人工查看通过。 |
| 9 | 员工订单详情 390px | PASS | `tmp/stage7f-visual-evidence-repair/staff-order-detail-owner-390x844.png`；移动详情、凭证区和底部导航可见，人工查看通过。 |
| 10 | 买家客户页面 | PASS | `tmp/stage7f-visual-evidence-repair/staff-buyer-customers-owner-1440x900.png`；历史客户查询返回 Demo 数据，人工查看通过。 |
| 11 | 卖家客户页面 | PASS | `tmp/stage7f-visual-evidence-repair/staff-seller-customers-owner-1440x900.png`；卖家组织和客户列表可见，人工查看通过。 |
| 12 | 产品与预约列表 | PASS | `tmp/stage7f-visual-evidence-repair/staff-products-owner-1440x900.png`；员工产品库、店铺和状态可见，人工查看通过。 |
| 13 | 预约排期 | PASS | `tmp/stage7f-visual-evidence-repair/staff-reservation-schedule-owner-1440x900.png`；预约排名与预计下单日期表可见，人工查看通过。 |
| 14 | 买家返款页面 | PASS | `tmp/stage7f-visual-evidence-repair/staff-buyer-refunds-owner-1440x900.png`；返款记录、金额、截止和状态可见，人工查看通过。 |
| 15 | 财务工作区桌面正常态 | PASS | `tmp/stage7f-visual-evidence-repair/staff-finance-owner-1440x900.png`；结算摘要、应付、付款进度和批次可见，人工查看通过。 |
| 16 | 财务工作区 390px 正常态 | PASS | `tmp/stage7f-visual-evidence-repair/staff-finance-owner-390x844.png`；移动财务分区和批次列表无横向溢出，人工查看通过。 |
| 17 | 员工与权限 + 系统设置/Owner-only 页面 | PASS | `tmp/stage7f-visual-evidence-repair/staff-service-channels-owner-1440x900.png`；客服两渠道正常呈现；同一专用 run 另严格核对经营看板和权限三分区。 |
| 18 | `/review` 评审入口恢复 | PASS | `tmp/stage7f-visual-evidence-repair/review-entry-1440x900.png`；三端入口卡片和 Demo 标识可见，人工查看通过。 |
| 19 | `/review/buyer` 买家评审恢复 | PASS | `tmp/stage7f-visual-evidence-repair/review-buyer-recovery-1440x900.png`；订单、预约产品和账户摘要可见，人工查看通过。 |
| 20 | `/review/seller` 卖家评审恢复 | PASS | `tmp/stage7f-visual-evidence-repair/review-seller-recovery-1440x900.png`；建议处理、组织成员、店铺与产品可见，人工查看通过。 |
| 21 | `/review/staff` 员工评审恢复 | PASS | `tmp/stage7f-visual-evidence-repair/review-staff-recovery-1440x900.png`；建议先处理、待办、关注和最近订单可见，人工查看通过。 |

### 历史阻塞与当前收口

- 固定起点旧 `staff-visual-refresh.spec.ts` 为 3 failed / 1 passed，退出码 1；失败根因是隐藏 Drawer selector、旧角色标签和旧 Dashboard fixture。修复后同一聚焦组合与 Review 组合为 19/19 passed。
- 旧 contacts/settlement 截图中的加载/读取失败只代表修复前历史证据，不再作为当前 6.2 结论；当前专用证据 run 和聚焦组合均无 forbidden state。
- 旧 `/review/seller` 成员加载告警来自 Seller 首页严格 schema 漏掉现有 `wechat_id` 字段；已按 backend member DTO 对齐前端读取 schema，当前恢复截图正常。

## 当前验证退出码

| 命令 / harness | 结果 |
|---|---|
| `npm run verify:openspec:strict` | 0，76/76 |
| `npm run verify:css-ownership` | 0 |
| `npm run verify:css-duplicates` | 0 |
| `npm run security:scan` | 0 |
| `npm run verify:web-source-boundaries` | 0 |
| `npm run verify:web-static-build` | 0 |
| `npm run verify:api-contract` | 0，241 endpoints / 239 `/api/*` |
| `npm run typecheck` | 0 |
| `npm test` | 0，264 files / 1870 tests |
| `npm run build` | 0；仅本地 Wrangler `--dry-run`，无部署 |
| `PLAYWRIGHT_PORT=4179 npm run test:browser -- stage7f-visual-evidence-repair.spec.ts` | 0，1 passed；17 Staff + 4 Review，21 PNG |
| `PLAYWRIGHT_PORT=4180 npm run test:browser -- staff-visual-refresh.spec.ts stage75-contacts.spec.ts stage75-settlement-batches.spec.ts review-mode.spec.ts` | 0，19 passed |
| `npm run check` | 0；综合静态/安全/依赖/迁移/容量/测试/构建门禁通过 |
| `git diff --check` | 0 |

`npm run check` 在本次源码与 fixture 收口内容上完整跑到最后，直接退出码为 0；其 staging/production preflight 均为 `BLOCKED_NEEDS_OPERATOR_INPUT`，external calls/deployments/resource mutations 均为 0。

## 环境边界

- LOCAL：以上源码、构建、Vitest、Playwright、截图人工查看、OpenSpec 与 guards 均为本地证据。
- STAGING：未部署、未访问，没有 staging 验收结论。
- REMOTE CI：未访问，不能把本地结果写成 Remote CI 结果。
- PRODUCTION：未访问、未变更；Production 保持 NO-GO。
- Cloudflare/D1/R2/Queues、Google Drive、Feishu、GitHub remote：均未触碰；本地 preflight 的 staging/production 仅为 `BLOCKED_NEEDS_OPERATOR_INPUT`，external calls/deployments/resource mutations 均为 0。

## 下一步与边界

本地 6.2/6.2c 证据已收口；下一步仅等待总审决定，不能将本地证据外推为 STAGING、REMOTE CI 或 PRODUCTION 验收。营销官网、阶段 8、远程部署、push、OpenSpec sync/archive 均未执行。
