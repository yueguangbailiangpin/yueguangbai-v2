# V2 决策登记

## 已确认

### D-001 技术路线

```text
Cloudflare Access + Private WeChat + Cloudflare Workers/D1/R2
                         + Google Drive cold archive
```

状态：Accepted（Staff 部分由 D-032细化）

### D-002 私人微信

私人微信是主要日常沟通渠道，但不是正式数据源。第一版不开发微信自动化。

状态：Accepted

### D-003 门户消息

第一版门户只做问题反馈和资料补充，不开发完整多轮实时聊天。

状态：Accepted

### D-004 飞书

飞书用于员工身份、任务摘要、队列和提醒。D1 是任务和权限权威源。

状态：Superseded by D-032

### D-005 数据和图片

D1 是唯一权威业务数据库和文件授权/Manifest 来源。R2 是正式热图片源；满足 D-019 归档条件的文件迁移到 Google Drive 后，Google Drive 是永久冷归档源。客户和员工只能通过月光白受控文件接口读取，不公开 R2 Key、Google Drive 文件 ID 或裸链接。

状态：Accepted

### D-006 员工角色

六类基础角色，员工可多角色。部门负责人使用权限包和团队范围，不新增固定角色。

状态：Superseded by D-024（保留为历史记录）

### D-007 客户激活

新买家、新卖家默认停用。普通无冲突买家可由售前激活；高风险身份冲突、合并、纠正和旧微信释放只允许 owner。

状态：Accepted

### D-008 产品与需求

产品和需求批次分离。产品通过不自动开放预约。

状态：Accepted

### D-009 订单形成

买家提交待核对订单资料；售前确认后才形成正式订单和快照。

状态：Accepted

### D-010 评论与财务

保留原模式：评论审核通过后产生买家返款应付和卖家服务费应收。

状态：Accepted by business owner

### D-031 卖家本金下单日汇率与加点策略

卖家应返本金的权威计算只使用平台下单日的权威日基准汇率加卖家本金汇率加点。Amazon 的 `amazon_order_date` 是日期事实，按中国业务自然日匹配日汇率；不使用确认日汇率，也不自动回退最近日期。加点为绝对增量，使用与日汇率相同的整数刻度，JPY→CNY 的 `0.004` 编码为 `400000` / `100000000`。

币种对默认策略可由 Staff 配置，并预留卖家组织覆盖；组织覆盖优先，显式 0 与没有覆盖必须区分。策略版本带生效时间、提交/确认审计身份、决策版本和幂等键。Migration 0041 在 D1 层只允许 `SUBMITTED→CONFIRMED/REJECTED`，终态版本与事件不可改删，并保护 pending/effective boundary 唯一性；快照必须证明基准日等于平台下单日、默认策略组织为 NULL、覆盖组织等于正式订单卖家组织，并用无溢出商/余数分解证明 HALF_UP 本金金额。当前四角色模型下 GLOBAL Owner 可提交默认或组织覆盖，局部 Seller Ops 只能提交已分配组织覆盖；卖家端没有写权限；配置读取与写入依赖可信 Staff Session、有效角色/权限和 Personal DENY 后的有效授权，Staff 工作台提供与后端一致的可见操作入口。

正式订单确认在同一事务中保存下单日、基准日汇率版本和值、实际采用策略的范围/版本/加点、最终汇率、`HALF_UP` 口径和本金结果。生产切换使用默认关闭的 `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED`：先应用 0041 并部署兼容 Worker，再由 Staff 创建并由 Owner 确认默认 JPY→CNY 策略及生效时间，验证可解析后由单独授权开启；开启后缺少基准汇率或生效策略时返回稳定的 `SELLER_PRINCIPAL_RATE_NOT_FOUND` 并保持未确认。若开关保持关闭，使用 0040 兼容计算路径；本地 Change 不执行生产顺序。Migration 0041 只追加表和快照；旧 Seller agreement 字段作为兼容投影保留，既有正式订单和账务不回写。

状态：Accepted for local implementation; production activation not approved

记录：该模式存在外部平台政策风险；“内部使用”不改变业务行为风险。项目按业务所有者决定实施，但不得开发自动操作评论、隐藏审计或规避平台识别的功能。

### D-011 财务不可变

已完成返款、卖家本金、服务费和内部结算不可直接编辑或删除。更正使用冲正和重新入账。

状态：Accepted

### D-012 旧仓库

只读参考固定 Commit `e211dff657dbcb100b111ba69a75f8e51268aef3`。不迁移旧 Git 历史、Migration、数据、资源或部署配置。

状态：Accepted

### D-013 代码执行分工

ChatGPT 网页版负责主要架构、完整文件和测试设计；Codex/DeepSeek 负责本地落盘、执行、测试、日志和经授权的部署。

状态：Accepted

### D-014 Staff身份与飞书认证边界

D1 中的 `staff_users`、角色、Permission、Personal DENY、Team、Department、Assignment 和 Data Scope 是 Staff 身份与授权的唯一权威。飞书是第一版生产 Staff 登录的认证 Provider，只证明配置 tenant 中的稳定身份；飞书不是角色、Permission、Scope、内部 Session、业务事实或财务数据库。

Worker 只把经服务端交换和校验的飞书身份映射到已经存在的 ACTIVE D1 Staff，并签发自己的 opaque、hashed、可撤销内部 Staff Session。Staff API 只信任该内部 Session Middleware 生成的 `staffAuthorization`，不得信任飞书 Header、客户端 `staff_id`、role、Permission、Team 或 Scope。未知、冲突或 inactive identity 不自动创建 Staff，必须 fail closed。

状态：Superseded by D-032

### D-015 多站点、平台与域名

