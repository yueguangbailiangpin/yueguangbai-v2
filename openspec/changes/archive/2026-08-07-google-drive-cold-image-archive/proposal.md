# Google Drive Cold Image Archive

## Why

四类正式业务证据需要在 R2 热存储六个自然月后迁移到业务所有者控制的普通 Google Drive 账号并永久保存，同时继续在月光白系统内按原权限查看。当前系统只有 R2 上传/读取/补偿，没有 Drive 归档事实、后台迁移或代理读取。

## What Changes

- 为订单截图、评价截图、Buyer Refund 凭证和 Seller Settlement 凭证计算整单关闭后的 `archive_due_at`。
- 使用业务所有者 Google 账号、专用归档目录和服务端 OAuth Refresh Token 上传 Drive。
- 上传后从 Drive 回读，验证字节数、MIME 和 SHA-256；验证成功后才删除 R2。
- 在 D1 保存存储位置、Drive file/folder ID、归档状态、尝试/失败、校验和时间事实。
- 复用现有短期 Read Intent 和 Audience 授权；受控文件接口在后端从 R2 或 Drive 流式返回，永不公开 Drive 链接。
- Drive 归档永久保存，不提供自动到期删除。

## Non-Goals

- 不把 Google Drive 作为 D1 业务事实数据库。
- 不向客户或 Staff 返回公开/永久 Drive URL。
- 不要求 Buyer、Seller 或 Staff 登录 Google。
- 不归档产品图片、普通客服附件或未列出的 Purpose。
- 不使用员工个人账号；第一版只使用业务所有者明确授权的账号。

## Migration and Contract Impact

需要连续 Migration 扩展 file object/archive facts、状态、索引、事件和不可变 Manifest；不得复用上传意图过期或 Audience link 过期表示内容归档。外部 File DTO 不返回 Drive ID；现有 Read Intent/Content Contract 保持 URL 形状，增加安全 `ARCHIVED` 展示状态和依赖不可用错误。

## Dependencies

依赖 Scheduled Operations Change、四类文件现有 Audience/Manifest、整单业务关闭事实和生产 Secret 管理。实施前必须确认 Google Drive API、OAuth Scope、账号恢复/MFA 与容量告警。

## Local Delivery and External Activation Boundary

本 Change 的可验收交付仅包括连续 Migration、关闭/重开与回灌命令、合同、运行时工厂、Google Drive Adapter、mock、受控读取、真实 runner dry-run、自动化测试、Runbook 和外部激活清单。M7 不创建或使用真实 Google OAuth Client、Refresh Token、owner 账号目录、外部文件，也不执行生产部署或线上 D1/R2 写入。

真实 owner OAuth/MFA/恢复方式、专用目录、匿名 Provider PoC、Scope 批准、容量/轮换以及 shadow-copy → proxy-read → 首次 R2-delete 的生产阶段验收，正式转交 M10/最终老板外部激活清单。该风险在外部清单完成前保持未执行，所有运行时开关继续 hard-disabled；本 Change 归档不表示这些外部事项已完成。

## Rollout and Rollback

本地以 mock 完成三阶段路径：只计算到期；只复制/回读验证但不删 R2；代理读取验收后才允许 R2 删除。真实 Provider 与生产阶段由 M10/老板单独批准。首次删除 R2 后，旧 R2-only Worker 不可直接回滚；必须保持 Drive 代理读取兼容，或先按 Manifest 将归档文件回灌 R2 再降级。

## Acceptance

必须覆盖自然月边界、整单关闭/重开、四类 Purpose、并发归档、断点续传、回读哈希、Drive/R2 故障、授权撤销、文件缺失、代理读取、Audience 隔离、R2 删除门禁和回灌恢复演练。
