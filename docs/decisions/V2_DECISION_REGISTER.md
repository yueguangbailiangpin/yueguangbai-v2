# V2 决策登记

## 已确认

### D-001 技术路线

```text
Feishu + Private WeChat + Cloudflare Workers/D1/R2
              + Google Drive cold archive
```

状态：Accepted

### D-002 私人微信

私人微信是主要日常沟通渠道，但不是正式数据源。第一版不开发微信自动化。

状态：Accepted

### D-003 门户消息

第一版门户只做问题反馈和资料补充，不开发完整多轮实时聊天。

状态：Accepted

### D-004 飞书

飞书用于员工身份、任务摘要、队列和提醒。D1 是任务和权限权威源。

状态：Accepted

### D-005 数据和图片

D1 是唯一权威业务数据库和文件授权/Manifest 来源。R2 是正式热图片源；满足 D-019 归档条件的文件迁移到 Google Drive 后，Google Drive 是永久冷归档源。客户和员工只能通过月光白受控文件接口读取，不公开 R2 Key、Google Drive 文件 ID 或裸链接。

状态：Accepted

### D-006 员工角色

六类基础角色，员工可多角色。部门负责人使用权限包和团队范围，不新增固定角色。

状态：Accepted

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

状态：Accepted

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

状态：Accepted

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

## 上线前必须关闭的风险项

### R-001 飞书免费版和 API 实测

必须完成匿名 PoC，不能依赖未经验证的额度记忆。

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
