# 前端重建阶段 7R 交接：三端缺陷修复与回归收口（ChatGPT 总审后）

日期：2026-08-29。分支 `feature/staging-workflow-rate-ux`，起点 `fb1f2e54`（阶段 7 完成点，schema 30 / 224 端点 / 阶段 7 五个本地提交全部保留）。本轮**一个**本地提交（未 push）：

```text
fix(web): close stage 7 portal contract and regression gaps
```

依据：用户阶段 7R 指令（2026-08-29）、ChatGPT 阶段 7 统一总审结论、OpenSpec Change `stage7-three-portal-remediation`（63/63 strict 校验通过后才开始改源码）。

> **声明**：本轮是本地缺陷修复与回归收口，**不是 Staging / Production GO**。未 push、未部署、未触碰任何远程资源、未进入阶段 8 与营销官网。零后端运行时改动（API 224 端点、schema 30、`packages/contracts` 未动）。

## 1. 卖家端运行时 schema 与共享合同对齐（总审缺陷一）

**根因**：后端 `OrderCommunicationScreenshotReferenceDto` 自阶段 6.6E 起即返回 `uploaded_at` / `uploaded_by_staff_id` / `uploaded_by_staff_name`（`apps/api/src/order-communication-screenshots/read-model.ts` 联查 `file_objects.uploaded_at` + `file_upload_intents.owner_actor_*` + `staff_users.display_name`），但卖家端 `sellerFormalOrdersSchema` 的 strict 数组元素缺少这三个字段——真实后端响应会被 strict schema **整体拒绝**，卖家订单页永远进错误态。

**修复**（`apps/web/src/seller/contracts/runtime.ts`）：

- `communication_screenshots` 每项补齐三字段，语义与共享合同一致：`uploaded_at` 必填 epoch、`uploaded_by_staff_id` 必填可空、`uploaded_by_staff_name` 可选可空（写法与员工端 runtime 一致）；未使用 `.passthrough()`。
- 修复过程中发现并一并纠正的同源漂移（均以共享合同 + 后端投影为权威）：
  - 删除 `legacy_projection` 判别字段与 `legacy_projection: 'NONE'` 平台变体——该形状源自**已归档** Change `2026-08-17-rakuten-tiktok-jp-marketplace-foundation`，现行 `SellerFormalOrderPortalDto` 只有 AMAZON_JP 单形状，后端对非 AMAZON_JP fail closed 503；
  - 删除订单 DTO 上的 `canonical_marketplace_code`（共享合同无此字段；stores DTO 的同名字段是真字段，保留）；
  - 快照时间戳字段名对齐共享合同：`base_rate_confirmed_at`→`base_rate_created_at`、`policy_confirmed_at`→`policy_created_at`、费用快照 `confirmed_at`→`created_at`；
  - 费用快照 `review_type` 从 `z.string()` 收紧为评价类型枚举。
- `SellerPages.tsx` 站点显示由不存在的 `canonical_marketplace_code` 改为 `marketplace_code`。

**合同级测试**（`runtime.test.ts` 6/6 过）：

- 正向：按后端 `mapFormalOrder` 真实输出形状（含三新字段）的订单列表可被 `sellerFormalOrdersSchema` 解析；`uploaded_by_staff_name` 缺省、为 null 均可解析；
- 负向：截图元素带 `object_key` / `drive_file_id` 被拒；缺 `uploaded_at` / `uploaded_by_staff_id` 被拒；带 `legacy_projection` 被拒；快照 `confirmed_at` 字段名漂移被拒；
- 列表与详情共用同一合同：卖家详情页由列表数据渲染，read-intent 响应合同 `sellerOrderChatScreenshotReadIntentResponseSchema` 复核与共享 DTO 一致。

**fixture 对齐**（全部改为真实后端形状）：`SellerPages.chat-screenshot.msw.test.tsx`、`apps/web/src/review/demo-data.ts`（review demo 的 `demoApiRequest` 会用运行时 schema 解析，旧形状必然失败）、`stage7-three-portals.spec.ts`、`stage7-three-portals-screenshots.spec.ts`、`seller-visual-refresh.spec.ts`（该 spec 的订单 fixture 此前从未通过 schema 解析——页面只断言标题所以掩盖了漂移，本轮修复后订单页在 capture 中真实渲染内容）。

## 2. 卖家端多张沟通截图渲染（总审缺陷二）

`SellerPages.tsx` 原 `communication_screenshots?.[0]` 只取第一张。现改为渲染完整数组：

- 每张截图独立条目：自己的"展开/收起沟通截图 N"按钮、自己的 read-intent provider（绑定自身 `file_object_id` + `file_version`）、上传人（`uploaded_by_staff_name ?? '未知员工'` 中性占位）、上传时间（北京时间格式化）；
- 空数组显示"暂无沟通截图"明确空状态；
- concealed 404 / SELLER_VISIBLE 权限边界由既有 read-intent 传输层处理，未改动。

