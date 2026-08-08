# Design: Seller Portal Self-Service Submissions

## Existing Authority

实现复用 `/api/seller-portal/product-applications` 与 `/api/seller-portal/demand-batches` 的现有 POST/withdraw 路径。Web 不构造 Seller Organization、Store Scope、成员角色或状态；后端从 Customer Session 和授权 Store 解析 Actor，并在命令提交时再次检查。

## Product Application Form

表单只收集正式产品申请合同需要的店铺、平台产品标识、中文名、搜索词、链接、图片和备注。图片继续使用 upload intent → VERIFIED → entity link，浏览器不得接触 object key、Drive ID 或永久 URL。只读或财务成员不看到可操作入口，直接调用仍由后端拒绝。

## Demand Batch Form

只有通过且属于当前授权 Store 的产品可被选择。表单收集目标数量、任务/评论类型、开放/预约/下单时间、买家说明和内部允许的 Seller 备注；时间输入显示北京时间，提交为合同要求的 UTC/业务日期值。追加数量必须新建批次，不覆盖历史批次。

## Mutation Recovery

每个逻辑提交冻结 action/path/body 和 Idempotency-Key。只有模糊网络结果允许重放原请求；校验、权限、版本和状态冲突要求刷新服务器事实。成功后跳转到真实详情并使相关列表失效。

## Rejected Alternatives

- 不创建第二套 Seller API。
- 不在前端模拟审批或直接选择下一状态。
- 不把产品申请和需求批次合并成一张表单；两者是不同长期事实。
