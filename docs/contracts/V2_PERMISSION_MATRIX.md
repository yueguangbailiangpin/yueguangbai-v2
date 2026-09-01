# V2 权限矩阵

## 1. 内部角色

- `owner`：总管理员
- `pre_sales`：售前（买家运营）
- `seller_ops`：卖家对接（卖家运营）
- `buyer_refund`：买家返款（评论与返款）

当前 canonical Staff 角色严格为上述四个（D-056；`acquisition` 随获客 CRM
退役，只允许作为已撤销审计事实保留）。每名 ACTIVE Staff 恰有一个 ACTIVE
角色。后端遇到零角色、多角色、旧角色或未知角色时失败关闭，不签发 Staff
Session。历史 `seller_support`、`buyer_support`、`after_sales` 同样只作为
已撤销审计事实保留。

分配是固定绑定（无公共池/轮转/兜底/排班/重分配）：买家分别绑定售前负责人
与返款负责人，卖家组织绑定卖家运营负责人，owner 全局查看处理；缺绑定失败
关闭。阶段 6.6E 起 owner 通过 access-management 管理两类买家负责人
（`GET /api/staff/access-management/buyer-assignments` 同时返回
`pre_sales_owner` 与 `refund_owner`；设置/更换分别走
`POST .../buyer-pre-sales-assignments` 与 `POST .../buyer-assignments`，
均需 reason、幂等与 expected_assignment_version），并可设置/撤销指定员工的
Personal DENY（`GET/POST /api/staff/access-management/personal-denies`、
`POST .../personal-denies/revoke`；DENY 只能缩小权限，全部变更写审计并
提升 authorization_version 立即生效）。

阶段 6.6E 买家建档与邀请：员工建档（`POST /api/staff/buyer-customers`，
需 `BUYER_CREATE`）事务内立即分配 B/C 编号并自动绑定初始售前负责人，新档案
未激活不能登录；邀请签发必须绑定既有未激活买家（微信身份与 Marketplace 一致
校验，不一致 409）；邀请注册只认领并激活被绑定的既有档案，绝不创建第二个
买家或新编号，无法安全映射的旧邀请 fail closed。

所有 ACTIVE Staff 均可在可信 Staff Session 下签发、查看和在使用前撤销普通
Buyer 邀请，也可在完成人工微信核验并记录核验说明后签发一次性 Customer 密码
恢复凭证。Staff API 不接受、不返回也不可读取 Customer 新旧密码。身份合并、
微信冲突、Persona 归属冲突和 Marketplace 高风险纠错仍只允许 owner 治理流程处理。

## 2. 权限计算

```text
有效权限
=
唯一角色默认权限
- 个人明确禁用
- 系统硬禁止
```

历史 Personal `GRANT` 与部门/团队负责人权限包仅保留审计和兼容读取，不参与当前
effective permissions；它们不得扩张 canonical role 的默认能力。Personal `DENY`
仍在角色默认能力之后扣除并最终优先。

之后继续应用：

- 部门/团队范围；
- 客户范围；
- 卖家组织范围；
- 店铺范围；
- 资源归属；
- 字段投影。

## 3. 角色默认能力

### owner

全系统管理、身份冲突、合并、权限、财务冲正、导出和审计。

### pre_sales

- 查看公开需求、预约和待核对订单；
- 创建普通买家；
- 激活无冲突买家；
- 审核预约；
- 确认正式订单；
- 可读取订单确认前检出的汇率缺项，但不得填写、确认或回写订单日基础汇率；
- 高风险身份纠正仍只允许 owner，售前不得因角色合并获得该权限；
- 查看订单截图；
- 不查看卖家内部利润；
- 不执行已完成财务更正。

### seller_ops

