# V2 权限矩阵

## 1. 内部角色

- `owner`：总管理员
- `acquisition`：获客
- `pre_sales`：售前
- `seller_ops`：卖家对接
- `buyer_refund`：买家返款

当前 canonical Staff 角色严格为上述五个；`acquisition` 由 Migration 0044
引入。每名 ACTIVE Staff 恰有一个 ACTIVE 角色。后端遇到零角色、多角色、旧角色或
未知角色时失败关闭，不签发 Staff Session。历史 `seller_support`、
`buyer_support`、`after_sales` 分配只允许作为已撤销审计事实保留。

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

### acquisition

- 在本人 Marketplace Scope 内操作客户开发中心：查看内部渠道和来源、买卖双方漏斗、
  渠道统计、日咨询记录及其历史；无 Scope 时不返回业务记录，越 Scope 的单条历史返回 404。
- 在本人 Marketplace Scope 内创建、查看和更新 Prospect，记录信号和人工交接；可对
  现有 Lead 作带原因、可审计的来源更正。来源更正新增更正记录，不改写原始来源。
- 该操作员门禁只允许 `owner` 或 `acquisition`，不能由个人额外授权替代；每次请求仍由
  后端重算 ACTIVE 角色和 Marketplace Scope。
- 不具有 `ACQUISITION_ADMIN`、`ACQUISITION_BUYER_LEAD` 或
  `ACQUISITION_SELLER_LEAD` 默认权限：不得管理渠道、渠道分配/生效期、接待微信、
  留存豁免或机器凭证；也不得创建、查看或管理正式 Buyer/Seller Lead。

### pre_sales

- 查看公开需求、预约和待核对订单；
- 创建普通买家；
- 激活无冲突买家；
- 审核预约；
- 确认正式订单；
- 维护买家日汇率；
- 高风险身份纠正仍只允许 owner，售前不得因角色合并获得该权限；
- 查看订单截图；
- 不查看卖家内部利润；
- 不执行已完成财务更正。
- 只能建立和管理本人或授权团队范围的 Buyer 获客线索；渠道由后端按有效期解析。

### seller_ops

- 卖家组织、成员、店铺和产品；
- 新品审核；
- 需求批次审核和发布；
- 卖家协议汇率变更申请；
- 服务费规则变更申请；
- 卖家侧订单与结算；
- 不查看买家微信、买家返款和内部利润。
- 只能建立和管理本人或授权团队范围的 Seller 获客线索；不获得 Buyer 漏斗或利润投影。

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
- 不建立、查看或管理 Buyer/Seller 获客线索。

### 获客专项权限

- `ACQUISITION_ADMIN`：仅 owner，用于渠道、Staff 渠道生效期、北京日咨询人数登记/更正和留存豁免。
- `ACQUISITION_BUYER_LEAD`：owner 和 pre_sales 默认权限，仍受个人 DENY 与数据范围限制。
- `ACQUISITION_SELLER_LEAD`：owner 和 seller_ops 默认权限，仍受个人 DENY 与数据范围限制。
- `acquisition` 没有上述三项默认权限。其客户开发中心访问是独立的
  `owner`/`acquisition` 角色门禁，不授予 owner 管理权或正式 Buyer/Seller Lead 职责。
- `buyer_refund` 没有任何获客默认权限；Personal DENY 始终在角色默认权限之后扣除。

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

### OWNER

授权店铺范围内全部产品、订单、图片、消息和财务；成员管理；唯一允许财务导出。

### OPERATIONS

授权店铺内产品、订单、图片和业务消息；不看财务；不管理成员；不导出。

### FINANCE

授权店铺内基础订单、本金和服务费；不写消息；不管理成员；不导出。

### VIEWER

只读授权店铺基础业务；无财务、写消息、新品提交和成员管理。

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
