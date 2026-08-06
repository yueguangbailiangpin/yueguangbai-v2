# Design: Google Drive Cold Image Archive

## Eligibility and Time

整单关闭要求 Review、Buyer Refund、Seller Principal 和 Seller Service Fee 的适用组件全部进入完成或无需处理的终态。关闭命令写入 `business_closed_at` 与版本；归档服务以 Asia/Shanghai 本地日历增加六个月，并将结果保存为 UTC 毫秒 `archive_due_at`。目标月份没有同日时收敛到该月最后一日，保留本地时间。一份 Seller Settlement Proof 或其他允许的凭证关联多个订单/结算项目时，文件到期时间取全部关联业务完成后的最晚 `archive_due_at`。业务重新打开时必须在归档删除前取消/重算到期；已归档后的更正不修改历史文件，新增证据建立新的归档期限。

## Archive State Machine

建议状态：`R2_HOT → DRIVE_COPYING → DRIVE_VERIFIED → R2_DELETE_PENDING → DRIVE_ARCHIVED`，失败保留可重试状态和 R2。D1 保存 Drive file/folder ID、owner account key、byte size、MIME、SHA-256、attempt、next retry、verified/archived 时间。原始 OAuth Token 只存 Cloudflare Secret。

## Upload and Verification

Job 获取归档 lease 后读取 R2 verified object，以可恢复上传创建 Drive blob，并使用稳定 D1 file ID 写入 app-private metadata。上传成功不等于归档成功；必须通过 Drive API 回读内容并重新计算 SHA-256，同时验证 MIME/字节数。只有条件更新成功写入 `DRIVE_VERIFIED` 后，R2 compensation service 才可删除对象并最终标记 `DRIVE_ARCHIVED`。

## Controlled Read

客户端继续请求现有短期 Read Intent/Content endpoint。服务端每次重新校验 Identity、Persona/Staff authorization、entity link、Audience、version 和 intent token；`R2_HOT` 从 R2 流式读取，`DRIVE_ARCHIVED` 使用服务端 OAuth 调用 Drive `files.get alt=media` 并流式返回。响应保持安全 Content-Type、Disposition、长度和缓存策略；不得把 `drive_file_id`、Refresh Token 或裸 URL 传给浏览器。

## Owner Google Account

第一版由业务所有者普通 Google 账号授权专用归档目录。优先使用只允许应用创建/管理自身文件的最小 Scope；Refresh Token 加密存为 Secret，支持轮换/吊销。账号必须启用 MFA 与恢复方式。应用定期按 D1 Manifest 检查文件存在性、大小和访问能力；人工移动/删除造成不一致时告警并停止相关 R2 删除。

## Performance and Availability

按每日最多二百订单分批归档，归档读取属于低频冷路径，不引入 CDN 或第二数据库。Drive 不可用时返回安全的 dependency-unavailable，不伪造 404 或降低权限；Staff operations health 记录失败类别和 request ID。

## Recovery

提供仅 owner 授权的 Manifest 驱动回灌工具：从 Drive 读取、校验 SHA-256、写入新 R2 key、HEAD 校验、条件更新存储位置。回灌不删除 Drive 永久归档。任何自动/人工修复都写 Audit。
