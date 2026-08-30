# Stage 7F-4 本地 CSS ownership 证据

## 证据边界

- 验证日期：2026-08-30；工作目录：`/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller`。
- 预期起点已核对：branch `feature/staging-workflow-rate-ux`，HEAD `a364623ff111974286d1b71ebda92e3d37eb84f4`。
- 本 Change 只涉及 Web CSS 归属、CSS source guard、OpenSpec 与检查链；未修改 API、数据库、schema/envelope、权限、路由业务、Stage 8、部署或生产资源。
- 没有访问远程 CI、Cloudflare、D1/R2/Queues、Google Drive 或生产资源；Production 仍为 NO-GO。

## 起点 CSS 盘点

起点有 11 个 CSS 文件，`main.tsx` 的实际 import 顺序为：

`tokens.css → global.css → design-freeze.css → staff-shell-v2.css → buyer-portal.css → seller-portal.css → base.css → primitives.css → staff-shell.css → staff-pages.css → staff-icons.css`

起点文件规模（`wc -l -c`）如下：

| 文件 | 行数 | 字节 |
| --- | ---: | ---: |
| `base.css` | 114 | 2525 |
| `buyer-portal.css` | 1178 | 22955 |
| `design-freeze.css` | 1277 | 43744 |
| `global.css` | 4578 | 89044 |
| `primitives.css` | 337 | 7495 |
| `seller-portal.css` | 1134 | 22675 |
| `staff-icons.css` | 52 | 1286 |
| `staff-pages.css` | 1992 | 42531 |
| `staff-shell-v2.css` | 141 | 3107 |
| `staff-shell.css` | 554 | 10676 |
| `tokens.css` | 249 | 8453 |

直接 AST 级盘点得到：`global.css` 有 95 个同上下文同声明重复规则，`design-freeze.css` 有 194 个；`design-freeze.css` 第 1–574 行（19,902 字节）是后续块的精确子集，第二块包含全部第一块规则并额外包含 38 个规则。已有 256 行大块重复检查在起点虽通过，但不能证明这些较短的级联重复没有覆盖风险。

`staff-shell-v2.css` 中的 `.staff-topbar-search` 及 `staff-fade-in`、`staff-slide-in` 没有生产组件消费者；当前搜索由 `staff-shell.css` 的 `.sa-topbar__search .staff-global-search` 提供。仍有消费者的 `.staff-group-heading`、`.staff-order-evidence-grid`、`.staff-ref-section`/`dt`/`dd` 与 `.staff-ref-danger` 已逐项迁移到 `staff-pages.css` 的 `.staff-app` 作用域。

生产源码扫描覆盖 `apps/web/src` 下 175 个非测试 TypeScript 文件。动态 class 不按普通文本搜索删除：保留 `identity-*`、`alert-*`、`toast-*`、`status-*`、`buyer-task-*` 五个来源可定位的族，并保留其全部当前枚举值。Material Symbols Rounded 仍来自本地 SVG，24 个图标基础名均有 outline/filled 双文件。

## 保留 / 迁移 / 删除决策

| 历史资产 | 决策 | 证据与结果 |
| --- | --- | --- |
| `global.css` | 删除入口文件；有效规则迁入 `portal-compat.css` | 兼容层保留源码可证明仍有消费者的买家/卖家及旧页面规则；100 个源码无消费者的旧 selector 分支删除；旧 `--mw-*` 根变量删除，公共 token 继续由 `tokens.css` 持有。 |
| `design-freeze.css` | 删除入口文件；后续有效块迁入 `portal-compat.css` | 精确重复的前 574 行不再复制；后续块的当前消费者、元素默认、焦点、响应式与冻结视觉规则保留。 |
| `staff-shell-v2.css` | 删除入口文件；必要订单详情规则迁入 `staff-pages.css` | 未使用的 `.staff-topbar-search` 与两个未使用 keyframe 删除；订单凭证/参考面板规则保留并改为 `.staff-app` + 当前页面作用域。 |
| 新 `portal-compat.css` | 单一兼容归属边界 | 只保留当前消费者、动态族或元素级兼容规则；不作为新 Staff Shell 的权威层。 |

## 完成后的 CSS 关系

`main.tsx` 的实际 import 顺序变为：

`tokens.css → portal-compat.css → buyer-portal.css → seller-portal.css → base.css → primitives.css → staff-shell.css → staff-pages.css → staff-icons.css`

当前维护的 9 个 CSS 文件中，`portal-compat.css` 有 269 个 class selector token；源码守卫检查 1,410 个规则 key，未发现同上下文同声明重复。`portal-compat.css` 不含 `--mw-*`、三个 retired 文件名或 100 个退役 selector token；`staff-pages.css` 明确拥有 `staff-order-evidence-grid`、`staff-ref-section`、`staff-ref-danger`。旧 256 行重复块检查对 9 个文件全部通过。

