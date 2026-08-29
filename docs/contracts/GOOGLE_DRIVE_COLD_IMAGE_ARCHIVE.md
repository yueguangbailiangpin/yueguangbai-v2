# Google Drive 冷归档合同

## 范围

仅 `ORDER_EVIDENCE`、`ORDER_COMMUNICATION_SCREENSHOT`（订单沟通截图，随 ORDER bundle）、`REVIEW_EVIDENCE`、`BUYER_REFUND_PROOF`、`SELLER_SETTLEMENT_PROOF` 可进入归档。订单必须有显式 `order_archive_closures` 事实；评论、买家返款、卖家本金、卖家服务费每项只能是已完成或由关闭命令明确记录为不适用。文件关联多个订单时采用全部关联订单中最晚的 `archive_due_at`。

关闭/重开由 ACTIVE owner 且有效拥有 `SCHEDULED_OPERATIONS_RUN` 的 Staff 命令完成；Personal DENY 优先。命令使用 expected version、request hash、幂等键和 Audit。真实完成项只读取现有业务事实；不存在的组件只有在命令明确提交 `NOT_APPLICABLE` 和原因后才成立，禁止从缺行推断。N/A 的完成基准为 `formal_orders.confirmed_at`，整单 `business_closed_at` 为订单确认与所有真实完成时间的最大值，不使用晚执行命令的点击时间。

`business_closed_at`、`archive_due_at` 与归档事件使用 UTC 毫秒。六个月按 `Asia/Shanghai` 自然月计算，目标月缺少同日时收敛到月末并保留本地时分秒毫秒。中文界面显示使用 `Asia/Shanghai`。

## 状态和删除门禁

环境层仅有四个活动开关：`ARCHIVE_SELECTOR_ENABLED`、
`ARCHIVE_DRIVE_UPLOAD_ENABLED`、`ARCHIVE_HOT_DELETE_ENABLED` 和
`ARCHIVE_RESTORE_WORKER_ENABLED`。它们分别控制 selector、Drive 上传、热
副本删除和恢复 worker；默认值均为字符串 `"false"`，并与 D1
`archive_runtime_controls` 的第二道门独立求交。历史 `DRIVE_ARCHIVE_*`
命名已废弃，不是兼容别名。

状态顺序为 `R2_HOT → DRIVE_COPYING → DRIVE_VERIFIED → R2_DELETE_PENDING → DRIVE_ARCHIVED`。上传成功不是验证成功。系统必须从 Drive 读回并同时核对字节数、MIME 与 SHA-256，再以条件更新写入不可变 Manifest。只有 Manifest 一致、代理读取已启用、环境删除开关已启用、D1 删除开关已启用时才可删除 R2。

上传、回读、D1 条件更新或 R2 删除失败均保留可恢复状态。R2 删除失败停留在 `R2_DELETE_PENDING`；租约到期后可幂等重试。Drive 已验证对象没有自动删除接口。

## 读取与 DTO

原 Buyer、Seller、Staff read-intent URL 和单次 token 合同不变。内容端点先重新校验当前会话、资源、Audience、link/version 与 token，再根据 D1 状态读取 R2 或服务端代理 Drive。授权失败时不得调用 Drive。响应使用 `no-store`、`nosniff` 和安全内联展示。

对外只允许 `HOT` / `ARCHIVED`、归档时间、UTC 时间基准与北京时间显示区。`drive_file_id`、目录 ID、owner account key、OAuth token、resumable session、R2 object key 与永久链接均不得进入 DTO。

## 依赖错误

Drive 授权撤销、对象缺失或 Provider 不可用时返回既有安全依赖不可用错误并记录运营信号；不伪装为资源不存在，也不绕过权限。Manifest 不一致返回存储冲突并停止删除。
