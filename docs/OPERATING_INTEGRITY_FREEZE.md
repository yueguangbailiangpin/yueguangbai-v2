# 月光白 V2 — 经营完整性 12 项改进冻结规则

日期：2026-08-11

状态：已纳入 `feature/frozen-portals-staff-acquisition-core` 实现。

本文件记录下列 12 项在 Schema 64 的验收事实，不自行覆盖更高权威文档。当前权威与冲突处理遵循根目录 `AGENTS.md` 的顺序。

## 1. 新增客户是不可变经营事实

售前成功保存 Buyer Lead、卖家对接成功保存 Seller Lead 的瞬间，系统写入 `acquisition_customer_intake_facts`。

此后即使：

- Lead 被 INVALIDATED
- Lead 被 ANONYMIZED
- 渠道被停用
- 员工岗位变化

过去某天的“新增买家客户 / 新增卖家客户”都不得回写减少。

Lead 状态代表客户后续状态；客户登记事实代表当时真实发生过的经营事件。两者不能混为一谈。

## 2. 精确渠道统计起始日

Owner 在经营看板一次性确认 `precision_started_business_date`。

启用时：

- 已有且没有任何真实来源归因的客户，被快照为 `历史客户 / 来源未知`。
- 已经拥有真实来源归因的客户保留真实来源，不得错误降级为历史未知。
- 起始日以后，来源缺失不再算“正常历史未知”，而是 `新系统归因异常`。
- 起始日一经确认不能静默改写。

因此 Owner 看板必须区分：

- 历史来源未知：正常历史口径
- 新系统归因异常：需要处理的数据错误

## 3. 密码恢复必须绑定具体客户、岗位和站点

日常员工不再使用“仅凭微信号”的通用密码恢复入口。

正式入口：

- 售前：只能从具体 Buyer Customer 发起
- 卖家对接：只能从具体 Seller Organization 发起
- Owner：两者都可以
- 获客 / 买家返款：不能发起

后端重新校验 Staff Marketplace。

如果同一个 Moonwhite 登录账号同时拥有 Buyer + Seller Persona：

- 页面必须提示影响范围
- 密码恢复仍然是同一个登录账号的密码恢复
- 完成重置后旧会话按既有安全机制失效

旧通用 WeChat-only Staff reset endpoint 只保留给 Owner 作为紧急兼容入口。

## 4. 卖家业务主体与卖家网站账号彻底分开

正式卖家客户保存成功时：

1. 写入 Seller Lead / 不可变新增客户事实
2. Amazon JP 当前正式业务同时创建 Seller Organization
3. Seller Organization 立即与 Seller Lead 建立关联和首次来源归因

“是否生成 Seller Portal 注册链接”不决定这个卖家是不是正式客户。

Seller 注册链接只负责：

- 客户确认身份
- 创建 / 复用 OWNER Seller Member
- 创建 / 复用 Moonwhite Login Account
- 激活 SELLER_MEMBER Persona

因此客户永远不注册网站，也不影响 Seller Organization 作为业务主体存在。

## 5. Seller 注册邀请必须有完整生命周期

员工可以：

- 生成邀请
- 查看邀请状态
- 撤销有效邀请
- 撤销后重新生成
- 识别已过期 / 已使用邀请

Token 只保存 hash，不能恢复历史注册链接明文。

Staff 刷新页面后，如果发现仍有一个 ACTIVE Seller Invite：

- 页面提示“原链接明文不可恢复”
- 可以先撤销旧邀请
- 再生成一条全新链接

不得为了方便而把注册 token 明文保存进数据库。

## 6. 同岗位同站点允许多人，但只保留一个主负责人

`Role × Marketplace` 不再限制只能存在一个员工。

规则：

- 第一个有效员工 = PRIMARY（主负责人）
- 后续同岗位同站点员工 = SUPPORT（协助）
- 同一 Role × Marketplace 只能有一个 ACTIVE PRIMARY
- 主负责人停用时自动从 ACTIVE SUPPORT 中提升一人
- 唯一员工停用后再重新启用、且没有其他 PRIMARY 时，自动恢复 PRIMARY

员工管理前端只展示：

- 主负责人
- 协助

不增加：

- 排班
- Availability
- 抢单
- 任务派工
- Team 管理

## 7. 历史客户身份冲突有 Owner 人工处理出口

