# V2 身份、唯一性与编号

## 1. 微信号规范化

买家和卖家成员微信号进入唯一性比较前执行：

1. Unicode NFKC；
2. 去除首尾空白；
3. 大小写不敏感比较；
4. 拒绝控制字符和内部空白异常。

保存：

- 原始展示值；
- 规范化值；
- 来源；
- 生效时间；
- 失效时间；
- 验证状态。

有效微信号在买家和卖家成员身份域中全局唯一。

一个规范化微信号只对应一个 Customer Identity Subject、一个登录账号和
一套密码。Buyer Profile 与 Seller Organization Member 是该账号下相互
隔离的 Persona；同一账号可同时具备二者，但当前 Session 每次只激活一个
Persona。服务端按 Buyer/Seller 路由重新解析对应主体，不以历史
`customer_login_accounts.account_type` 作为权限权威。

## 2. 微信号变更

旧微信号进入保留状态，不立即释放。只有 owner 完成人工核验后才能释放给其他身份。

普通无冲突新买家可由售前激活。以下仅 owner 处理：

- 买家/卖家成员身份冲突；
- 合并；
- 错误归属；
- 旧微信号释放；
- 历史编号纠正。

## 3. 买家编号

买家注册后只属于一个 Marketplace，不能自行切换。只有同时具备 `owner` 角色与 `BUYER_IDENTITY_HIGH_RISK_MANAGE` 权限的员工，才能在任何预约、订单资料、正式订单、评论或财务事实产生前执行幂等、带版本和原因的受控纠错；纠错后追加不可变前后值审计。已有正式事实时，应用条件更新与数据库触发器均拒绝跨站改写。

Buyer 注册只接受 ACTIVE Staff 签发的七天一次性邀请。邀请绑定规范化微信号
和唯一 Marketplace；页面读取不消费邀请，成功注册在同一事务中激活 Persona、
签发 Session 并消费邀请。已使用、过期、撤销、绑定不符或身份冲突均失败关闭。
邀请签发即代表普通无冲突 Buyer 已批准，不增加第二次人工审批。

格式：

```text
YYYYMMDD + 渠道代码 + 渠道独立序号
```

规则：

- 在第一张有效正式订单确认时生成；
- 日期为第一张有效正式订单的中国业务日期；
- B、C 等买家联系渠道分别维护序号池；
- 序号原子分配；
- 已分配序号永久不复用；
- 普通员工不能手工填写新 V2 编号；
- 历史旧编号原样保留，包括未补零日期。

## 4. 卖家编号

渠道：

- `ido-mango`
- `ygbceping`
- `yueguangbaiai`

格式：

```text
渠道前缀-渠道独立序号
```

规则：

- 每个渠道独立序号池；
- 原始渠道、当前渠道和转移历史分别保存；
- 转渠道不修改既有卖家编号；
- 已分配序号不复用。

## 5. Seller Organization

一个卖家客户对应一个全局 Seller Organization。主微信默认属于 OWNER，其他成员使用各自微信；Marketplace 归属于 Store，而不是 Organization。

同一 Customer Identity Subject 最多只能拥有一个有效 Seller Organization
Membership；Buyer Persona 不改变这一限制，也不得把全局 Organization 重新绑定
到单一 Marketplace。

后备用户名：

```text
seller-code-member-number
```

## 6. 平台产品标识

唯一键：

```text
marketplace_code + normalized_platform_product_identifier
```

规范化：

- NFKC；
- trim；
- uppercase；
- Amazon Marketplace 使用标准 ASIN 格式校验。
- 未批准真实规则的 Marketplace Adapter 必须失败关闭，不得臆造格式。

同 Marketplace 的规范化平台产品标识只能归属一个权威店铺。跨店铺冲突不向卖家暴露其他店铺或卖家信息。

## 7. 平台订单标识

Amazon Adapter 规范化：

- NFKC；
- 移除空白；
- uppercase；
- 白名单字符；
- 长度限制。

先写订单号 Claim，再上传或最终确认。冲突进入人工处理，不自动覆盖。
