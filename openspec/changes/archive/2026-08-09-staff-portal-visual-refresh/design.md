# Design: Staff Portal Visual Refresh

## 1. Authority and Baseline

实现基线为 `origin/main` `3f94b0ce5fd96be0ff5e5be548ace694226e1eda`。业务真值来自决策登记、产品规则、现有 Staff runtime schemas/DTO、可信 Staff Session、后端有效权限/Scope/Personal DENY、受控命令和受保护文件控制器。视觉参考只约束高信息密度、清晰导航、筛选、工作列表、详情和操作的相对层级，不授权其图中任何订单号、姓名、手机号、来源、计数、时间、金额、状态、动作或权限。

可重复环境固定为 Node `v24.18.1`、npm `11.16.0`，lockfile SHA-256 `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`。实现前后在同一环境记录初始入口、CSS、Staff 主路由、Staff 管理看板分包和 Staff 排期分包的 raw/gzip 大小；所有 JavaScript 分包必须低于 500 kB，否则记录明确阻断。

`apps/web/src/styles/tokens.css` 是唯一设计真值，保持现有语义颜色、间距、字体、圆角和阴影。`global.css` 只组合这些变量，不建立第二套色板/间距/字体/阴影/身份主题，不新增字体、框架或运行时依赖。

## 2. Staff Shell and Navigation

宽屏使用一个语义 Staff 壳层：左侧导航栏、顶部员工/角色/北京时间上下文、主内容区。导航只包含现有真实入口：工作队列、获客登记、产品预约、经营看板；每项根据可信 Session 中当前唯一角色与有效权限投影，客户端判断只负责避免展示无权入口，绝不成为授权。

- 工作队列：全部 ACTIVE Staff 可进入，实际列表与动作由后端过滤。
- 获客登记：仅当后端投影包含 owner 管理、Buyer lead 或 Seller lead 任一获客权限并符合冻结角色职责时显示；`buyer_refund` 始终不显示。
- 产品预约：仅 `PRODUCT_VIEW` 投影允许时显示；写入仍由 owner/seller_ops 硬角色、双权限、Scope 与 Assignment 校验。
- 经营看板：仅 system owner 角色加 `FINANCIAL_VIEW` 时显示；Personal DENY 最终优先。

窄屏保留所有被允许的真实入口，以紧凑可横向容纳但不造成文档溢出的导航呈现。路由、`aria-current`、深链、Staff Session boundary、Query cache root 和 401 清理不变。

## 3. Work Queue, Detail, and Controlled Actions

工作队列继续是主要导航脊柱。桌面保持三列：队列/筛选 → 权威详情 → 受控操作与客户安全；DOM 和键盘顺序与此一致。队列只显示现有 `work_items` 返回事实、准确的本页项数、状态/类型筛选、opaque cursor 上下页，不发明搜索、来源筛选、总数或页码。

详情使用现有各域 DTO，按客户可见内容、内部内容、财务/证据事实分组。动作保留现有表单字段、确认、版本、Idempotency-Key、重试权威、请求 ID、文件读取和错误恢复。视觉上将主要确认、要求修改/拒绝、冲正/付款等真实动作分层，但不改变动作存在条件、危险语义或请求体。

客户邀请/账号恢复从通用详情中形成紧凑的次级工具区，保留全部人工核验、一次性链接、撤销、隐藏、请求 ID 和密码不可见边界，不将 token 写入持久状态。

## 4. Acquisition, Scheduling, and Dashboard

获客登记保留 owner/pre_sales/seller_ops 的现有分支：摘要、添加微信后登记、线索列表和 owner 配置使用统一工作台层级。渠道继续由后端解析；普通员工不选择渠道；咨询、转化、合作、未参加、利润和匿名化不在浏览器计算。稳定 `/staff/acquisition` 入口保持可收藏，买家返款和被 DENY 的员工看不到导航/控件，直接 API 仍拒绝。

产品/预约排期保留原搜索、产品表格、产品详情、版本历史、预约排名、预览/确认和服务端日期公式。列表/筛选/详情/操作使用统一密度；历史未配置仍显示“尚未配置排期”。预计日期不替代实际订单、资料或财务事实。

经营看板保留 owner-only 访问、今日/本周/本月窗口、Buyer/Seller 漏斗、趋势、员工/渠道表现、drill-down 和服务端 `data_as_of`。预计利润与已完成利润保持独立卡片/字段，不合并成“利润”，不在浏览器重算或以缺失事实补零。

## 5. Login, Chinese, Time, Money, and Files

