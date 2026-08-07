# M10 Production Readiness / Backup Validation 验收证据

## 最终结论语义

当前只能得出：`本地候选通过、生产未批准/未上线`。本地/匿名/隔离证据与外部 Production GO 是两个独立结论；外部缺项不是代码失败，但每项都阻断生产放行。

## 本地证据矩阵

| 能力 | 本地证据 | 结论 |
| --- | --- | --- |
| Migration | 连续 `0001`–`0034`、schema 34；发布证据外置，不创建 0035 | LOCAL_PASS |
| D1 backup | 一致快照、完整 dump、gzip、双 SHA-256、四类 inventory、全表 row counts、财务聚合、工具版本、AES-256-GCM | LOCAL_PASS |
| D1 restore | 新隔离 DB；auth/hash/schema/inventory/rows/finance/integrity/FK/smoke 全比较 | LOCAL_PASS |
| File reconciliation | D1 authority 对 R2 hot / Drive archived 离线 Fixture；8 类 finding；零 Provider 调用/零删除 | LOCAL_PASS |
| Capacity | 8 Staff、200 orders/day、50/15m peak、800 files、50 batch | LOCAL_PASS |
| Rollback | 禁止覆盖恢复目标；R2 删除后无 proxy/完整回灌则阻断旧 Worker | LOCAL_PASS |
| Alerts/runbook | 10 类信号均有阈值、诊断、kill switch、恢复和独立升级要求 | LOCAL_PASS / receiver OWNER_ACTION_REQUIRED |
| Dependency advisory | `react-router 8.3.0` 官方修复迁移；目标为 `npm audit` 0 | LOCAL_PASS（以最终门禁输出为准） |
| Secrets/privacy | 真实备份、Manifest、密钥、原始存储 ID 和 URL 不进入 Git；匿名汇总可提交 | LOCAL_PASS（以最终 scan 为准） |

## P0：OWNER_ACTION_REQUIRED / PRODUCTION_GO_BLOCKED

- P0-01：真实飞书应用、回调验证、App ID/Secret、真实接收人和独立于飞书的告警通道未配置/未测试。
- P0-02：Google Drive OAuth、老板账号 MFA/恢复、专用目录、真实 proxy/read/rehydration/R2-delete 未授权/未测试。
- P0-03：OpenAI/ChatGPT OAuth、应用、外部 MCP 注册和 AI 隐私批准未完成。
- P0-04：Cloudflare 账号、域名/DNS、production secrets 未配置；无线上 Migration、部署、Scheduler/Queue、R2/Drive/飞书/MCP 启用。
- P0-05：中国移动/联通/电信与微信内置浏览器真实网络矩阵未执行。
- P0-06：隐私政策、AI 处理披露、保留/删除/账号注销和适用合规审查未批准。
- P0-07：历史数据只允许 AUDIT/PREVIEW；尚无真实 Preview、幂等分批导入批准或 reconciliation。
- P0-08：最终 Production GO 未签发；不得推进生产。

## P1

- P1-01（既有治理项）：`pre-wave13-baseline-conformance-audit` 仍为 `28/40`。未完成项包含真实 R2、真实浏览器/飞书/网络矩阵、Integration/main/PR/部署等；本任务不越权勾选或虚假归档。总控需决定继续完成、拆分或正式关闭该历史 change。它不否定 M10 本地代码证据，但禁止声称“全部 change 已归档”。

除上述既有治理项外，M10 本地实现没有未关闭 P1。任何最终全量门禁、浏览器回归、OpenSpec strict、工作树/远程/PR 检查失败都会新增 P1 并阻止本任务完成；不得预先声称通过。

## OpenSpec 审计语义

- M10 change 已 strict 通过、同步到 canonical spec，并归档至 `openspec/changes/archive/2026-08-07-production-readiness-backup-validation`。
- 全量 `npx openspec validate --all --strict` 必须为 34/34；机器可读本地证据记录最终实测值。
- 既有 `pre-wave13-baseline-conformance-audit` 保持 active 是诚实状态，不代表 M10 sync/archive 失败，也不得被包装为已完成。

## 老板最终清单

1. 指定生产发布负责人、恢复负责人、独立告警接收方和升级通道；完成时间戳投递演练。
2. 完成飞书、Google Drive、OpenAI/ChatGPT、Cloudflare 四组独立外部激活清单与凭证托管。
3. 批准备份保留、异地副本、密钥轮换、恢复频率和销毁流程。
4. 完成三大运营商、微信内置浏览器、飞书移动端的根页/登录/上传/受控图片/长列表/中文/北京时间/错误恢复实测。
5. 批准隐私、AI 处理、跨境、保留/删除/注销和平台政策风险处置。
6. 若导入历史数据，先批准不可变 AUDIT/PREVIEW，再分别批准分批导入；不得覆盖 V2 已完成事实。
7. 分别批准线上 Migration、部署、Scheduler、Drive proxy、首次 R2 delete、飞书、MCP；最后单独签发 Production GO。