**测试**：MSW `SellerPages.chat-screenshot.msw.test.tsx`——一张/两张/多张混合渲染；两张截图产生**两个独立可操作入口**（`readIntentFiles` 断言 `['chat-file-1','chat-file-2']` 两次调用各用自身文件身份）；上传人可解析（李明）与不可解析（未知员工）占位并存。Playwright `stage7-three-portals.spec.ts` 用带三新字段的真实 DTO 形状 mock，断言两个按钮 + 上传人 + 上传时间，不再只断言"已上传"。

## 3. CSS 重复清理（总审缺陷三）

**事实核对（以 Git 为准）**：`4859d150` 对 `global.css` 实际为 +9,841/−1 行（`git show 4859d150 --stat`），即把同一份 3,280 行完整样式表追加成三份字节级相同副本（SHA256 `f01127c5…` 三段一致）+ 第 4 份修订副本 + 635 行尾部。

**清理方法**：

1. 删除两份字节级完全相同的副本（保留一份）——层叠等价（A=B=C，删 B/C 不改变计算样式）；
2. 第 4 份修订副本与首份之间的**顶层规则单元级**重复（连续 ≥24 行、整规则边界对齐、逐字节相同）按"保留后份"原则再删 2,737 行——对相同选择器后声明必胜，删前份不改变层叠结果；括号配平校验通过；
3. `design-freeze.css`：无 ≥256 行重复区块；trailing whitespace 2 行清除；139 个类名全部有引用（含 e2e），无旧壳层可删；
4. `global.css` 264 个类名全仓引用检查（src + e2e + html + md）零死类，未误删任何动态类名族。

**清理前后指标**：

| 指标 | 前 | 后 |
|---|---|---|
| global.css 行数 | 13,755 | 4,458 |
| global.css 字节 | 269,589 | 86,649 |
| design-freeze.css | 1,277 行 / 43,748 B（2 行 trailing ws） | 1,277 行 / 43,744 B（0） |
| 构建 CSS raw | 167,016 B（167.01 kB） | 153,211 B（153.21 kB） |
| 构建 CSS gzip | 24,469 B（24.55 kB） | 24,071 B（24.04 kB） |

**防回归**：新增 `scripts/verify-css-duplicates.mjs`（`npm run verify:css-duplicates`，已并入 `check:ci:static` 链）——对全部 6 个样式表检测任意 ≥256 行字节级完全重复区块，发现即 exit 1；负向自测（构造重复文件）确认会失败。当前 6 文件全部通过。

**视觉回归确认**：三端 13 张截图重新生成（vite preview + 确定性 mock），关键两张经视觉模型逐项确认（卖家订单页：两入口+上传人+时间、无错误状态；员工工作台：无错误状态、身份块去重）；其余截图在生成前均由 spec 断言核心内容可见 + `noHorizontalOverflow`（1440/1600/390/320、200% 缩放、reduced-motion 由 buyer-remaining-visual / seller-visual-refresh / module1 程序化覆盖）。

## 4. 买家 Playwright 基线失败收口（总审缺陷四）

基线实测（起点 dist）：四 spec **23 失败 / 83 过 / 1 skip**（skip 为需 `BUYER_VISUAL_REVIEW_SCREENSHOT` 环境变量的视觉检查点，预存在设计）。逐项分类与处置：

### 4.1 真实功能回归（修产品代码，2 项）

| 问题 | 修复 |
|---|---|
| `BuyerInstructionPage` 渲染顺序缺陷：内容读取以非 409/410 错误失败时，state 查询 disabled 但渲染先卡 `state.isPending`，页面永久停留"读取步骤状态中…"，无法展示错误也无法恢复 | `content.isError && !isInstructionStateFallbackError` 时立即渲染 `BuyerQueryError`（`apps/web/src/buyer/instructions/BuyerInstructionPage.tsx`） |
| 证据/评论图片受保护读取控件从"查看文件"按钮改为内联懒加载（`ProtectedImagePreview` + IntersectionObserver），但测试未滚动到视口导致永不发起读取 | 属批准交互；测试补 `scrollIntoViewIfNeeded()`（见 4.3 表） |

### 4.2 无障碍回归（修 CSS，1 项根因 → 3 个测试）

**根因**：阶段 7 提交 `f538f890` 重写 tokens.css 时删除了 `--color-focus` 定义，而 `global.css` 8 处 `:focus-visible { outline: 3px solid var(--color-focus) }` 仍引用它 → 变量无效 → 全部焦点环 outline 计算值失效（`outline-style: none`）。Git 追溯：该变量自 `754c0f05` 起存在于 tokens.css，`f538f890` 删除。