第一版继续使用统一主域名和中文界面，不为日本、美国、韩国拆分客户域名。站点使用平台、国家/地区和交易币种组成的稳定代码；建议首批为 `AMAZON_JP`、`AMAZON_US` 和 `COUPANG_KR`。韩国站当前只预留注册表、权限和 Adapter 边界，不在缺少真实样本时实现 Coupang 编号或链接校验规则。

Buyer 永远只属于一个 Marketplace；正式业务事实产生前，可由 owner 通过审计命令纠正错误 Marketplace，产生正式事实后不得原地改变。Seller Organization 全局存在，可在多个 Marketplace 下拥有 Store；Store 是 Marketplace 归属和平台业务标识的边界。Buyer 登录和注册链接包含已确定的 Marketplace，Seller 使用统一入口登录后按授权 Store 查看各站点。

状态：Accepted

### D-016 多币种、汇率与服务费规则

Buyer 可使用 JPY、USD、KRW 等站点交易币种付款；Buyer Refund、Seller Principal、Seller Service Fee 和内部结算统一使用 CNY。金额必须保存整数最小货币单位和显式币种，不使用浮点数；JPY/KRW 使用零位小数，USD/CNY 使用两位小数，并在正式事实中锁定币种、比例尺、取整规则和规则版本。

Buyer 日汇率按 `business_date + source_currency + CNY` 统一维护。Seller 协议汇率按 `seller_organization + source_currency + CNY` 维护，同一 Seller Organization 的全部 JPY 业务共用一条 JPY/CNY 协议汇率。服务费按 `seller_organization + marketplace + review_type` 版本化维护。正式订单、返款、服务费和结算必须锁定当时使用的汇率和规则快照。

状态：Accepted

### D-017 Customer身份与业务身份

Staff 身份继续与 Customer 身份严格分离。一个规范化微信身份只对应一个 Customer Identity Subject、一个登录账号和一套密码；该账号可以同时拥有一个 Buyer Profile 和一个 Seller Organization Member Profile。Buyer 与 Seller 的门户上下文、资源授权、DTO 和 Query Cache 继续严格隔离，双身份不产生跨角色数据可见性。

同一个 Customer Identity Subject 不允许同时成为两个 Seller Organization 的有效成员。双身份客户在 Buyer/Seller 门户使用同一凭证，服务端根据当前受控入口解析相应业务 Actor，不使用组合型 `DUAL` 枚举作为权限权威。

状态：Accepted

### D-018 Buyer邀请与Customer密码恢复

`/buyer/register` 页面路径可以固定，但注册必须携带 Staff 签发的一次性邀请凭证。所有 ACTIVE Staff 均可签发；凭证绑定规范化微信号、Marketplace、签发员工和七天有效期，可在使用前撤销，只有注册成功才原子消费。签发邀请即代表 Staff 已批准该普通无冲突 Buyer；匹配注册成功后直接建立 ACTIVE Buyer/Account 与 Customer Session。高风险身份冲突仍按 D-007 fail closed 并只允许 owner 处理。根路径和登录页不得公开注册入口。

所有 ACTIVE Staff 均可在人工核验私人微信身份后签发一次性密码重置链接。Staff 不得查看或指定 Customer 新密码；Customer 成功重置后必须递增凭证/Session 版本并撤销全部既有 Customer Session。邀请、撤销、消费、重置成功和失败均需限流、幂等、安全事件和审计记录。

状态：Accepted

### D-019 Google Drive滚动冷归档

订单截图、评价截图、Buyer Refund 凭证和 Seller Settlement 凭证，在关联订单的评论、Buyer Refund、Seller Principal 与 Seller Service Fee 全部完成后计算归档期限；满六个自然月后按日滚动迁移到 Google Drive。一份凭证关联多个订单或结算项目时，必须等全部关联业务关闭，并使用最晚的归档到期时间。第一版使用业务所有者控制的普通 Google Drive 账号和专用归档目录，通过服务端 OAuth 凭证访问，不要求客户登录 Google，不公开分享链接。

归档必须先上传、读取回验并核对字节数、MIME 与 SHA-256，再写入 D1 `drive_file_id`、归档状态、时间和 Manifest；只有验证成功后才允许删除 R2 对象。失败必须保留 R2、幂等重试并告警。Google Drive 中的归档文件永久保存；系统继续使用原受控文件读取接口，根据 D1 文件授权在服务端代理 Drive 内容，Buyer、Seller 与 Staff 的原 Audience 和资源权限不得改变。

状态：Accepted

### D-020 飞书员工工作台范围

所有员工位于同一飞书租户，业务所有者拥有管理员权限，第一阶段按飞书免费版规划并以匿名 PoC 验证真实 API 权限和额度。飞书负责 Staff 登录入口、本人/团队任务、领取/分派、提醒、脱敏摘要和受控 Web 深链接；D1 继续是 Staff 权限、任务和业务事实唯一权威。正式审批、返款、结算、汇率变更和完整客户/财务资料不得以飞书记录作为权威。

系统按最多八名员工、每日最高二百订单设计。飞书只同步需要处理、异常或逾期的任务和聚合摘要，不镜像每一个订单状态变化。

状态：Superseded by D-032

### D-021 Staff MCP与Agent边界

第一阶段只上线 Staff MCP；Buyer 与 Seller 只预留 Actor、授权和 Application Service 边界，不创建未使用的公开工具或端点。Staff Agent 可在当前 D1 权限范围内读取完整微信号、结构化业务字段和任务所需原始截图，可查询待办/异常、生成中文私人微信文案、对账草稿和付款批次草稿。

密码、密码哈希、Cookie、Session、一次性凭证、Provider Token、Secret 和无业务目的的全库导出永远禁止进入 Agent。所有 MCP 工具调用必须重新计算 Staff 权限、限制资源范围、幂等、审计并返回最小业务结果。Agent 不得自动发送私人微信消息，不得最终批准返款、结算、汇率或其他正式状态；最终动作必须由员工在受控 Web 页面点击确认。

