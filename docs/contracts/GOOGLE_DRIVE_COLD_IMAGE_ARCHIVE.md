# Google Drive 冷归档合同

## 范围

仅 `ORDER_EVIDENCE`、`REVIEW_EVIDENCE`、`BUYER_REFUND_PROOF`、`SELLER_SETTLEMENT_PROOF` 可进入归档。订单必须有显式 `order_archive_closures` 事实；评论、买家返款、卖家本金、卖家服务费每项只能是已完成或由关闭命令明确记录为不适用。文件关联多个订单时采用全部关联订单中最晚的 `archive_due_at`。

`business_closed_at`、`archive_due_at` 与归档事件使用 UTC 毫秒。六个月按 `Asia/Shanghai` 自然月计算，目标月缺少同日时收敛到月末并保留本地时分秒毫秒。中文界面显示使用 `Asia/Shanghai`。

## 状态和删除门禁

状态顺序为 `R2_HOT → DRIVE_COPYING → DRIVE_VERIFIED → R2_DELETE_PENDING → DRIVE_ARCHIVED`。上传成功不是验证成功。系统必须从 Drive 读回并同时核对字节数、MIME 与 SHA-256，再以条件更新写入不可变 Manifest。只有 Manifest 一致、代理读取已启用、环境删除开关已启用、D1 删除开关已启用时才可删除 R2。

上传、回读、D1 条件更新或 R2 删除失败均保留可恢复状态。R2 删除失败停留在 `R2_DELETE_PENDING`；租约到期后可幂等重试。Drive 已验证对象没有自动删除接口。

## 读取与 DTO

原 Buyer、Seller、Staff read-intent URL 和单次 token 合同不变。内容端点先重新校验当前会话、资源、Audience、link/version 与 token，再根据 D1 状态读取 R2 或服务端代理 Drive。授权失败时不得调用 Drive。响应使用 `no-store`、`nosniff` 和安全内联展示。

对外只允许 `HOT` / `ARCHIVED`、归档时间、UTC 时间基准与北京时间显示区。`drive_file_id`、目录 ID、owner account key、OAuth token、resumable session、R2 object key 与永久链接均不得进入 DTO。

## 依赖错误

Drive 授权撤销、对象缺失或 Provider 不可用时返回既有安全依赖不可用错误并记录运营信号；不伪装为资源不存在，也不绕过权限。Manifest 不一致返回存储冲突并停止删除。
