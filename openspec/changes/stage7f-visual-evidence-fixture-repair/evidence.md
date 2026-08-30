# stage7f-visual-evidence-fixture-repair 本地证据

## 结论

- 验证日期：2026-08-31。
- 固定起点：branch `feature/staging-workflow-rate-ux`、HEAD `1a1148a4e0f1c54ef3a39074c246fe6842c6b776`；起始工作树干净，`HEAD...@{upstream}` 为 `85 0`。
- 变更范围保持在视觉证据 fixture/harness、Seller 首页现有成员 DTO 的前端 schema 对齐、一个 Dashboard 专属 44px 控件规则，以及本 Change/父级收口文档；未修改 `apps/api`、`packages/contracts`、`migrations` 或业务/API/权限/数据库契约。
- 21 项主证据由真实本地 Review runtime 渲染：17 个 Staff 视图 + `/review`、`/review/buyer`、`/review/seller`、`/review/staff` 四个恢复视图。专用 Playwright 证据测试为 `1 passed`，退出码 `0`。
- 本地原子提交的 SHA 在最终交付报告中记录；提交后不再追加第二个内容提交。

## 21 项截图清单与人工复核

截图目录：`/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller/tmp/stage7f-visual-evidence-repair/`。

每一项均满足：截图前可见关键正常数据；无错误 Alert、加载中、服务不可用或 `MALFORMED_RESPONSE`；页面图片真实解码；无横向溢出；无已退役导航。以下每行均为真实 PNG，文件尺寸由 `file` 直接核对，人工查看结果均为 `PASS`。

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

专用测试另外语义核对了 `/review/staff/admin-business-dashboard` 的 `客户与订单`、`¥8,965.20` 和 `/review/staff/access-management` 的三个负责人区块；这两项作为第 17 项 Owner-only 设置范围的补充正常态检查，不增加主清单数量。

## 浏览器与聚焦回归

| 命令 | 结果 |
|---|---|
| `PLAYWRIGHT_PORT=4179 npm run test:browser -- stage7f-visual-evidence-repair.spec.ts` | 0；1 passed，21 张截图生成，`apiRequests=[]`、`pageErrors=[]` |
| `PLAYWRIGHT_PORT=4180 npm run test:browser -- staff-visual-refresh.spec.ts stage75-contacts.spec.ts stage75-settlement-batches.spec.ts review-mode.spec.ts` | 0；19 passed |
| `npm run build` | 0；Web Vite build 与本地 Wrangler `--dry-run` 均完成，无部署 |

执行中曾发现并修正两个非业务问题：图片懒加载 helper 的异步计数错误、买家客户页多个“微信号”标签的定位歧义；另修正了安全扫描器识别的 Demo token 字面量写法。卖家恢复页暴露的真实问题是首页严格 schema 漏掉后端已有的 nullable `wechat_id` 字段，已按现有 `/api/seller-portal/members` 响应对齐；没有改变接口响应。

## 本地门禁

最终 `npm run check` 在当前变更内容上直接退出 `0`，包含以下结果：

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 |
| `npm test` | 0；264 files / 1870 tests |
| `npm run build` | 0；本地 Wrangler `--dry-run`，无部署 |
| `npm run check` | 0；静态、安全、依赖、迁移、容量、测试、构建、静态产物全部通过 |
| `npm run security:scan` | 0 |
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
- 未触碰 Cloudflare 远端资源、D1/R2、Google Drive、Feishu、GitHub remote；未 push、未 deploy、未 sync、未 archive Change。