状态：Accepted

### D-022 API合同基线

现有正式 HTTP API 继续使用真实实现的 `/api/*` 路由族；不为文档一致性进行全仓 `/api/v2/*` 重命名。可增长列表默认使用 `cursor + limit + next_cursor`，合同文档应以真实已注册接口和分页语义为准修正。未来 MCP 工具合同独立使用工具版本，不以 HTTP 路径版本替代工具版本。

状态：Accepted

### D-023 生产运行与规模边界

系统按最多八名员工、每日最高二百订单使用单一 Workers/Hono 应用、单一 D1 和 R2，不拆微服务或分库。统一 Scheduled Handler/后台运行器负责超时释放、Outbox、文件补偿、安全临时数据清理、Google Drive 归档和失败重试；每类 Job 必须租约化、幂等、可续跑、可观测并有最近成功时间。

上线前必须完成 D1 完整导出、R2 与 Google Drive Manifest、哈希核对、隔离恢复演练、最小生产告警、飞书匿名 PoC、移动/联通/电信和微信内置浏览器实测。规划与本地通过不等于生产放行。

状态：Accepted

### D-024 四类员工角色与安全迁移

员工角色冻结为四类：`owner` 对外显示“总管理员”、`pre_sales` 对外显示“售前”、`seller_ops` 对外显示“卖家对接”、新角色 `buyer_refund` 对外显示“买家返款”。同一名 ACTIVE 员工只允许一个 ACTIVE 角色，不允许多角色叠加；登录页不提供角色选择，后端根据可信 Staff Session、唯一角色、个人授权/禁用、负责人权限包和数据范围生成工作台，后端权限仍是唯一真值。

历史角色按以下目标归并：`seller_support` 进入卖家对接职责，`buyer_support` 进入售前职责，`after_sales` 进入买家返款职责。数据库必须保留历史分配和审计，不得直接覆盖或删除旧记录。迁移前必须生成每名员工迁移前后的有效权限差异并由总管理员批准；旧客服角色不得仅因自动映射而静默获得新的正式写权限。多条旧 ACTIVE 角色不得自动合并，必须由总管理员明确选择唯一目标角色。未获批准或目标不唯一的映射必须失败关闭，不得以客户端菜单隐藏代替后端授权。

截至 2026-08-07，业务所有者确认暂无已知旧员工需要迁移；该确认不替代切换前对实际数据库的只读核验。若发现任何旧角色或多角色员工，必须停止切换并重新提交逐员工映射及权限差异审批。

总管理员可查看全部业务、预计利润、已完成利润、员工、权限和审计；买家返款角色承接原返款售后的评论审核、返款及必要买家资料能力，但不因此获得卖家内部协议、内部利润或系统管理权限。

状态：Accepted；取代 D-006

### D-025 客户入口与界面信息最小化

买家、卖家继续使用同一域名下的独立入口 `/buyer/login` 与 `/seller/login`。登录页由路径确定身份，不允许客户在页面切换；页面只保留“月光白、账号、密码、登录”，删除买家服务、买家登录、安全访问您的买家服务、卖家工作区、卖家登录和进入身份等重复或内部化文案。

买家界面删除“买家服务”“买家工作区”、客户编号和会话到期；导航和首页的“任务”统一改为“产品”，产品区只展示当前买家在其 Marketplace 下实际可预约的产品。订单资料、评论和返款继续位于独立页面。买家返款统一使用“返款金额”，业务上只返商品本金；不展示形成返款义务、首次付款、最后付款和更新时间等内部字段。客户确需显示的时间统一标注“北京时间”，不显示“中国标准时间”。

卖家界面删除“卖家工作台”“卖家首页”“卖家”等重复标题，以及韩国站预留、服务器业务事实、员工控制结算等内部说明；卖家本金和卖家服务费等必要业务名称保留。卖家门户必须补齐产品申请和需求批次的提交入口与表单，复用既有受控后端能力。

状态：Accepted

### D-026 员工获客登记与混合漏斗

获客登记集成员工工作台，并保留可直接收藏的稳定入口。总管理员维护渠道（例如不同小红书账号）、员工与渠道的有效期配置，并按北京时间业务日期填写各渠道每日咨询人数；咨询人数是渠道级每日汇总。普通员工不填写咨询人数，也不得在请求中指定权威渠道。

售前在买家添加微信后建立一条简化买家线索；卖家对接在卖家添加微信后建立一条简化卖家线索；买家返款不参与获客登记。渠道由后端根据总管理员当前有效配置自动带入，缺少或冲突配置时失败关闭。添加微信人数由单人线索自动汇总，不重复手填。

同一个人在同一渠道、同一北京时间自然日的咨询只计一次；同一个人咨询不同渠道时，各渠道分别计一次。同一规范化微信身份在 BUYER、SELLER 各自类型内最多保留一条有效线索，首次有效线索冻结原始渠道和创建员工；负责人变更不覆盖来源。

注册、预约、正式订单、未参加、卖家确认合作和利润尽量从 D1 业务事实自动关联。卖家确认合作以线索对应身份首次成为有效 Seller Organization 的 ACTIVE 成员为准。订单和利润只归因到 Buyer 线索最初的渠道和创建员工；Seller 获客只统计到确认合作，不重复累计同一订单或利润。总管理员可更正渠道日汇总和无效/重复线索，但所有更正必须版本化并写审计。

未转化线索自最后一次跟进起保留十二个月，期满后自动匿名化私人微信身份和非必要个人信息；审计、安全事件、法定留存及已经形成注册、预约、订单、合作或财务事实的记录不适用该自动匿名化规则，仍按各自正式留存政策处理。

“未参加”以有效买家线索为范围：已添加微信并建立线索，但截至统计时点从未提交过任何预约，计为未参加。一旦提交过预约，无论后来被拒绝、取消、过期或进入其他状态，都不再计为未参加。

