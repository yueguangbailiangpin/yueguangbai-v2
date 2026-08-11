# 月光白 V2 — 历史客户与网站账号开通冻结规则

日期：2026-08-11

本文件与 `docs/OPERATING_INTEGRITY_FREEZE.md` 配套；如与更早讨论冲突，以这两份最新冻结规则为准。

## 1. 历史客户绝不重新新增

已经存在于月光白业务数据中的历史客户，不允许通过“新增客户”重新创建。

- 历史买家保留原 `buyer_customer_id`、历史预约、正式订单、评论和返款事实。
- 历史卖家保留原 `seller_organization_id`、店铺、产品、需求、订单、评论和结算事实。
- 历史客户只补网站登录能力，不重建业务主体。
- 历史客户账号开通不计入“新增买家客户 / 新增卖家客户”。

## 2. 历史来源不补、不猜

已确认采用“历史不补渠道”。

- 不要求历史客户选择渠道1/2/3。
- 不默认归到任何新渠道。
- 没有真实来源归因时，Owner 经营看板显示 `历史客户 / 来源未知`。
- 历史客户后续新订单仍进入全站正式订单，但来源维度保持历史未知。

当 Owner 启用“精确渠道统计起始日”时，系统只把当时**仍然没有任何真实来源归因**的已有客户快照为历史来源未知。已经有真实归因的客户继续保留真实归因。

起始日以后的来源缺失属于“新系统归因异常”，不是历史未知。

## 3. 新买家流程

1. 售前先查询微信，确认不是当前 Marketplace 历史买家。
2. 输入微信、称呼、站点、匿名渠道编号并保存。
3. 成功保存 Buyer Lead，同时写入不可变 `acquisition_customer_intake_facts`。
4. 当天“新增买家客户 +1”从此不因 Lead 后续状态变化而回写。
5. 成功卡可直接生成 Buyer 注册链接。
6. 新买家注册链接绑定刚保存的 Buyer Lead。
7. 买家通过私人微信收到 7 天一次性链接。
8. 买家确认微信并设置密码；已有同一 Moonwhite 身份时按多 Persona 安全模型复用。
9. 注册邀请消费后 Buyer Customer 与原 Buyer Lead / 来源归因即时接通。
10. “买家网站注册 +1”按注册链接真正完成的日期统计，与新增客户日独立。

## 4. 历史买家流程

1. 售前在「历史客户 / 已有客户查询」输入微信。
2. 系统命中已有 Buyer Customer。
3. 页面显示站点、历史订单、`历史客户 / 来源未知`。
4. 如果没有网站账号：显示「开通买家网站」，只补登录能力。
5. 如果已有网站账号：从**具体 Buyer Customer** 发起密码恢复。
6. 普通售前不再使用 WeChat-only 通用密码恢复接口。
7. 不创建新 Buyer Lead，不计新增买家。
8. 如果同一 Marketplace 匹配多个 Buyer Customer，停止操作并提交 Owner 身份冲突处理。

## 5. 新卖家流程：业务主体与网站账号分开

这是 2026-08-11 经营完整性修正后的正式规则。

1. 卖家对接先查询历史卖家。
2. 输入微信、公司/客户名称、站点、匿名渠道并保存新 Seller Lead。
3. 成功保存时写入不可变“新增卖家客户”事实。
4. **Amazon JP 当前正式业务在保存 Seller Lead 的同一事务中建立 Seller Organization，并立即关联 Seller Lead。**
5. 此刻卖家已经是正式业务客户；是否开通网站不影响 Seller Organization 存在。
6. 成功卡可生成 Seller Portal 注册链接。
7. 注册链接只负责账号访问权限，不负责创建业务客户主体。
8. 客户完成链接和密码确认后才创建/复用主 OWNER Seller Member 与 `SELLER_MEMBER` Persona。
9. 如果同一微信已有 Moonwhite Buyer 账号，客户验证原密码后在同一个登录账号增加 Seller Persona，不创建第二套账号/密码。
10. “卖家网站开通 +1”按邀请真正消费日期统计。

当前 Seller Portal 真实业务仍以 `AMAZON_JP` 为主；US/KR 不伪造尚未上线的 Seller Portal 能力。

## 6. 历史卖家流程

1. 卖家对接在「历史客户 / 已有客户查询」输入微信。
2. 系统检查现有 Seller Member / Seller Organization、历史 `seller_partner_import_source_records`，以及 Owner 已确认的人工身份绑定。
3. 命中后复用原 Seller Organization。
4. 原店铺、产品、需求、订单、评论和结算全部保持原关联。
5. 如果已有有效 Seller Portal Persona：显示“网站账号已开通”，可从这个 Seller Organization 发起密码恢复。
6. 如果未开通：允许生成历史卖家网站开通链接。
7. 如果组织缺少主 OWNER，OWNER Member 只在客户完成邀请确认后建立。
8. 如果存在有效旧 Seller Invite，原 token 明文不可恢复；员工先撤销旧邀请，再生成新链接。
9. 不计新增卖家客户。
10. 如果身份无法唯一确认，停止操作并提交 Owner 身份冲突处理，不自动改绑。

## 7. 身份冲突处理

普通员工不能在多个历史候选中任选一个。

流程：

- 员工提交冲突 case
- Owner 在经营看板“异常待处理”查看
- Owner 用 Buyer Number / Seller Code / 公司名称 / 店铺等业务资料搜索历史主体
- 填写核验依据
- 系统追加 durable manual identity binding + audit event
- 后续历史查询自动应用这个人工确认结果

人工身份绑定只解决“这个微信对应哪个历史主体”，不补渠道、不迁移订单、不重建客户。

## 8. 重复客户保护按 Marketplace 生效

在同一个 Marketplace：

- 微信已对应活跃 Buyer Customer → 禁止重复新增 Buyer
- 微信已对应活跃 Seller / 历史 Seller import → 禁止重复新增 Seller

跨 Marketplace：

- 同一真实身份允许形成不同 Marketplace 的正式业务关系
- Lead 唯一性为 `客户类型 × Marketplace × 保护后的身份`

这为未来 Amazon US / Coupang 等真实上线保留正确边界。

## 9. 员工前端冻结

售前「买家客户」：

- 历史客户查询
- 身份冲突提交 Owner
- 新买家客户
- 新客户保存 → 生成买家注册链接
- 已开通具体 Buyer Customer → 密码恢复

卖家对接「卖家客户」：

- 历史客户查询
- 身份冲突提交 Owner
- 新卖家客户（保存即建立正式 Seller Organization，当前 JP）
- 新客户保存 → 检查 / 生成卖家注册链接
- ACTIVE 旧邀请 → 撤销后重发
- 已开通具体 Seller Organization → 密码恢复

普通员工只看到匿名渠道编号，不显示真实开发来源。

## 10. 当前 Schema

客户门户基础：

- `0049_customer_portal_onboarding.sql`
- `0050_buyer_invitation_lead_attribution.sql`

经营完整性补充：

- `0051_business_integrity_reporting_scope.sql`
- `0052_identity_resolution_and_reporting_ops.sql`
- `0053_operating_integrity_guards.sql`

当前目标 Schema Version：**53**。
