# Change Proposal: Customer Portal Entry and Copy Simplification

## Why

现有买家、卖家页面向客户暴露了身份选择、工作区术语、内部时间和系统说明。两个入口路径已经独立，页面应直接使用路径确定身份，并只展示客户完成当前业务所需的信息。

## What Changes

- 精简 `/buyer/login` 与 `/seller/login`，删除身份选择和重复身份文案。
- 精简买家壳、首页、个人页和返款详情；“任务”改为“产品”。
- 产品区只返回并展示当前买家实际可预约的产品。
- 删除卖家壳和页面中的重复标题及内部实现说明。
- 所有客户可见时间统一为北京时间文案。
- 同步第一方前端合同、DTO 最小投影、测试和中文验收。

## Out of Scope

- 卖家产品申请/需求批次提交表单；由 `seller-portal-self-service-submissions` 处理。
- Staff 角色、获客、经营看板、财务公式或业务状态机变化。
- Buyer/Seller MCP、生产部署、外部 Provider 或真实数据。

## Migration

预计不需要 Migration。实现前必须证明现有 D1 事实足以完成身份入口、可预约性判断和最小 DTO 投影；不得为纯展示变化创建空 Migration。

## Risk and Rollback

风险集中在双 Persona 登录上下文、错误隐藏仍在浏览器 DTO 中的数据、产品资格过滤和客户回归。回滚只回退前端/合同与兼容读模型，不改变账号、订单或财务事实。
