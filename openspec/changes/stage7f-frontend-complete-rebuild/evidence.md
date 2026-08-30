# Stage 7F 父 Change 本地收口验收证据

## 验收结论

- 验证日期：2026-08-31；验证起止均为 branch `feature/staging-workflow-rate-ux`、HEAD `369e730177b71c2dce7ff803cefcfad1600fe602`；起止工作树均干净，`HEAD...origin/feature/staging-workflow-rate-ux` 为 `84 0`。
- `6.2`：**未勾选**。当前没有满足“员工端 17 项 + 评审恢复 4 项”完整映射的合格截图集；部分截图仍是加载中或错误态，且旧 Staff 全矩阵 harness 仍有 fixture 阻塞。
- `7.3`：**已勾选，仅表示父级记账完成**。子 Change `stage7f4-legacy-css-retirement` 当前 `isComplete=true`、13/13 tasks 完成；其 CSS 实现自子 Change 收口后无漂移，当前 CSS/source/static guards 仍通过。子 Change **未归档**，不把未归档写成未完成。
- 本文只记录父 Change 的验收证据与 7.3 记账；没有修改业务代码、CSS 实现、子 Change 或远程资源。

## 21 项视觉证据逐项状态

父 task 只给出“员工端 17 项 + 评审恢复 4 项”的数量，没有附带独立的 item/route manifest。以下 17 行按 parent 4.1–4.8 与当前可追溯 route/state 形成审计清单；它们用于明确证据边界，不替代缺失的权威矩阵。

状态含义：`PASS` = 当前 HEAD 新生成、断言与人工查看均合格；`MISSING` = 没有可追溯合格截图；`BLOCKED` = 有 fixture/加载/错误态缺口；`NOT_ACCEPTED` = 页面断言或人工查看有结果，但没有满足本项要求的落盘截图集。

| # | 目标视觉项 | 状态 | 当前证据 / 缺口 |
|---:|---|---|---|
| 1 | 员工工作台桌面正常态 | PASS | `/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f1-staff-visual-correction/staff-workbench-owner-1440x900.png`；当前 HEAD `stage7f1-staff-visual-correction.spec.ts` 通过。 |
| 2 | 员工工作台 390px 正常态 | PASS | `/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f1-staff-visual-correction/staff-workbench-owner-390x844.png`；人工查看有正常待办数据、无错误 Alert、无横向溢出。 |
| 3 | 员工工作台 390px Drawer | PASS | `/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f1-staff-visual-correction/staff-workbench-owner-drawer-390x844.png`；人工查看 Drawer、角色/导航与遮罩正常。 |
| 4 | 员工订单列表 1440px | PASS | `/tmp/stage7-parent-20260831-order-list/staff-order-list-1440x900.png`；当前 HEAD `stage75-order-list.spec.ts` 通过，3 条正常订单数据可见。 |
| 5 | 员工订单列表 1280px | PASS | `/tmp/stage7-parent-20260831-order-list/staff-order-list-1280x900.png`；人工查看工具栏、紧凑表格和分页无溢出。 |
| 6 | 员工订单列表 390px 卡片 | PASS | `/tmp/stage7-parent-20260831-order-list/staff-order-list-390x844.png`；人工查看搜索、卡片、底部导航与分页正常。 |
| 7 | 员工订单列表 390px 筛选 Drawer | PASS | `/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f2-staff-core-pages-visual/staff-orders-owner-filter-drawer-390x844.png`；字段与清除/应用操作可见，无错误态。 |
| 8 | 员工订单详情 1440px | PASS | `/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f2-staff-core-pages-visual/staff-order-detail-owner-1440x900.png`、`/tmp/stage7-parent-20260831-three-portals/staff-order-detail-1440x900.png`；正常身份、阶段、凭证/沟通区可见，图片由 harness 断言可解码。 |
| 9 | 员工订单详情 390px | PASS | `/tmp/stage7-parent-20260831-order-list/staff-order-responsibility-390x844.png`；责任人/下一步/阶段/凭证区与移动导航可见，无横向溢出。 |
| 10 | 买家客户页面（桌面/移动） | MISSING | 当前没有合格落盘截图；`staff-visual-refresh.spec.ts` 的后置 focus/zoom 检查不构成页面视觉证据。 |
| 11 | 卖家客户页面（桌面/移动） | MISSING | 当前没有合格落盘截图；没有以静态源码或仅路由断言替代人工视觉验收。 |
| 12 | 产品与预约列表（桌面/移动） | BLOCKED | 当前没有合格落盘截图；旧 Staff harness 在产品页前因隐藏 Drawer 的 `.first()` selector fixture 失败。 |
| 13 | 产品详情与预约排期（桌面/移动） | BLOCKED | `staff-product-reservation-scheduling.spec.ts` 的 3 个断言通过，但没有截图；旧全矩阵无法完成产品/排期视觉循环，不能把断言通过当视觉通过。 |
| 14 | 买家返款页面（桌面/移动） | MISSING | 当前没有合格落盘截图；没有把 buyer_refund 的权限断言替代视觉证据。 |
| 15 | 财务工作区桌面正常态 | PASS | `/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f2-staff-core-pages-visual/staff-finance-owner-1440x900.png`；正常摘要、应付明细与付款进度可见。 |
| 16 | 财务工作区 390px 正常态 | PASS | `/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f2-staff-core-pages-visual/staff-finance-owner-390x844.png`；人工查看正常数据与移动布局。结算批次独立截图仍见错误态，见下方阻塞。 |
| 17 | 员工与权限 + 系统设置/Owner-only 页面 | BLOCKED | 客服渠道三张当前截图均停在“正在加载页面内容…”；经营看板旧 fixture 触发“数据加载失败”；权限矩阵只有断言、没有完整视觉截图集。 |
| 18 | `/review` 评审入口恢复 | NOT_ACCEPTED | 当前浏览器人工查看为正常入口，`review-mode.spec.ts` 通过；现有 harness 没有将该入口截图落盘到可追溯证据路径。 |
| 19 | `/review/buyer` 买家评审恢复 | NOT_ACCEPTED | 当前浏览器人工查看有正常产品/订单数据，`review-mode.spec.ts` 通过；没有满足 4 张恢复证据要求的落盘截图。 |
| 20 | `/review/seller` 卖家评审恢复 | BLOCKED | 当前浏览器人工查看右侧组织成员区域出现“读取中…”与“成员列表暂时不可用。”；即使断言通过，也不满足无加载中/服务不可用。 |
| 21 | `/review/staff` 员工评审恢复 | NOT_ACCEPTED | 当前浏览器人工查看为正常 Demo 待办/订单数据，`review-mode.spec.ts` 通过；没有与其余 3 项组成的合格 4 张落盘恢复截图集。 |