状态：Accepted

### D-027 总管理员经营看板

总管理员工作台提供今日、本周、本月新增买家、预约和正式订单，买家与卖家获客漏斗，每名员工和每个渠道的业绩，以及日/周/月趋势。今日、自然周和自然月的边界全部使用 `Asia/Shanghai`；自然周从周一开始。

经营看板只读取后端业务与获客事实，不允许手工填写注册、预约、正式订单、未参加、合作或利润。预计利润和已完成利润必须分开展示，并复用正式内部财务公式：预计利润按正式订单确认日期归集，已完成利润按评论批准/财务完成口径归集；金额使用 CNY 整数分，浏览器不得自行计算权威利润。

利润及全局经营数据仍仅允许 Active Staff 的 system owner 加 `FINANCIAL_VIEW`，Personal DENY 最终优先。看板不得向非总管理员、Buyer、Seller、飞书摘要或 MCP 草稿泄漏内部利润、买家返款成本、其他卖家数据或客户隐私。

状态：Accepted

### D-028 产品预约顺序与下单日期排期

产品库为每个产品版本保存默认“下单节奏”，由总管理员或卖家对接维护，格式为“每隔 N 个自然日、每次 M 单”。`N`、`M` 都是正整数：每隔 1 天每次 1 单表示每天 1 单；每隔 1 天每次 2 单表示每天 2 单；每隔 2 天每次 1 单表示每两天 1 单。产品默认节奏后续可通过新增产品版本修改，不覆盖旧版本，默认只用于以后新发布的需求。

卖家对接每次发布产品需求时必须填写“首个下单日期”，并把当时产品版本的默认节奏锁定为本次需求的排期快照。已经发布的需求不得因产品库默认值后来变化而静默改期；总管理员或卖家对接可对本次需求单独发起受控排期修改，系统必须先展示受影响人数与修改前后日期，再以幂等、版本、原因和审计确认。实际订单日期和已经提交的订单资料不得被预计排期覆盖。

预约详情按有效预约的 `submitted_at` 升序排列，相同时间以不可变预约 ID 升序稳定排序。待审核和已批准预约都占用顺序；被拒绝、取消或过期的预约退出有效队列，后续未下单买家的排名和预计日期自动前移，历史预约及调整记录继续保留。第 `r` 名的批次序号为 `floor((r-1)/M)`，预计下单日期为首个下单日期加该批次序号乘 `N` 个自然日。

所有排期日期按北京时间自然日计算，连续包含周六、周日及所有节假日，不接入工作日或节假日日历。售前可在权限和数据范围内从产品预约详情查看预约排名、预约时间、预计下单日期和状态；卖家对接与总管理员可维护产品默认节奏和本次需求排期。无相应买家数据范围时只能看到最小化业务标识，不得泄漏微信号、返款、内部利润或其他客户隐私。Buyer、Seller 门户暂不展示内部排名和预计排期。

状态：Accepted

### D-029 前端按身份与页面拆分加载

M14 验收时，生产构建已经没有高风险依赖漏洞，但仍出现前端主包超过默认 500 kB 阈值的性能警告；当时基线为压缩前 605.54 kB、gzip 167.31 kB。两者必须分开治理：依赖漏洞已经关闭，主包警告不是 M14 获客功能缺陷，不得为消除警告而回改 M14、混入 M15/M16，或单纯调高 `chunkSizeWarningLimit`。

在 M11–M16 全部完成并合入后，单独实施 `frontend-route-code-splitting-performance`：先按买家、卖家、员工入口拆分按需加载，再对各身份的页面级代码继续做有证据的路由拆分。登录、会话恢复、权限失败、直接打开深层链接、中文加载/错误状态和买家/卖家/员工缓存隔离必须保持不变，不能因拆包出现短暂越权内容、身份串包或白屏。

该项不阻止 M14–M16 的功能提交，但属于最终 Production GO 前必须完成的生产准备项。验收必须在同一构建环境记录优化前后主入口及各路由分包的压缩前/gzip 大小，并用代表性的买家、卖家、员工冷启动路径实测首屏加载；不能只以“构建不再打印警告”代替真实性能证据。若仍存在超过预算的分包，必须给出依赖归因、用户影响和明确阻断结论，不得静默放行。

状态：Accepted

### D-030 Seller无主动退出入口与Customer安全清理边界

Seller 门户不提供“退出登录”入口，不新增 Seller 退出按钮、页面动作、替代退出路由或专门测试。Buyer 门户继续保留主动退出能力。

该界面决定不改变 Buyer 与 Seller 共用 HttpOnly Customer Session Cookie 的安全归属：Seller 入口发生账号类型不匹配、已验证的 Customer 401、Session 失效、凭证重置或其他既有失败关闭条件时，仍必须调用共享 Customer logout/失效清理，取消并移除 Buyer 与 Seller 两个 Customer Query Root，禁止旧身份缓存继续渲染；Staff Session 不受影响。不得以“Seller 没有退出按钮”为由删除或弱化底层自动清理。

状态：Accepted by business owner

### D-032 Staff使用Cloudflare Access且退出飞书运行链

Cloudflare Access 是唯一生产 Staff 前置认证边界，只验证签名、team domain、application audience 和规范化邮箱。月光白 D1 中的 ACTIVE 员工账号、唯一岗位、岗位默认权限、负责 Marketplace、PRIMARY/SUPPORT 与 Personal DENY 是唯一授权权威；Access 不自动创建员工，也不提供岗位、权限、任务或业务事实。

员工由总管理员直接以姓名、登录邮箱、唯一岗位和负责站点创建。系统不再使用飞书绑定邀请、OAuth 回调、员工工作台同步、卡片回调或飞书告警。员工任务和正式动作都在月光白受控 Web/API 完成。历史 Migration 和归档 Change 中的飞书表名/决策仅为升级与审计连续性保留，不构成现行运行入口。