动态与基础样式的保留由 `scripts/verify-css-ownership.mjs` 约束，不能仅凭静态 `rg` 结果删除动态 class。该 guard 也锁定本地 Material Symbols Rounded outline/filled twin、adapter glob 与 no-Lucene 约束，并已接入 `npm run check` 的静态检查链。

## 本地视觉证据

先用起始工作树同一套 Playwright fixture 生成 baseline，再用最终工作树生成：

- baseline：`/tmp/stage7f4-baseline`
- final：`/tmp/stage7f4-final-20260830-r2`

三端现有截图 harness 直接退出码为 0，13/13 通过，并逐张检查了以下最终图片：

| 端 | 图片 | baseline 对比 |
| --- | --- | --- |
| Buyer | `buyer-home-1440x900.png`、`buyer-order-detail-1440x900.png`、`buyer-mobile-390x844.png`、`buyer-mobile-drawer-390x844.png` | 4 张像素完全一致 |
| Seller | `seller-home-1440x900.png`、`seller-orders-communication-screenshots-1440x900.png`、`seller-settlement-1440x900.png`、`seller-mobile-390x844.png`、`seller-mobile-drawer-390x844.png` | 4 张像素完全一致；首页头像圆边缘有稳定 21 个抗锯齿差异像素，差异框为 `[1392,23,1415,48]`，无布局差异 |
| Staff | `staff-workbench-1440x900.png`、`staff-order-detail-1440x900.png`、`staff-mobile-390x844.png`、`staff-mobile-drawer-390x844.png` | 4 张像素完全一致 |

对 Seller 首页差异额外读取了旧/新样式下头像及父级的 computed style 和几何：位置、尺寸、display、背景、文字、padding/margin、box-sizing、overflow、shadow、opacity、filter 均一致；差异仅为浏览器光栅化边缘，故不把它写成严格全图像素相等。

上述 13 张覆盖三端 desktop/mobile、主壳、代表性列表/详情、单张订单付款截图、Seller 沟通截图、Staff 订单详情与 Drawer。另有本地 UI focused run 覆盖 loading、empty、error/403/503、form/detail、keyboard focus、44px targets、200% reflow 与 reduced-motion：Buyer/Seller/foundation/Drawer 相关 61 个用例通过，1 个跳过。

Staff 旧 `staff-visual-refresh.spec.ts` 的 4 个扩展用例单独复跑仍为 3 失败、1 通过，退出码 1；失败不是 CSS 断言回归，具体是：

1. 产品页使用 `.first()` 命中了当前手机 Drawer 中隐藏的同名 `span`，而不是可见 `h1`。
2. 角色导航 fixture 仍断言 `买家`/`卖家`，当前源码和组件测试的正式标签是 `买家客户`/`卖家客户`。
3. Dashboard fixture 使用旧的 funnel 字段，当前组件契约要求 `cards.new_customers_buyer`、`pending`、`overdue`、`owner_summary`，因此页面实际进入“数据加载失败”。

这三个旧 harness 缺口均在 CSS Change 范围之外；没有用静态源码替代真实 UI 结论，也没有为本 Change 修改业务 fixture 或测试断言。

## 直接退出码记录

| 命令 | 结果 |
| --- | --- |
| `npm run verify:css-ownership` | PASS，退出码 0 |
| `npm run verify:css-duplicates` | PASS，退出码 0 |
| `npm run verify:web-source-boundaries` | PASS，退出码 0 |
| `npm run verify:web-static-build` | PASS，退出码 0 |
| `npm run verify:api-contract` | PASS，退出码 0 |
| `openspec validate stage7f4-legacy-css-retirement --strict` | PASS，退出码 0 |
| `npm run verify:openspec:strict` | 72 passed / 0 failed，退出码 0 |
| `npm test -- apps/web/src/buyer apps/web/src/seller apps/web/src/staff` | 42 files / 285 tests passed，退出码 0 |
| `npm run typecheck` | PASS，退出码 0 |
| `npm run build` | PASS，退出码 0；本地 Wrangler dry-run，无部署 |
| `npm test` | 264 files / 1852 tests passed，退出码 0 |
| 三端 13 张 screenshot harness | 13 passed，退出码 0 |
| 状态覆盖 focused browser batch | 61 passed / 1 skipped / 3 failed，退出码 1；失败为上述旧 Staff harness |

| `npm run check` | PASS，退出码 0；包含全量 OpenSpec、静态 guard、安全/依赖、schema/migration、本地 dry-run、容量检查、264 files/1852 tests 全量测试、build 与静态产物检查 |
| `git diff --check` | PASS，退出码 0 |

## 环境分界

- LOCAL：以上源码、构建、Vitest、Playwright、OpenSpec、guard 与本地 dry-run 证据全部属于本地工作树。
- STAGING：本 Change 没有部署或访问 staging，因此没有 staging GO 结论。
- REMOTE CI：未访问，不能把本地结果写成远程 CI 结果。
- PRODUCTION：未访问、未变更；Production 保持 NO-GO。
