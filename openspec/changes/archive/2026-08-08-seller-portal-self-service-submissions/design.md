# Design: Seller Portal Self-Service Submissions

## Existing Authority

实现复用 `/api/seller-portal/product-applications` 与 `/api/seller-portal/demand-batches` 的现有 POST/withdraw 路径。Web 不构造 Seller Organization、Store Scope、成员角色或状态；后端从 Customer Session 和授权 Store 解析 Actor，并在命令提交时再次检查。

## Product Application Form

表单只收集正式产品申请合同需要的店铺、平台产品标识、中文名、搜索词、链接、图片和备注。产品申请必须附带 1 至 8 张已验证图片；每张只提交不透明的 `file_object_id` 与 `expected_file_version`，继续使用既有 `PRODUCT_APPLICATION_IMAGE`、每张 10 MiB 和 JPG/PNG/WebP 限制。浏览器不得接触 object key、Drive ID 或永久 URL。

提交命令在同一原子事务中创建申请、链接图片、授予当前 Seller Organization 与具备 `PRODUCT_VIEW` 的内部 Staff 明确受众、写入文件/申请审计和 Outbox，并完成产品申请幂等记录。文件必须属于当前 Seller Member、处于 VERIFIED、用途和可见性正确，且未被先前业务实体使用。文件引用按 `file_object_id` 稳定排序后进入请求哈希；重复引用、版本不符、少于 1 张或多于 8 张全部失败且不留下申请或链接副作用。只读或财务成员不看到可操作入口，直接调用仍由后端拒绝。

## Demand Batch Form

只有通过且属于当前授权 Store 的产品可被选择。表单收集目标数量、任务/评论类型、开放/预约/下单时间、买家说明和内部允许的 Seller 备注；时间输入显示北京时间，提交为合同要求的 UTC/业务日期值。追加数量必须新建批次，不覆盖历史批次。

## Mutation Recovery

每个逻辑提交冻结 action/path/body 和 Idempotency-Key。只有模糊网络结果允许重放原请求；校验、权限、版本和状态冲突要求刷新服务器事实。成功后跳转到真实详情并使相关列表失效。

## Rollback

本 Change 不新增 Migration。回退 Seller Web 与对应第一方 adapter 时，已经提交的产品申请、需求批次、文件链接、明确受众、审计和 Outbox 继续保留；旧代码可以继续读取既有申请与需求，未识别的文件链接只会被忽略，不得删除或覆盖。回退后新提交必须使用同一版本的 Web/API，禁止混用新表单与旧写合同。

## Rejected Alternatives

- 不创建第二套 Seller API。
- 不在前端模拟审批或直接选择下一状态。
- 不把产品申请和需求批次合并成一张表单；两者是不同长期事实。