D-032 取代 D-004、D-014 和 D-020 中关于飞书 Staff 身份、任务、同步及提醒的运行设计；它不改变私人微信的日常沟通边界。

状态：Accepted by business owner

### D-033 Buyer当前三导航与任务中心规范

D-025 作为历史产品入口与文案裁决继续保留，不改写其历史正文。当前正式 Buyer canonical model 明确为：主导航严格只有“产品、任务、我的”；`/buyer` 进入 `/buyer/products`；产品区只展示当前 Buyer 实际可预约产品；任务区聚合当前 reservation、order evidence、review、refund 等真实 API 证据；“需要 Buyer 本人处理”的事项才属于 actionable，审核中、处理中等 system-processing 状态单独展示且不计入 actionable 数量。

旧 Buyer Dashboard 页面、`rankBuyerTasks` 的 deadline ranking/global dedupe，以及 newly reservable demand dashboard 语义均只作为保留的历史/兼容证据；除非新的正式产品 Change 明确要求，不得重新定义为当前产品 requirement。

状态：Accepted by business owner；Supersedes the current Buyer surface interpretation where it conflicts, without rewriting D-025

### D-034 Staff当前五角色规范

D-024 的四角色迁移历史、审批规则和历史含义继续保留，不改写其历史正文。当前正式 Staff canonical role model 严格为五个角色：`owner`、`acquisition`、`pre_sales`、`seller_ops`、`buyer_refund`。Migration 0035 的“四角色”是历史迁移阶段，必须永久保留；Migration 0044 正式引入的 `acquisition` 是当前第五个 canonical role。

当前 ACTIVE Staff 仍必须恰好有一个 ACTIVE 角色，后端权限仍为唯一真值；五角色裁决不改变历史 Migration、历史 Decision、Personal DENY、数据范围或 fail-closed 规则。

状态：Accepted by business owner；Supersedes the current role-set interpretation where it conflicts, without rewriting D-024

### D-035 获客来源显式受控声明

D-026 的历史正文永久保留。本 Decision 仅取代 D-026 中“渠道必须由 Staff assignment 自动派生、请求不得包含渠道”这一条。当前 Prospect 和正式 Lead 的 `channel_id` 是客户端提交或确认的显式来源声明，不构成任何授权；后端仍是唯一权威，必须失败关闭地校验渠道存在且 ACTIVE、渠道 Buyer/Seller audience 与 Lead 类型相符、渠道 Marketplace 与请求 Marketplace 相符、当前 Staff 的 Marketplace scope，以及带 Prospect 时 Prospect 的类型、Marketplace 和原始渠道完全一致。未知、停用、跨类型、跨站点或与 Prospect 不一致的渠道不得创建事实。

没有 Prospect 的直接 Lead 可由具有对应 Lead 职责且当前 Marketplace scope 合法的 Staff 从合法渠道中选择或确认；有 Prospect 的正式 Lead 必须继承该 Prospect 的精确原始渠道，Staff 不得改写。创建后原始来源和创建 Staff 继续不可直接覆盖；任何来源更正只能通过既有受控、追加式、可审计的版本化更正历史表达。D-026 关于渠道归因、首触来源不可变、去重、系统事实转换、角色与 Marketplace 边界、Personal DENY 最终优先及 Staff-safe projection/privacy 的其余规则继续有效。

状态：Accepted by business owner；Supersedes only the server-derived/no-channel-in-request clause of D-026 without rewriting D-026

### D-036 Buyer旧Dashboard证据退役

D-033 的三导航、`/buyer` 入口、当前可预约产品和任务中心裁决继续有效。旧 `BuyerDashboardPage`、`rankBuyerTasks` 及其 deadline ranking/global dedupe 测试已经由 canonical Buyer 路由、导航和任务中心行为证据替代并从运行源码移除；它们不再作为兼容、验收或运行证据存在。

本退役不改变 reservation、order evidence、review、refund 的 API、合同、人工预约审核流程或业务状态机；也不恢复旧 Dashboard，亦不把 newly reservable demand dashboard 语义写回当前 requirement。D-033 的历史正文不改写，本 Decision 仅取代其“旧 Dashboard 文件仍保留”的当时实现状态。

状态：Accepted by business owner；Supersedes only D-033's retained-legacy-file implementation status without rewriting D-033

### D-037 Seller Settlement canonical接管与Staff旧证据退役

D-024、D-025 和 D-034 的历史正文与当前五角色裁决继续有效。正式 Staff 运行组合 `StaffRouteModule → FrozenStaffWorkbenchV2 → FrozenStaffWorkbench` 已接管 Seller Settlement 的汇总、独立应结项目、付款、分配、整笔冲正和受保护凭证行为；`StaffWorkbench` 及其 MSW 证据已由 canonical component、角色权限和 Frozen workbench 行为证据替代并从运行源码移除。

该前端只对具有 `SELLER_SETTLEMENT_VIEW` 的 `owner` 或 `seller_ops` 挂载结算面板，记录与分配还要求 `SELLER_SETTLEMENT_RECORD`，整笔冲正还要求 `FINANCIAL_CORRECT`；`acquisition`、`pre_sales`、`buyer_refund` 或缺少有效查看权限的会话不挂载且不发起结算请求。客户端 gating 不是授权：ACTIVE Staff、Personal DENY、Marketplace/Seller Organization scope、concealed 404、凭证 audience、幂等、版本、事务、Audit 与 Outbox 仍由现有后端逐请求失败关闭地裁决。

本接管不改变 Seller Settlement API、合同、金额计算、状态机、后端权限、数据库 Schema 或 Migration，也不改变 Acquisition、Admin、Buyer 或 Seller 运行能力。旧上传框提供 PDF 而后端付款凭证只接受 JPEG/PNG/WebP 属于接管前 UI 合同冲突；canonical chooser 已与现有后端合同对齐。