- 卖家组织、成员、店铺和产品；
- 新品审核；
- 需求批次审核和发布；
- 仅在拥有 `SELLER_MANAGE` 且被 canonical ACTIVE `SELLER_ACCOUNT_MANAGER` 分配到该卖家组织时，提交该组织卖家本金加点草案；不得填写基础订单日汇率、提交默认加点或确认任何汇率/加点；
- 服务费规则变更申请；
- 卖家侧订单与结算；
- 不查看买家微信、买家返款和内部利润。

### 产品预约排期专项边界

- 角色硬门禁始终仅允许 `owner`、`seller_ops`：产品申请 `REJECT` 只要求 `PRODUCT_REVIEW`，`APPROVE` 额外要求 `DEMAND_PUBLISH`；需求 `REJECT`、`CLOSE` 只要求 `DEMAND_PUBLISH`，`PUBLISH` 额外要求 `PRODUCT_REVIEW`。
- 产品创建、新增产品版本节奏、排期预览/确认仍同时要求 `PRODUCT_REVIEW`、`DEMAND_PUBLISH`，并校验权威卖家组织/店铺 Scope；基础拒绝/关闭动作不得被 M16 的双权限额外收紧。
- `pre_sales` 只在有效 Buyer/Customer Scope 内查看稳定排名、预约时间、预计日期和最小买家标识；身份字段继续按 Buyer Scope 投影。
- `buyer_refund` 即使获得个人额外授权也不得修改产品版本或排期，系统硬禁止优先。
- Personal DENY、角色权限、卖家组织/店铺 Scope、Buyer/Customer Scope 和资源归属都在服务端逐次校验；产品申请、需求审核上下文及需求审核在读出权威 Source 后重新解析当前授权并校验权威卖家组织，不能只信工作项元数据。
- Buyer/Seller Session 与门户不得读取内部排名、其他买家、预计日期、排期版本或 Staff 数据。

### buyer_refund

- 查看买家订单、评论、返款和必要图片；
- 评论审核；
- 买家返款；
- 普通差额录入；
- 已完成财务不可改；
- 只读取完成上述职责所必需的买家资料；
- 不查看卖家内部协议、员工管理、高风险身份、系统管理或内部利润。

### 阶段 7.5 员工订单与工作台

- 员工正式订单游标列表与统一订单详情遵循同一固定分配可见性：owner 全局；pre_sales 仅其 `BUYER_PRE_SALES_OWNER` 买家、buyer_refund 仅其 `BUYER_REFUND_OWNER` 买家、seller_ops 仅其 `SELLER_ACCOUNT_MANAGER` 卖家组织的订单（另与 marketplace scope 取交集）；Personal DENY 始终优先；越权对象 concealed 404；无公共池/抢单/轮转/兜底。
- 订单 `responsibility` 分区（业务阶段/负责员工/下一步/截止/逾期/异常）由后端权威计算；`GET /api/staff/me/work-items/summary` 的今日应处理返款金额仅 owner 与 buyer_refund 可见，其余角色为 null。

### 公司公开客服渠道与买家联系人（阶段 7.5 第二批 + 7.5R）

- 7.5R：二维码为受控文件（`SERVICE_CHANNEL_QR`/`BUYER_VISIBLE`/`SERVICE_CHANNEL` 实体）。Owner 上传走 purpose-bound intent 路由，挂载/清除走 `POST /api/staff/service-channels/:code/qr`（幂等、版本守卫、全链校验、清除 revoke link）；员工读取需 `STAFF_MANAGE`；任意 ACTIVE 买家会话可读（read-intent 动态公开窗口），卖家不可读；买家 DTO 仅暴露 `SafeFileReference|null`，不含内部文件编号。

- 渠道配置（`BUYER_PRE_SALES`/`BUYER_AFTER_SALES`）独立于员工身份，仅 owner（`STAFF_MANAGE`）可修改（幂等+expected_version+审计）；初始为空，未配置时买家端显示兜底文案且不泄露任何员工内部字段。
- 买家端仅见当前阶段负责员工公开显示名与公司渠道公开字段；产品主要对接人是责任标记，不缩小组织可见性（owner 与负责 seller_ops 可操作，跨组织 concealed 404）。