**修复**：tokens.css 焦点环段恢复 `--color-focus: var(--color-primary)`（Material 3 主色，与 `--focus-ring-color` 一致）。三个焦点可见性测试（module1 `Buyer keyboard focus remains visible`、pilot Tab 聚焦、remaining-visual 390px 缩放聚焦）全部恢复通过，无需改任何断言。

### 4.3 已批准业务/交互变更导致的旧断言（更新测试，逐项说明）

| 测试 | 旧断言 | 当前批准合同/交互 | 修改理由 |
|---|---|---|---|
| module1/customer-security 注册成功 | `完成注册` 后自动跳转 `/buyer` | 注册成功页人工点击"进入买家中心"（`BuyerRegistrationPage` 实现） | 测试与批准交互对齐：先断言"注册成功"标题，点击按钮后再断言 URL/导航 |
| module1 任务中心 | 标题 `您有 5 件待办事项` | `classifyBuyerTasks` 只计紧急+可行动（系统处理中不计入），同 fixture 实际为 4 | 旧计数含系统项；现行规则由 `task-classification.test.ts` 权威定义 |
| module1 返款活动 | `付款冲正` | `PAYMENT_REVERSED: '付款撤回'`（`status.ts` 现行文案） | 文案已按批准变更，断言同步 |
| remaining-visual 返款旅程 | 非终态详情页 `[aria-current=step]` 计数 0 | P6 六步旅程：未结清高亮"返款中"当前步；PAID 结清后全点亮无当前步 + "返款已完成"提示 | BuyerJourney 组件即批准实现；新断言语义更强（正确阶段高亮 + 结清态全亮） |
| module1 证据历史元数据 | `历史文件仅保留元数据` | `历史文件已不再提供下载，只能看到文件信息。` | 同义现行文案 |
| module1 评论表单 | label `评论证据` | label `评论文件`（FileDropZone id 关联，multiple 属性不变） | 7B 重命名后的批准 aria 名称 |
| module1 证据/评论受保护读取 | 点击"查看文件"→"打开文件"链接 | 图片类内联加载（懒加载），成功即 `img[alt=文件名]`；429/503 失败一次出"重试"，重试复用同一 content token（token 断言保留且更强） | 批准交互为内联图片；重试/同 token/实体绑定 provider 断言全部保留 |
| module1 指引主图 | "查看主图"按钮 | 内联主图（懒加载滚入视口）+ 大图对话框 | 同上 |
| module1 指引 COMPLETED 零请求 | 内容端点 0 请求 | 真实合同：内容端点对非 ACTIVE 返回 409/410（read-model `INSTRUCTION_EXPIRED`/`INSTRUCTION_NOT_PUBLISHED`），页面探测一次后回退 state 视图 | 旧"零请求"与真实合同冲突；改为断言零**图片**读取请求 + 终态视图 |
| screenshots spec 卖家截图 | （新增第 13 张） | 订单页沟通截图桌面 1440×900，含 ≥2 张真实形状截图及上传人/时间 | 总审要求补足 |
| staff-workbench 队列→详情 | `.staff-context-bar` 内姓名/角色；区块标题 `订单关键事实` | 阶段 7 壳层重命名：顶栏 `.staff-session-context`（姓名/角色/范围）；工作项页区块标题 `订单资料核对`（`订单关键事实` 区在统一订单详情页，region 而非 heading） | f538f890 移除 context-bar 标记后 spec 未同步——阶段 7 即失败的存量漂移，本轮按现行批准壳层更新断言（金额/价差/冲突恢复/幂等键断言原样保留） |

### 4.4 fixture 与真实合同不一致（修 fixture）

| fixture | 漂移 | 修复 |
|---|---|---|
| module1/remaining-visual 指引内容端点 | 缺 `instruction_version`/`current_version_no`/`evidence_status`/`can_submit_evidence`/`can_read_images` 5 个必填字段、多出合同外的 `keyword_images`、非 ACTIVE 仍返回 200 | 按共享 `BuyerOrderInstructionDto` 补齐/删除；非 ACTIVE 按真实合同返回 410（EXPIRED）/409（其余） |
| 各卖家订单 fixture | `legacy_projection`/`canonical_marketplace_code`/快照 `*_confirmed_at` 漂移、缺截图上传人字段 | 见 §1 |
| stage7 spec stores fixture | （本轮编辑事故：全局替换误删 stores 的真字段 `canonical_marketplace_code`，当轮即被 e2e 发现并恢复） | 已恢复，测试全绿 |

### 4.5 结果

四个买家 spec 完整执行：`module1-buyer` 90/90、`buyer-visual-pilot` + `buyer-remaining-visual` + `customer-security` 16 过 1 skip（环境变量门控的预存在检查点）。终门另发现 `staff-workbench` 两个用例为阶段 7 即存在的存量断言漂移（见 4.3 表末行），按现行壳层修复后 6/6。未删除任何测试、未 skip、未降低断言、未仅延长超时（429/503 重试等待超时沿用原值）。

