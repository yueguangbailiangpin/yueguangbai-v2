# Google Drive 外部接入清单

以下项目必须由业务所有者在生产启用前完成；本模块没有创建真实 OAuth、凭证、目录、外部文件或生产资源。

- [ ] 业务所有者普通 Google 账号启用 MFA、恢复邮箱/电话并保存账号恢复流程。
- [ ] 创建专用归档目录，确认只有批准账号和应用可访问，禁止公开分享链接。
- [ ] 在匿名 PoC 中确认 Google Drive API 与 resumable upload/read-back 行为、配额和错误码。
- [ ] 优先评估并批准最小 `drive.file` Scope；若 PoC 证明不足，记录原因后由所有者重新批准，不得静默扩大 Scope。
- [ ] 创建 OAuth Client，Refresh Token 仅写入受管 Secret；确认源码、D1、日志和 PR 不含 token。
- [ ] 记录 owner account key 与专用 folder ID；它们只进入服务端配置/D1，不进入浏览器 DTO。
- [ ] 完成 Refresh Token 吊销、轮换和账号失效演练；授权撤销时读取失败关闭并触发告警。
- [ ] 设置容量阈值、容量告警、人工误删保护和定期 Manifest 巡检。
- [ ] 用匿名图片完成 shadow copy、Drive 回读三项校验、代理读取和 rehydration；不使用真实订单文件。
- [ ] 分别验收 Buyer、Seller、Staff 原 Audience、资源授权和无权 404 隐藏行为。
- [ ] 由所有者分别批准 proxy-read 和首次 R2 delete；不得用一次批准替代两个阶段。
- [ ] 上线前完成隐私告知、跨境保存、永久归档与账号注销/删除流程的适用合规审查。