### 不能据此勾选 6.2 的直接证据

- `staff-visual-refresh.spec.ts` 当前 HEAD：3 failed / 1 passed，退出码 1。失败分别为隐藏 Drawer 命中 `.first()`、旧角色标签仍断言“买家/卖家”、经营看板仍使用旧 funnel fixture 并进入数据加载失败。
- `/tmp/stage7-parent-20260831-contacts/` 的客服渠道截图人工查看均为“正在加载页面内容…”，不能计入正常态。
- `/tmp/stage7-parent-20260831-batches/` 的三张结算批次截图人工查看含“申请事实读取失败/当前面板加载失败”，不能计入正常态。
- `/tmp/stage7-parent-20260831-workbench/` 是冲突/失败恢复流截图，含“图片读取凭证已失效，请重新读取”，只能作为错误恢复证据，不能冒充关键正常数据的 6.2 截图。
- `stage75-contacts.spec.ts` 7/7、`stage75-settlement-batches.spec.ts` 3/3、`staff-workbench.spec.ts` 6/6 的断言通过，不覆盖上述人工视觉缺口。

## 当前验证退出码

| 命令 / harness | 结果 |
|---|---|
| `openspec validate stage7f-frontend-complete-rebuild --strict` | 0 |
| `openspec validate stage7f4-legacy-css-retirement --strict` | 0 |
| `openspec validate --all --strict` | 0，75/75 |
| `npm run verify:css-ownership` | 0 |
| `npm run verify:css-duplicates` | 0 |
| `npm run verify:web-source-boundaries` | 0 |
| `npm run verify:web-static-build` | 0 |
| `npm run verify:api-contract` | 0，241 endpoints / 239 `/api/*` |
| `npm run build` | 0；仅本地 Wrangler `--dry-run`，无部署 |
| `npm run test:browser -- review-mode.spec.ts stage7-three-portals.spec.ts stage7-three-portals-screenshots.spec.ts` | 0，34 passed |
| `npm run test:browser -- stage7f1-staff-visual-correction.spec.ts stage7f2-staff-core-pages-visual.spec.ts` | 0，2 passed |
| `npm run test:browser -- stage7a1-screenshots.spec.ts stage7f1-staff-navigation-visual-correction.spec.ts stage7f1-staff-drawer-focus-correction.spec.ts` | 0，7 passed |
| `npm run test:browser -- stage75-order-list.spec.ts` | 0，7 passed |
| `npm run test:browser -- stage75-contacts.spec.ts` | 0，7 passed；截图人工不合格 |
| `npm run test:browser -- stage75-settlement-batches.spec.ts` | 0，3 passed；截图人工不合格 |
| `npm run test:browser -- staff-workbench.spec.ts` | 0，6 passed；截图为失败恢复流 |
| `npm run test:browser -- staff-product-reservation-scheduling.spec.ts` | 0，3 passed；无截图 |
| `npm run test:browser -- staff-visual-refresh.spec.ts` | 1，3 failed / 1 passed |
| `npm test`（`npm run check` 内，当前 HEAD） | 264 files / 1870 tests passed |
| `git diff --check` | 0 |

`npm run check` 在本次文档收口工作树已完整跑到最后的静态产物检查，直接退出码为 0；其间没有业务代码或 CSS 实现变更。

## 环境边界

- LOCAL：以上源码、构建、Vitest、Playwright、截图人工查看、OpenSpec 与 guards 均为本地证据。
- STAGING：未部署、未访问，没有 staging 验收结论。
- REMOTE CI：未访问，不能把本地结果写成 Remote CI 结果。
- PRODUCTION：未访问、未变更；Production 保持 NO-GO。
- Cloudflare/D1/R2/Queues、Google Drive、Feishu、GitHub remote：均未触碰；本地 preflight 的 staging/production 仅为 `BLOCKED_NEEDS_OPERATOR_INPUT`，external calls/deployments/resource mutations 均为 0。

## 下一独立修复范围

1. 修复或替换 `staff-visual-refresh.spec.ts` 的隐藏 Drawer、角色标签和经营看板 fixture，使 17 项页面矩阵可逐页截图；不在本父 Change 验收中修改。
2. 修复客服渠道/结算批次 Demo fixture 的等待与读取失败问题，并重新生成、人工查看完整截图。
3. 为 `/review`、`/review/buyer`、`/review/seller`、`/review/staff` 生成可追溯落盘截图；卖家组织成员区必须不再处于加载/不可用状态。
4. 只有上述独立修复完成且 21 项全部满足截图前断言后，才重新审计并决定是否勾选 6.2。