状态：Accepted by business owner；Supersedes only the retained legacy Staff Settlement frontend/evidence implementation status without rewriting D-024, D-025 or D-034

### D-038 Acquisition canonical证据迁移与旧别名退役

当前 Acquisition canonical evidence chain 固定为 `StaffRouteModule → AcquisitionCoreWorkbench → AcquisitionCoreWorkbenchV4`。旧 `AcquisitionWorkbench` re-export 及其同名 MSW 证据已由 V4 的 canonical MSW、route 和 browser evidence 取代并从运行源码移除；该退役不改变任何 API、DTO、schema、Migration、权限、来源归因、审计、去重或 Staff-safe projection 行为。

当前 `channel_id` 语义仍以 D-035 为准：它是受控的客户端来源声明而非授权，后端继续校验 ACTIVE、类型、Marketplace、Staff scope 和 Prospect 原始来源一致性并失败关闭。D-026 历史正文与其未被 D-035 取代的归因、不可变来源、审计与去重边界永久保留；本 Decision 不重复发明产品规则。

状态：Accepted by business owner；Records canonical evidence migration and alias retirement, without rewriting D-026 or D-035

### D-039 Admin canonical证据迁移与旧前端退役

D-025 的历史正文和 `admin-business-dashboard` 当前 Specification 继续有效。正式 Admin 运行链固定为 `App /staff/* → StaffRouteModule → StaffAdminRouteModule → FrozenAdminBusinessDashboard`；旧 `AdminBusinessDashboard`、其 MSW 证据及仅服务于该旧页面的 trend/drilldown frontend client、runtime schema 和 query-key helpers 已由 Frozen canonical MSW、route 和 browser evidence 取代并从运行源码移除。

当前 Frozen UI 覆盖今日/本周/本月、客户订单概览、Buyer/Seller funnel、渠道每日事实、预计/完成利润和经营完整性。旧 frontend drilldown 与 trend UI 不是当前 requirement，不因退役而恢复。后端 trend/drilldown routes、read model、shared contracts、D1 query-plan proof 及其 API/D1 tests 继续保留，后续 consumer audit 必须单独治理；它们不是 Frozen frontend 的替身证据。

本退役不改变 Admin API、runtime、权限、Personal DENY、财务公式、D1 schema 或 Migration，也不改变 Buyer、Seller 或其他 Staff 运行能力。Owner + `FINANCIAL_VIEW` 的客户端 gating 仍只减少无效请求；可信 Staff Session、Active 状态、Personal DENY 和后端失败关闭仍是唯一授权真值。

状态：Accepted by business owner；Records Admin evidence migration and legacy frontend retirement without rewriting D-025 or archived Changes

### D-040 日咨询写权限与Acquisition完整性边界

D-026、D-034、D-035 和 D-038 的历史正文永久保留。当前渠道日咨询人数的登记与更正严格为 `owner` 专属写能力；D-034 只确认当前五角色集合，不授予 `acquisition` 日咨询写权限，也不把 `ACQUISITION_ADMIN` 授予 `acquisition`。`acquisition` 继续作为 Marketplace-scoped 客户开发操作员读取本人站点内的渠道、来源、Prospect、漏斗、日咨询及其历史，并在该范围内操作 Prospect；它不得创建、查看或管理正式 Buyer/Seller Lead。

历史 Personal `GRANT` 记录和 Team/Leader 权限包只保留审计与兼容读取，不参与当前 effective permissions，也不得把 owner-only 日咨询写、`ACQUISITION_ADMIN` 或正式 Lead 职责扩给非 owner。当前权限只由唯一 canonical role 默认能力形成，再应用 Personal `DENY` 与系统硬禁止；Marketplace、组织、客户、资源归属和字段投影继续逐请求失败关闭。越 Marketplace scope 的咨询历史统一伪装为 `NOT_FOUND`。

渠道日咨询关键写必须在同一 D1 batch 中完成条件写、不可变 consultation event、通用 `audit_events`、幂等成功状态和事务末尾最终 `state/version/count` 断言；任何 batch 失败都必须清理幂等占位为可安全重试的失败状态，不得留下业务事实、领域事件、Audit 或成功幂等脏数据。本 Decision 不改变 Migration、Schema、Prospect 来源规则或其他 Acquisition redesign。

状态：Accepted by business owner；Narrows consultation writes to owner and records the current audit-only legacy authorization boundary without rewriting D-026, D-034, D-035 or D-038

### D-041 隔离Staging Readiness与首任Owner引导

Staging 是生产前的隔离验收环境，允许与 production 位于同一 Cloudflare Account，但 Worker、D1、R2、Custom Domain、Cloudflare Access Application/Policy、Secret 和测试身份必须全部使用不同资源标识；这属于资源隔离，不等于 Account 级信任隔离。任何 staging 配置、工具或验收不得读取或写入 production D1/R2，不得复用 production Secret、域名、Access Audience 或 Worker name。

Staging 继续按既有裁决关闭 Scheduler、Acquisition Maintenance 与 operational alert sink，因此不得为了让 `/ready` 返回 200 而伪造这些能力已经运行成功。Staging `/ready` 必须把这三项以及 release-bound production recovery attestation 显式报告为 `not_required`，同时仍强制要求 Schema 65、真实隔离 R2 binding、有效的 staging Cloudflare Access team/audience 和精确 40 位 release SHA。Production `/ready` 的八项 `ok` 语义保持不变；未知环境、staging 错误启用生产能力或缺少必需 staging 证据时继续失败关闭。