### 卖家结算批次（阶段 7.5 第三批）

- owner 全局创建/确认/取消/导出；被分配该卖家组织的 seller_ops 在范围内同权（写需 `SELLER_SETTLEMENT_RECORD`，读需 `SELLER_SETTLEMENT_VIEW`）；Seller 门户批次列表/详情由下方端点级矩阵约束；Buyer 在 Seller 批次边界收到 concealed `404`。
- 批次不暴露内部利润、买家返款、内部员工 ID、内部备注或对象存储 key；CSV 导出白名单字段、RFC 4180 引号转义并中和公式注入。
- 7.5R：导出为幂等命令（Idempotency-Key + 请求哈希 + 可选 expected_version；首次流式返回文件并在响应头带行数/SHA-256，同键重放返回收据 JSON；BATCH_EXPORTED 审计仅一次；超 5,000 行或 2 MiB 在响应前 409 `EXPORT_TOO_LARGE`；跨组织 concealed 404）；成员读取 keyset 分页（`members_limit`/`members_cursor`）；卖家门户使用专用 strict DTO（无组织 ID/版本/取消元数据/内部成员 ID），DRAFT/CANCELLED 在 SQL 内过滤后才分页。

### 经营看板权限（阶段 4 简化后）

- 经营看板两个只读端点（`summary`、`financial-projection`）仅允许 Active owner 且
  持有 `FINANCIAL_VIEW`，Personal DENY 最终优先；无该权限或被个人禁用时失败关闭。
- 看板只读后端业务事实与人工获客事实，不允许手工填写任何业务数字；Owner 财务
  摘要复用正式内部财务公式（含审计过的人工利润调整）。复杂漏斗、趋势分析和
  drill-down 已退役，非 owner 岗位不获得看板任何数据。

### Marketplace 运行边界（阶段 4 统一后）

- 运行时 marketplace 合同只接受 `AMAZON_JP`、`AMAZON_US`、`COUPANG_KR` 三个注册
  码；历史 `JP` 短码只存在于阶段 6 历史导入映射层，任何新 API 合同不接受。
- `AMAZON_JP` 是当前唯一允许真实业务写入的 marketplace；`AMAZON_US`、`COUPANG_KR`
  保持 fail-closed（注册表禁用/适配器不可用），在显式开通前任何写入路径失败关闭。

### 汇率中心财务权限

- 基础订单日汇率只能由同时拥有 `SELLER_MANAGE`、`FINANCIAL_CORRECT` 和 GLOBAL Scope 的 Owner 填写并确认；基础汇率按 Amazon `amazon_order_date` 与币种对维护。
- 默认卖家本金加点仅由同一 Owner 提交；组织专属加点只能由被分配组织的 `seller_ops` 提交。无论范围，确认或拒绝基础汇率、默认加点或组织专属加点都只允许 Owner + `FINANCIAL_CORRECT`。
- 组织专属覆盖优先于默认值；显式 `0` 是有效覆盖，不得按缺失值处理。正式订单冻结订单日基础汇率、加点版本和值，历史快照不可回写。

历史映射为 `owner→owner`、`pre_sales→pre_sales`、
`seller_ops→seller_ops`、`after_sales→buyer_refund`。
`buyer_support→pre_sales` 与 `seller_support→seller_ops` 只有在总管理员对
具体员工、目标角色、有效权限差异及版本化哈希逐一批准后才可激活。

## 4. 历史部门负责人权限包

以下能力仅描述历史职责包和审计事实，不参与当前 effective permissions。当前需要这些
能力时必须由 canonical role 默认能力明确承载，不得通过旧 Team/Leader 记录恢复授权。

负责人可在团队范围内：

- 查看未领取任务；
- 分配、改派和接管；
- 添加协作者；
- 调整优先级和截止时间；
- 查看团队工作量和逾期情况。

负责人不自动获得：

