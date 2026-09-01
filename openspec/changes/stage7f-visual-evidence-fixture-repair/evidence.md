# stage7f-visual-evidence-fixture-repair 本地证据

## 结论

- 验证日期：2026-08-31。
- 固定起点：branch `feature/staging-workflow-rate-ux`、HEAD `6602e71a4e3e43235368adbcde5a0aff5621d2cb`；起始工作树干净，`HEAD...@{upstream}` 为 `86 0`。
- 本轮新增范围仅为当前视觉证据回归：图片解码后截图前复位页面滚动、产品列表 `查看详情` 的可读对比度、客服渠道 8 个可编辑输入复用 Staff 输入 primitive；没有修改 `apps/api`、`packages/contracts`、`migrations` 或业务/API/权限/数据库契约。
- 专用 Playwright 最终 run 退出码 `0`、`4 passed`：21 项主证据（17 个 Staff 视图 + `/review`、`/review/buyer`、`/review/seller`、`/review/staff` 四个恢复视图）及 3 项回归断言；21 张主 PNG 均由真实本地 Review runtime 生成并逐张人工查看为 `PASS`。
- 本地原子提交的 SHA 在最终交付报告中记录；提交后不再追加第二个内容提交。

## 本轮修复与回归证据

- `capture()` 在图片真实解码后将 `window` 与 `document.scrollingElement` 复位到顶部，并轮询确认 `scrollX=0, scrollY=0`，避免长页面截图把固定顶部/侧栏/底部栏捕获在页面中段。
- 产品列表仅在 `.staff-app` 范围内恢复 `a.button-link` 的 inverse 文本色，保留现有按钮 primitive 与页面结构；回归断言以浏览器计算样式和 WCAG 对比度 `>= 4.5` 检查。
- `ServiceChannelsPage` 的 4 个可见表单字段改用既有 `TextInput` primitive；文件上传隐藏 input 保持原生实现。回归断言确认 8 个可编辑输入可见、有边框、白色背景且高度 `>= 40px`。
- 修复前新增回归断言直接复现 3 个问题：订单详情截图滚动偏移 `664`、产品按钮前景/背景均为 `rgb(11,87,208)`、客服输入高度 `23.25px < 40px`；修复后同一 grep run 为 `3 passed`、退出码 `0`。

## 21 项截图清单与人工复核

截图目录：`/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f-visual-evidence-repair-20260831-final/`。

每一项均满足：截图前可见关键正常数据；无错误 Alert、加载中、服务不可用或 `MALFORMED_RESPONSE`；页面图片真实解码；无横向溢出；无已退役导航。21 个 PNG 由 `file` 直接核对，人工查看结果均为 `PASS`。

| # | 视图 | 文件 | 人工复核 |
|---:|---|---|---|
| 1 | Staff 工作台桌面 | `staff-workbench-owner-1440x900.png` | PASS |
| 2 | Staff 工作台 390px | `staff-workbench-owner-390x844.png` | PASS |
| 3 | Staff 工作台真实导航 Drawer 390px | `staff-workbench-owner-drawer-390x844.png` | PASS |
| 4 | Staff 订单列表 1440px | `staff-orders-owner-1440x900.png` | PASS |
| 5 | Staff 订单列表 1280px | `staff-orders-owner-1280x900.png` | PASS |
| 6 | Staff 订单卡片 390px | `staff-orders-owner-390x844.png` | PASS |
| 7 | Staff 订单筛选真实 Drawer 390px | `staff-orders-owner-filter-drawer-390x844.png` | PASS |
| 8 | Staff 订单详情 1440px | `staff-order-detail-owner-1440x900.png` | PASS |
| 9 | Staff 订单详情 390px | `staff-order-detail-owner-390x844.png` | PASS |
| 10 | Staff 买家客户 | `staff-buyer-customers-owner-1440x900.png` | PASS |
| 11 | Staff 卖家客户 | `staff-seller-customers-owner-1440x900.png` | PASS |
| 12 | Staff 产品与预约列表 | `staff-products-owner-1440x900.png` | PASS |
| 13 | Staff 预约排期 | `staff-reservation-schedule-owner-1440x900.png` | PASS |
| 14 | Staff 买家返款 | `staff-buyer-refunds-owner-1440x900.png` | PASS |
| 15 | Staff 财务桌面 | `staff-finance-owner-1440x900.png` | PASS |
| 16 | Staff 财务 390px | `staff-finance-owner-390x844.png` | PASS |
| 17 | Staff 客服渠道/Owner 设置 | `staff-service-channels-owner-1440x900.png` | PASS |
| 18 | `/review` 入口 | `review-entry-1440x900.png` | PASS |
| 19 | `/review/buyer` 恢复 | `review-buyer-recovery-1440x900.png` | PASS |
| 20 | `/review/seller` 恢复 | `review-seller-recovery-1440x900.png` | PASS |
| 21 | `/review/staff` 恢复 | `review-staff-recovery-1440x900.png` | PASS |