Staff 登录保留当前可信 Provider 启动、返回路径、安全错误和 Staff/Customer 身份隔离，不引入账号密码、角色选择或客户身份入口。展示压缩重复“员工工作区/员工登录/内部工作区”等文案，保留月光白、一个明确可信登录动作和必要错误/返回操作。

所有新增或触及的用户文案为中文。epoch 时间继续用 `Asia/Shanghai` 格式化并明确“北京时间”；业务日期保持 date-only。JPY/KRW/USD/CNY、汇率、返款、卖家本金、卖家服务费和利润继续使用现有整数/字符串/BigInt 安全格式化，预计利润与已完成利润分开。文件只通过现有 Staff purpose/audience 动态授权按钮读取，不显示 object key、Drive ID、永久 URL 或 token。

## 6. Responsive and Accessibility

验收矩阵为 320x800、390x844、768x1024、1440x900、1600x1000。桌面最大化扫描效率；窄屏按导航 → 筛选/队列 → 详情 → 受控动作/工具的语义顺序单列重排。所有交互目标至少 44px；标识符、金额、时间、表格和表单可换行且不造成文档级横向滚动。

200% 根字号下代表性队列、获客、排期、看板和登录页面不裁切主要控件。键盘焦点始终可见且不被固定导航覆盖；状态不只依赖颜色；表格保持 caption/headers 并在窄屏可读取；既有 `prefers-reduced-motion` 规则继续生效。对文本、弱化文本、边框、状态、焦点和主要动作做 token 实际背景对比检查。

## 7. Deterministic Evidence and Four-Role Matrix

新增 Staff 专用 Playwright fixture，只拦截现有 Staff Session 和真实现有 endpoint shape，固定 `zh-CN`、`Asia/Shanghai`、light、reduced motion、UTC 时间、数据、viewport 和文件名。before/after 至少覆盖登录、队列/详情/动作、获客、产品列表/详情/预约排期、经营看板在 390/1440，关键密集页面再覆盖 320/768/1600。

独立 DOM/browser 断言覆盖：

- owner、pre_sales、seller_ops、buyer_refund 的导航、字段和动作投影；
- buyer_refund 无获客入口/控件，非 owner/FINANCIAL_VIEW 无经营看板；
- Session、401/403/404、Personal DENY、forced-password/customer identity 回归、Staff/Buyer/Seller cache 隔离；
- 客户/组织/店铺/文件隔离与 forbidden storage/secret 字段缺失；
- 中文、北京时间、整数金额、预计/已完成利润分离；
- 键盘、200%、reduced motion、44px、横向溢出和深层链接。

截图只是视觉证据，不能替代完整权限、业务、D1、文件、财务和浏览器门禁。每张 before/after 均记录层级、中文换行、溢出、焦点、事实真实性和禁用披露的复核结果。

## 8. Performance and Isolation

不新增运行时依赖。保持现有 initial entry → Staff portal → Staff admin/scheduling page chunk 边界。冷 `/staff` 不预载 Buyer、Seller、Staff admin 或 Staff scheduling 业务分包；冷 dashboard/scheduling 只加载其必要 Staff 分包，不预载 Buyer/Seller 页面。直接深链、加载失败中文重试、Session boundary 和缓存清理保持不变。

## 9. Rejected Alternatives

- 新设计系统、token 文件或 UI/表格框架：现有 tokens、primitives、DataTable 和 CSS 足够。
- 按参考图增加搜索、来源、统计、客户字段或动作：参考图不是业务/权限合同。
- 客户端角色/Scope 授权：可信后端 Session 和每次请求授权才是唯一真值。
- 合并预计利润与已完成利润、卖家本金与服务费：会破坏冻结财务语义。
- 同时重做 Buyer/Seller：违反唯一 Change 和身份视觉治理范围。

## 10. Verification and Rollback

实现中只运行必要的 Staff 定向 typecheck/build/Vitest/Playwright。全部页面与 after 截图完成后统一运行一次 target/all OpenSpec strict、完整 `npm run check`、完整 `npm run test:wave14a:browser`、Staff 四角色/获客/排期/看板专项、依赖风险、secret scan、`git diff --check`、scope/import/chunk 审查和手工实现一致性核对。失败后只做受影响定向复测，最终需要建立完整绿色结论时再运行一次完整确认。

完整门禁与 OpenSpec 一致性通过后，Ponytail 只对当前 Diff 做只读最小性审查，绝不修改代码。回滚只撤回 Staff 前端展示、Staff 专用测试和证据。