- owner；
- 客户合并；
- 身份冲突释放；
- 财务冲正；
- 全局导出；
- 跨部门隐私。

## 5. 卖家组织成员

### 5.1 Seller 结算读取端点级矩阵（2026-08-30）

D-056 与本表的组织级可见性语义仍然成立，但不能替代具体端点的字段投影和
敏感财务字段门禁。以下是当前 Seller Portal 的七个读取端点的有效矩阵：

| 端点 | 允许角色 | 越权/隔离行为 | 字段边界 |
| --- | --- | --- | --- |
| `summary` | `OWNER`, `FINANCE` | `OPERATIONS`/`VIEWER` concealed `404`；跨组织不适用 | Seller-safe 结算摘要；不含内部利润、买家返款、内部备注或对象 key |
| `payables` | `OWNER`, `FINANCE` | `OPERATIONS`/`VIEWER` concealed `404`；跨组织列表为空 | Seller-safe 应付读取，按组织隔离并支持 cursor 分页 |
| `payables/:id` | `OWNER`, `FINANCE` | `OPERATIONS`/`VIEWER` concealed `404`；跨组织 concealed `404` | 单笔 Seller-safe 应付字段；不扩展内部财务字段 |
| `payments` | `OWNER`, `FINANCE` | `OPERATIONS`/`VIEWER` concealed `404`；跨组织列表为空 | Seller-safe 打款读取，按组织隔离并支持 cursor 分页 |
| `payments/:id` | `OWNER`, `FINANCE` | `OPERATIONS`/`VIEWER` concealed `404`；跨组织 concealed `404` | 单笔 Seller-safe 打款字段；不扩展内部账户/利润字段 |
| `batches` | `OWNER`, `OPERATIONS`, `FINANCE`, `VIEWER`（均须 ACTIVE） | 其他组织 concealed `404`；`DRAFT`/`CANCELLED` 不可见；Buyer concealed `404` | 专用 Seller-safe 批次列表 DTO |
| `batches/:id` | `OWNER`, `OPERATIONS`, `FINANCE`, `VIEWER`（均须 ACTIVE） | 其他组织或不可见状态 concealed `404`；Buyer concealed `404` | 专用 Seller-safe 批次详情 DTO，不含内部员工 ID、内部利润、买家返款、内部备注或对象 key |

未认证、会话无效或 Seller 成员已禁用时，端点返回 `401`；有效但角色不足的
五个旧财务端点返回 concealed `404`。批次端点的 Buyer 账户不再落入 Seller
actor 的 `403`，而是在该边界统一返回 `404`。这段端点级规则是对 D-056
组织级历史语义的后续收敛，不改写其历史记录。

### OWNER

授权店铺范围内全部产品、订单、图片、消息和结算读取；成员管理；唯一允许财务导出。
结算五个旧财务端点与 Seller-safe 批次均可读。

### OPERATIONS

授权店铺内产品、订单、图片、业务消息和 Seller-safe 批次；不看旧财务端点；不管理成员；不导出。

### FINANCE

授权店铺内基础订单、本金、服务费、五个旧结算财务端点和 Seller-safe 批次；不写消息；不管理成员；不导出。

### VIEWER

只读授权店铺基础业务和 Seller-safe 批次；无五个旧财务端点、写消息、新品提交和成员管理。

## 6. 系统硬禁止

无论个人授权如何都禁止：

- 非 OWNER 卖家成员导出财务；
- 卖家查看买家微信和买家返款；
- 卖家查看内部利润和内部备注；
- 买家查看卖家协议、服务费规则和内部利润；
- 非 owner 直接修改内部财务；
- 已完成财务直接编辑或删除；
- 飞书直接修改正式业务状态。
- Staff 查看、指定或恢复 Customer 密码；
- 非 owner 合并 Customer Account、释放冲突微信号或改写 Persona 归属；
- Buyer/Seller Session 跨 Persona 或跨组织读取数据。