专用 run 另外语义核对了 `/review/staff/admin-business-dashboard` 的 `客户与订单`、`¥8,965.20` 和 `/review/staff/access-management` 的三个负责人区块；这两项作为第 17 项 Owner-only 设置范围的补充正常态检查，不增加主清单数量。另有独立回归截图：`tmp/stage7f-visual-regressions-20260831-final/regression-order-detail-scroll.png`。

## 浏览器与聚焦回归

| 命令 | 结果 |
|---|---|
| `PLAYWRIGHT_PORT=4279 STAGE7F_VISUAL_EVIDENCE_DIR=tmp/stage7f-baseline-20260831 npm run test:browser -- stage7f-visual-evidence-repair.spec.ts` | 0；修复前旧 harness 1 passed，但未覆盖以下 3 个精确缺陷 |
| `CI=1 PLAYWRIGHT_PORT=4290 STAGE7F_VISUAL_EVIDENCE_DIR=tmp/stage7f-regression-baseline-20260831 npm run test:browser -- stage7f-visual-evidence-repair.spec.ts --grep '回归'` | 1；新增的 3 项回归断言按预期全部暴露旧问题 |
| `CI=1 PLAYWRIGHT_PORT=4292 STAGE7F_VISUAL_EVIDENCE_DIR=tmp/stage7f-regression-fixed-20260831 npm run test:browser -- stage7f-visual-evidence-repair.spec.ts --grep '回归'` | 0；3 passed |
| `CI=1 PLAYWRIGHT_PORT=4293 STAGE7F_VISUAL_EVIDENCE_DIR=tmp/stage7f-visual-evidence-repair-20260831-final STAGE7F_REGRESSION_DIR=tmp/stage7f-visual-regressions-20260831-final npm run test:browser -- stage7f-visual-evidence-repair.spec.ts` | 0；4 passed，21 张主截图及回归截图生成，`apiRequests=[]`、`pageErrors=[]` |
| `CI=1 PLAYWRIGHT_PORT=4294 STAGE75_CONTACTS_SCREENSHOT_DIR=tmp/stage75-contacts-fixed-20260831 STAGE75_BATCHES_SCREENSHOT_DIR=tmp/stage75-batches-fixed-20260831 npm run test:browser -- staff-visual-refresh.spec.ts stage75-contacts.spec.ts stage75-settlement-batches.spec.ts review-mode.spec.ts` | 0；19 passed |
| `npm run build` | 0；Web Vite build 与本地 Wrangler `--dry-run` 均完成，无部署 |

旧 harness 的 baseline 虽然通过，是因为它没有断言这三个具体视觉回归；因此本轮先保留 baseline 直接结果，再用失败断言证明修复前缺口，最后用同一断言证明修复后通过。

## 本地门禁

最终 `npm run check` 在文档更新后的最终内容上完整退出 `0`；随后未再修改运行时代码。已完成的直接门禁如下：

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 |
| `npm test` | 0；264 files / 1870 tests |
| `npm run build` | 0；本地 Wrangler `--dry-run`，无部署 |
| `npm run security:scan` | 0；1855 个项目文件 |
| `npm run audit:dependencies` | 0；high/critical 均为 0 |
| `npm run verify:css-ownership` | 0 |
| `npm run verify:css-duplicates` | 0 |
| `npm run verify:web-source-boundaries` | 0；14 rules / 0 violations / 0 external calls |
| `npm run verify:web-static-build` | 0；52 files / 0 source maps / 0 external calls |
| `npm run verify:api-contract` | 0；241 endpoints / 239 `/api/*` |
| `npm run verify:openspec:strict` | 0；76/76 |
| `git diff --check` | 0 |

综合 check 的 staging 与 production Cloudflare preflight 均只返回 `BLOCKED_NEEDS_OPERATOR_INPUT`；两者 `external_calls=0`、`deployments=0`、`resource_mutations=0`。这不是 staging、Remote CI 或 production 验收证据。

## 环境边界

- `LOCAL`：以上源码、构建、Vitest、Playwright、PNG 尺寸和人工查看、OpenSpec、静态/API/安全门禁均为本地证据。
- `STAGING`：未部署、未访问；无 staging 验收结论。
- `REMOTE CI`：未访问；不把本地结果写成 Remote CI 结果。
- `PRODUCTION`：未访问、未变更；Production 保持 `NO-GO`。
- 未触碰 Cloudflare 远端资源、D1/R2/Queues、Google Drive、Feishu、GitHub remote；未 push、未 deploy、未 sync、未 archive Change。
