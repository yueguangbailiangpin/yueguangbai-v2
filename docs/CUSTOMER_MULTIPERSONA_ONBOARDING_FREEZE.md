# 月光白 V2 — 买家 / 卖家多身份账号开通冻结规则

日期：2026-08-11

本文件是客户账号开通的最高优先级安全补充。

## 核心原则

同一个微信代表同一个月光白登录身份时，不允许因为客户同时拥有 Buyer 与 Seller 身份而创建两个独立登录账号。

`customer_account_personas` 是运行时身份权限事实；`customer_login_accounts.account_type` 仅保留兼容意义，不能作为唯一权限来源。

## 已有买家账号 → 开通卖家身份

如果 Seller 注册邀请中的微信已经存在有效月光白 Buyer 登录账号：

1. 员工发出 Seller 注册邀请本身不得提前授予 Seller 权限。
2. 注册页面明确提示“检测到已有月光白账号”。
3. 客户输入现有月光白账号密码并再次确认。
4. 后端验证现有密码。
5. 验证成功后才创建/激活 Seller Organization OWNER Member 关系。
6. 在同一 `customer_login_accounts` 上新增 `SELLER_MEMBER` Persona。
7. 不创建第二个登录账号，不生成第二套密码。
8. 客户随后可以使用同一微信 + 同一密码进入 Buyer 或 Seller Persona。

## 没有月光白账号 → 新建卖家账号

如果微信没有现有月光白登录账号：

1. 客户通过 Seller 一次性邀请进入注册页。
2. 设置新密码。
3. 完成 WeChat Identity / Seller OWNER Member / `SELLER_MEMBER` 登录账号与 Persona。
4. 自动建立 Seller Session 并进入 Seller Portal。

## 为什么 Seller Member 延迟到客户确认

迁移 0030 的数据库触发器会在 Seller Member 与已有登录账号共享同一 identity subject 时自动形成 `SELLER_MEMBER` Persona。

因此 Seller 邀请签发阶段不得提前把新 Seller Member 绑定到已有 Buyer identity subject；否则客户还没确认注册链接就可能获得 Seller Persona。

当前实现：

- 邀请签发阶段只创建/复用 Seller Organization 与待开通邀请。
- Seller Member 的最终 identity 绑定在客户完成邀请和密码确认的事务中形成。

## 历史卖家

历史 Seller Organization 继续复用原组织。

- 已经有有效 Seller Portal Persona：员工页面显示“账号已开通”，不再签发首开链接。
- 没有 Portal Persona：允许生成历史卖家账号开通链接。
- 有明确匹配的历史 Seller Member 时复用该 Member。
- 没有主 Member 的历史导入组织，在客户确认链接后创建第一个 OWNER Member。
- 如果历史 Member 身份与当前微信存在冲突，不自动猜测或改绑，拒绝并要求后续人工身份处理。

## 经营统计

“买家网站注册”和“卖家网站开通”按对应注册邀请真正 `CONSUMED` 的北京时间日期统计，而不是按底层 login account 最初 created/activated 日期统计。

这保证多身份场景正确：

- 去年已有 Buyer 账号，今天完成 Seller 邀请 → 今天卖家网站开通 +1。
- 原有 Seller 账号，今天通过 Buyer 邀请新增 Buyer Persona → 今天买家网站注册 +1。

新增客户指标仍完全独立，只按 Buyer/Seller Lead 成功录入日期计算。