全新 staging D1 的首任 Owner 只能由一次性 operator bootstrap 创建。该操作只接受显式 staging 数据库名称/ID和 Git 外、仅 Owner 可读的姓名/邮箱输入；执行前必须验证 Schema 65、远程数据库名称/ID一致且所有 Staff 身份/角色/Scope/Session/授权事实及 Buyer channel 为空。它以符合 D1 REST 字符串参数契约的参数化 batch 原子创建唯一 ACTIVE Owner、唯一 ACTIVE role、唯一 ACTIVE email identity、唯一 `staging-buyer-channel`、授权事件和不可变 Audit，并提供幂等重放、冲突和最终数量断言；不得新增公网 HTTP bootstrap、密码、测试后门、Migration 写死邮箱或散装 SQL。staging release 显式开启 invitation-based Buyer registration 并只使用该 synthetic channel。首任 Owner 登录后，另外四个 canonical Staff 角色只能通过正式 Owner Staff management API 创建；Staff 使用 Cloudflare Access 邮箱 OTP，不存在测试密码。

Staging Buyer/Seller 测试身份必须使用 synthetic 标记和正式 onboarding、activation、password 流程创建，并能够由 operator 禁用或重置。账号、密码、邮箱、OTP、Token 和 Secret 不进入 Git、命令输出或审计明文。远程资源创建、Migration、Secret、Access、DNS、部署和测试身份激活仍需逐阶段显式授权与固定 SHA 验收；本 Decision 不授权 production 操作。

状态：Accepted by business owner；Defines isolated staging acceptance without weakening production readiness or D-032/D-034 Staff authority

### D-042 Advance资金完整性与Schema 66

D-041 记录的 Schema 65 staging 要求和 Migration 0001–0065 是当时的正式基线，历史正文永久保留。当前发布候选由仅前向 Migration 0066 提升为 Schema 66：数据库必须在序列化写入边界拒绝累计 Advance Principal 冲正超过原付款，且升级前若已经存在超额冲正，Migration 必须失败关闭，不得自动删除、覆盖或伪造补偿历史。

内部公司现金流必须按真实付款/冲正发生时间同时统计普通 Buyer Refund 和 Advance Principal，并分开报告两类金额。Advance 后续自动抵扣正式返款义务时产生的 Buyer Refund 账本镜像不代表第二次真实付款，不得重复计入现金流；其引用冲正同样不得制造虚假现金流。手工 Buyer Refund 和 Advance Principal 的 `paid_at` 不得晚于服务端命令时间，并须在取得幂等权威前失败关闭。

本 Decision 不修改 Migration 0001–0065，不重写不可变财务事实，不改变返款义务、Advance 自动抵扣、Seller Settlement、利润公式、角色或权限。D-041 的 staging 资源隔离、首任 Owner、production 禁止和外部授权边界继续有效，仅其中当前 Schema 数字由 65 前向取代为 66。

状态：Accepted by business owner；Supersedes only D-041's current Schema 65 release baseline without rewriting D-041

### D-043 Advance V1全额提前返模式

首发 Advance Principal 只支持一次性全额提前返。权威付款金额由服务端读取正式订单不可变财务快照中的 `buyer_expected_principal_cny_fen`，Staff 客户端不得提交、覆盖或拆分金额；同一正式订单同一时间最多存在一笔尚未整笔冲正的 Advance Payment。

Advance 冲正同样只支持整笔。Staff 仅提交冲正原因，服务端从原 Payment 派生全部冲正金额；不允许部分冲正、重复冲正或多笔 Payment 拼接一笔返款义务。整笔冲正后允许重新录入一笔新的全额 Advance。后续正式返款义务形成时，仍由既有不可变 settlement 账本自动抵扣，真实现金流继续只计算 Advance Payment/Reversal 一次。

该规则通过仅前向 Migration 0067 和服务端命令共同失败关闭；升级前若存在不符合全额模式的 Advance 历史，Migration 必须停止，不得删除、覆盖或伪造补偿。Migration 0061 已有的同订单、同 Buyer、原记录必须为 Payment 的来源约束和 Migration 0066 已有的累计冲正上限继续保留，不重复重写历史 Migration。

本 Decision 不改变普通 Buyer Refund、Seller Settlement、Seller Allocation、利润公式、角色或权限，不授权 production/staging 部署、远程 D1/R2 写入或历史数据导入。

状态：Accepted by business owner；Supersedes only the partial Advance payment/reversal behavior permitted before D-043

### D-044 客户高风险身份操作与改密限流

Staff 的 canonical role 只提供默认能力，Personal `DENY` 必须继续最终优先。客户登录微信换绑属于高风险身份更正，只允许 ACTIVE `owner` 且有效权限仍包含 `BUYER_IDENTITY_HIGH_RISK_MANAGE`；卖家注册邀请的签发、受控读取与撤销只允许 ACTIVE `owner` 或 `seller_ops` 且有效权限仍包含 `SELLER_MANAGE`。只命中岗位而缺少有效权限时必须在读取或写入客户安全事实前失败关闭，前端可见性不构成授权。

已认证 Customer 修改密码必须在密码校验和幂等命令取得权威前，按服务端会话账户、脱敏网络来源和设备维度执行独立的固定窗口限流。限流键只保存带服务端 Secret 的不可逆哈希，超限返回稳定 `RATE_LIMITED` 和 `Retry-After`，追加脱敏安全事件，不读取或写入密码、凭据、幂等、Session 版本或业务事实。登录限流、邀请/重置限流与改密限流互不挤占额度。

该规则通过仅前向 Migration 0068 扩展既有 Customer security rate-limit 和 auth security-event 合同，并将当前发布候选提升为 Schema 68。Migration 必须完整保留已有邀请、密码重置、登录和安全事件事实，不修改 Migration 0001–0067。本 Decision 不改变“所有 ACTIVE Staff 可签发密码重置链接”的既有语义，不扩大角色默认权限，不授权 production/staging 部署、远程 D1/R2 写入、Secret、Access、DNS 或 Scheduler 操作。