## 5. 视觉证据（总审缺陷五）

`tmp/stage7-three-portals-screenshots/`（gitignore，磁盘留存，13 张，全部生成自断言通过后的真实渲染）：

员工端：staff-workbench / staff-order-detail（桌面 1440×900）、staff-mobile、staff-mobile-drawer（390×844）。
买家端：buyer-home / buyer-order-detail（1440×900）、buyer-mobile、buyer-mobile-drawer（390×844）。
卖家端：seller-home、**seller-orders-communication-screenshots（两份真实形状 DTO 截图：上传人"总管理员/卖家对接"+上传时间）**、seller-settlement（1440×900）、seller-mobile、seller-mobile-drawer（390×844）。

- 无"成员列表暂时不可用/读取中"并存错误态；无图片读取失败态充当正常态（证据：视觉模型逐项确认 + 各 spec 断言）。
- 员工工作台重复身份文字修复：删除桌面侧栏底部整块重复身份（头像+姓名+角色；顶栏会话区唯一呈现，移动 Drawer 保留）。问候语含姓名与顶栏小号内容区标题属模板设计模式（小号上下文标签 + 大号页面标题），未改；e2e 对 `heading '工作台'` 的既有断言全部保持通过。
- 1440/1280(1600)/768(390)/320 四档、水平溢出、Drawer、键盘焦点、200% 缩放回流、reduced-motion 由 buyer-remaining-visual / seller-visual-refresh / module1 / pilot / stage7 spec 程序化断言覆盖（全绿）。

## 6. 后端合同缺口（真缺口，本轮零后端改动）vs 已修复前端缺口

**真正的后端缺口（未变，待后续独立 OpenSpec Change）**：

1. 员工订单 cursor 列表端点（员工端无订单列表页）；
2. 统一订单详情的订单负责人/下一步字段；
3. 工作台 SLA、逾期、今日返款金额（work-items API 不暴露）；
4. 卖家端产品主要对接人（products DTO 无字段、无设置端点）；
5. 卖家结算批次化（周批次/批次确认/导出）；
6. 买家固定联系人（buyer-portal 无 assigned-staff DTO）。

**本轮已修复的前端缺口（后端早已支持，勿再列为缺口）**：卖家沟通截图上传人/上传时间（后端 6.6E 起返回；本轮前端 schema+UI 接线）。另修复纯前端问题：指引页错误态挂起、焦点环变量丢失、CSS 重复、桌面侧栏身份重复。

## 7. 验证结果（真实执行，2026-08-29）

| 命令 | 退出码 |
|---|---|
| `npm run typecheck` | 0 |
| `npm test` | 0（250 文件 / 1,695 用例全过；较阶段 7 基线 +1，来源为卖家合同级测试净增） |
| `npm run build` | 0 |
| `npm run check`（含新 `verify:css-duplicates`） | 0（首次运行失败：新 npm script 未登记 `final-production-go-workflow-governance.mjs` 的 CI allowlist 被治理门拒绝；登记 `scripts/verify-css-duplicates.mjs` 后全链复跑通过） |
| `openspec validate --all --strict` | 0（63/63） |
| `npm run verify:api-contract` | 0（224 documented endpoints 双向一致） |
| `npm run verify:web-source-boundaries` | 0 |
| `npm run verify:web-static-build` | 0 |
| Playwright 11 spec 终门（一次连续执行） | exit 0：**159 passed / 1 skipped / 0 failed**（stage7 三端 16、三端截图 13、module1 90、pilot+remaining+security 16 过 + 1 skip[环境变量门控的视觉检查点]、stage66e 7、staff-workbench 6、stage7a1 5、seller-visual-refresh 6） |

负向验证：真实卖家截图 DTO 可解析（合同测试）、敏感字段拒绝（object_key/drive_file_id/legacy_projection）、两截图两入口（MSW+Playwright+截图视觉确认）、买家端无沟通截图入口（stage7 spec 既有断言）、跨卖家组织 concealed 404（stage7/seller spec 既有断言）、非 Owner 无成员管理（stage7 spec 断言）、CSS 无 ≥256 行重复（verifier exit 0）。

## 8. 远程边界

零：未 push / 未建 PR / 未触碰 Cloudflare、Google Drive、GitHub 远端、真实数据。阶段 7 五个提交与本轮一个提交全部保留在本地分支。

## 9. 下一步

停止并等待 ChatGPT 再次总审。审后可选：§6 真缺口逐个开 OpenSpec Change 补后端合同再补前端；仍未进入阶段 8 / 营销官网 / 部署。