普通员工查历史客户时，如果同一 Marketplace 命中多个可能主体：

- 停止注册 / 恢复操作
- 不允许普通员工选一个“猜”
- 提交 `customer_identity_resolution_case`

Owner 的“异常待处理”可以：

- 搜索 Buyer：Buyer ID / Buyer Number / 名称
- 搜索 Seller：Seller ID / Seller Code / 公司名称 / 店铺名称
- 核对历史订单数量和站点
- 填写人工确认依据
- 建立 append-only / audited manual binding

人工绑定：

- 只解决身份定位
- 不重建客户
- 不迁移历史订单
- 不补获客渠道

## 8. 来源纠错必须追加历史，不能直接覆盖原始来源

Owner / 获客可以在「客户开发 → 来源纠错」中修正误选渠道。

系统记录：

- 原始渠道
- 上一次有效渠道
- 新渠道
- 操作 Staff
- 原因
- 时间

`acquisition_lead_source_corrections` 只允许 INSERT，不允许 UPDATE / DELETE。

经营统计和员工匿名渠道显示使用最后一次确认来源；原始来源永久保留用于审计。

更正渠道必须与客户：

- 同 Marketplace
- 同 Buyer/Seller audience（或 BOTH）

## 9. 每日咨询人数：未填绝不等于 0

获客每日渠道数据：

- 没有记录：显示 `未填`
- 人工明确填写 0：显示 `0`

渠道统计返回：

- `consultation_data_complete`
- `consultation_days_recorded`
- `consultation_days_expected`

只有完整填写时，才把咨询人数作为可解释的转化分母。

Owner / 获客不能把“忘记填数据”误解为“当天没有咨询”。

## 10. 买家来源利润与卖家来源利润是两个视角，不能相加

一张正式订单可以同时归因：

- Buyer source channel A +1 order
- Seller source channel B +1 order

渠道分析分别展示：

- 买家来源订单 / 预计利润 / 完成利润
- 卖家来源订单 / 预计利润 / 完成利润

但这是对同一公司经营事实的两个 attribution lens。

**绝对不能**把 Buyer-source profit + Seller-source profit 相加称为公司总利润。

公司总利润只来自正式财务事实表，仍由 Owner 经营看板现有财务模型统计一次。

## 11. Owner 只有一个极简异常待处理，不新增 ERP

经营看板顶部展示三类：

- 身份冲突
- 新系统归因异常
- 财务冲突

这只是经营完整性入口，不是新的 Staff Task System。

不新增：

- SLA
- 排班
- 优先级调度
- 消息中心
- 新任务派发体系

历史来源未知不属于异常，不显示为红色错误。

## 12. 第二 Marketplace 前置数据模型

Lead ACTIVE 唯一性正式改为：

`Customer Type × Marketplace × Protected Identity`

因此同一个微信可以合法存在：

- Amazon JP Buyer relationship
- Amazon US Buyer relationship

而不会被旧的全球 Lead 唯一索引拦截。

数据库唯一索引和服务层规则必须一致。

Seller 增加：

- `seller_customer_groups`
- `seller_customer_group_marketplaces`

含义：

- Global Seller Customer Group = 同一真实卖家
- Seller Organization = 该卖家在具体 Marketplace 的业务实体

当前已有 JP Seller Organization 自动获得自己的 Group。

本阶段不伪造 Amazon US / Coupang Seller Portal 业务能力；在第二真实 Marketplace 上线时，可以把对应 Seller Organization 加入同一个 Group，而不重写 JP 历史订单。

## 当前 Schema

新增迁移：

- `0051_business_integrity_reporting_scope.sql`
- `0052_identity_resolution_and_reporting_ops.sql`
- `0053_operating_integrity_guards.sql`

当前目标 Schema Version：**53**。

## 验收原则

本地 Codex 修复旧测试时必须遵守：

1. 旧测试与本文件冲突时，更新旧测试，不回滚本文件规则。
2. 历史 D1 副本升级到 Schema 53 后，原 Customer / Seller / Order 主键和历史关联不得改变。
3. 禁止通过“为了让测试绿”恢复：全球 Lead 唯一、单 Staff Role×Marketplace、ACTIVE Lead 即历史新增数、WeChat-only 普通员工密码恢复、Seller invite 时才创建 Seller Organization 等旧逻辑。