状态：Accepted by business owner；Closes remaining Personal DENY bypasses and adds an independent password-change abuse boundary

### D-045 单一正式订单确认权威与旧卖家协议汇率退役

D-031 的卖家本金公式继续有效：正式订单只使用平台下单日对应币种的权威日基准汇率，加上当时有效且已确认的卖家本金汇率策略；组织覆盖优先于币种对默认，显式零加点与缺少策略必须区分，金额继续使用整数刻度、BigInt 与 `HALF_UP`。当前唯一正式订单确认权威固定为 Staff 订单证据审核通过事务；该事务必须同时完成证据状态、正式订单、买家汇率与服务费财务快照、卖家本金策略快照、卖家本金应付、不可变事件、Audit、幂等、Outbox 和最终断言。任何下单日日汇率或有效策略缺失都必须失败关闭且零部分业务写入。

本 Decision 仅覆盖 D-031 中“`SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED` 默认关闭、关闭时回退 0040 兼容计算路径、旧 Seller Agreement 字段保留为兼容投影”的过渡条款。当前代码、Contract、Seller DTO/UI、配置、Verifier 和数据库不得再保留旧 Seller Agreement Rate 作为备用或第二权威，也不得保留可绕过订单证据审核事务的并行正式订单确认服务。Seller 只读查看已锁定的下单日、基准汇率、策略范围/版本、加点、最终汇率、舍入规则和本金结果；Seller 不获得策略写权限，既有组织/Store Scope、Personal DENY、文件动态授权、Buyer/Seller/Staff DTO 隔离继续有效。

仅前向 Migration 0069 把当前候选提升为 Schema 69。执行前必须确认旧协议汇率版本、事件、多币种投影及引用这些事实的正式订单/财务快照存量全部为空；任一存量非空立即整体失败，不猜测转换、不删除、不回填、不导入历史业务。0069 以前向 rebuild 移除旧 FK、列、同步 trigger 和索引，再按依赖顺序删除旧表，并以完整对象断言、行数守恒、`changes()=1`、fresh/sequential/wrong-order/repeat/dirty-stock rollback、integrity 和 foreign-key 检查证明退役完成。Migration 0001–0068、D-001–D-044、历史 OpenSpec Change 与归档证据永久保持原文。

本 Change 不扩展 Seller Allocation、Outbox 语义、历史订单导入或其他 P2；不授权 production/staging 部署、远程 D1/R2、Secrets、DNS、Access 或真实业务数据操作。生产或 staging 若实际存在与“空存量”前提冲突的事实，必须停止并另开受权的数据对账与迁移 Decision。

状态：Accepted by business owner；Supersedes only D-031's compatibility flag, legacy fallback and retained Seller Agreement Rate projection, and advances the local candidate to Schema 69

## 上线前必须关闭的风险项

### R-001 Cloudflare Access真实策略验收

生产前必须验证真实 Access 应用、邮箱策略、Audience、JWKS、已知员工邮箱映射、撤销和故障恢复；本地测试不能替代真实策略验收。

### R-002 中国大陆访问

必须使用移动、联通、电信和微信内置浏览器实测门户和图片。

### R-003 个人信息跨境与保存期限

四类订单证据的 R2 热保存与 Google Drive 永久归档规则已由 D-019 确认。生产前仍须完成正式隐私告知、外部 AI 处理说明、普通客服附件与安全记录保存期限、删除/账号注销流程以及适用合规审查。

### R-004 平台政策风险

业务所有者已选择保留原评论/返款模式。需在决策记录和上线审批中持续明确，不得标记为“无风险”。

### R-005 历史数据迁移

旧数据只能先 AUDIT/PREVIEW，本地验证和人工批准后才能导入。

### R-006 Google Drive所有者账号连续性

第一版使用业务所有者控制的普通 Google Drive 账号。生产前必须完成账号恢复与多因素认证、专用归档目录、最小 OAuth Scope、Refresh Token 吊销/轮换、人工误删防护、容量告警和 D1 Manifest 定期巡检；账号失效或授权撤销时归档读取必须失败关闭并告警。

M7 只交付本地 Migration、合同、Adapter、mock、受控命令、真实 runner dry-run、测试与 Runbook，没有创建或使用真实 OAuth、Refresh Token、owner 目录或外部文件。真实 owner 授权、匿名 Provider PoC、MFA/恢复、目录/Scope/容量/轮换以及分阶段生产验收已转交 M10/最终老板外部激活清单；清单完成前所有归档开关必须 hard-disabled。OpenSpec 本地 Change 的归档不消除此未执行风险。

### R-007 前端首屏性能预算

M14 后的前端生产构建主包基线为 605.54 kB（gzip 167.31 kB），超过默认 500 kB 警告阈值。该风险不阻止 M14–M16 的功能集成，但必须按 D-029 的独立 Change 完成身份/路由按需加载、三类入口冷启动实测和回归验收，才能进入最终 Production GO；不得通过仅提高阈值关闭风险。

## 状态记录（2026-08-17，非决策）

以下仅记录已发生的事实，不构成新的架构决策，也不修改任何既有 D/R 条目：

- 迁移 `0070_buyer_refund_reminders.sql`（T7 买家发起的返款提醒）已合入 `main`；当前迁移链为 `0001`–`0070`，`app_schema_state.schema_version=70`（db:verify 实测 70 migrations / schema 70，见 `docs/CURRENT_SYSTEM_STATE.md`）。
- 本记录将 D-045 记载的 Schema 69 候选状态推进到 Schema 70 的既成事实；0069 退役条款不受影响。
- 权威 schema / migration 状态以 `migrations/` 连续 ledger 与 `docs/CURRENT_SYSTEM_STATE.md` 为准，不以本 Register 的数字为准。
