# Google Drive 外部接入清单

以下项目已由 M7 正式转交 M10/最终老板验收，必须由业务所有者在生产启用前完成；本模块没有创建真实 OAuth、凭证、目录、外部文件或生产资源。OpenSpec Change 的本地完成/归档不代表下列外部事项完成。

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

在全部项目完成并留存批准证据前，`DRIVE_ARCHIVE_ENABLED`、copy、proxy-read、R2-delete 与 D1 阶段开关必须保持 hard-disabled。任何缺项均按发布阻断风险处理，不得以 M7 本地测试替代。

## 可执行的首阶段预检

预检不读取 Secret、不联网、不查询 D1/R2/Drive；它只能验证由老板在仓库外、`0600` 文件中准备的渲染配置与匿名化证据。先运行 `npm run preflight:drive-archive`，预期两个环境均为 `LOCAL_NO_GO` 且调用计数为 0。不要把该结果当作可启用。

获得逐项授权后，才可把四个仓库外证据文件传入：渲染 release 配置、exact `drive.file`/owner-only/匿名回读/撤销的 OAuth 收据、加密 D1 bundle/manifest SHA-256 attestation、以及 `{ "copy_enabled": 1, "proxy_read_enabled": 0, "r2_delete_enabled": 0 }` 的 D1 控制快照。运行：

`node scripts/preflight-google-drive-cold-archive.mjs --environment production --config /private/config.json --oauth-evidence /private/oauth.json --backup-evidence /private/backup.json --d1-controls /private/controls.json --declared-secret GOOGLE_DRIVE_CLIENT_SECRET --declared-secret GOOGLE_DRIVE_REFRESH_TOKEN`

唯一可接受的非阻断结果是 `LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO`：它仅证明首阶段 shadow copy 的本地结构，R2 仍是读取源。代理读取和 R2 删除须分别经老板批准并在后续受控窗口验收；本预检会刻意拒绝它们为 true。
