# Owner 决策与行动清单（Production Gates 推进）

> 状态记录：2026-08-18。Owner 已决定：① 开始推进 Production Gates；② app.yueguangbai.net 清理；③ GitHub Actions billing 维持 $0（Remote CI 保持 NOT VERIFIED）。
> 本文档列出推进各 Gate 需要 Owner 本人执行或安排的事项；每项完成即更新对应 Gate 状态（见 `docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md`）。

## G1 — 负责人指定与隐私/政策批准（Owner 签字）

- [ ] 指定发布负责人、D1 恢复负责人、R2/Drive 恢复负责人、安全负责人、独立告警接收人（记录姓名 + 邮箱）
- [ ] 批准隐私告知内容、外部 AI 处理说明、跨境数据说明、永久冷归档说明
- [ ] 批准普通附件与安全记录保留期、删除/账号注销流程
- [ ] 记录评论/返款业务的平台政策风险（不得标为"无风险"）
- [ ] 批准备份保留期、异地副本、密钥分离、MFA、轮换、恢复演练频率与销毁审批
- [ ] 签字方式：在本文档下方签署 `OWNER_APPROVED + 日期 + 姓名`

## G7 — 历史数据导入 PREVIEW（Owner 提供源数据 + 批准范围）

- [ ] 提供历史订单源文件（工具要求：`数据订单汇总.xlsx`，路径与格式见
      `tools/imports/historical-order/` 说明；dry-run 已实测在缺源文件时失败关闭、0 写入）
- [ ] 提供卖家伙伴导入源数据（seller-partner import 源）
- [ ] 批准导入范围：客户类型、时间窗、字段映射、去重规则、冲突处理
- [ ] 批准后执行真实 PREVIEW（只读），输出行数/金额/编号连续性核对表
- [ ] PREVIEW 经 Owner 人工核对后，逐项批准导入（另需 reconciliation 计划）

## G8 — 大陆三网/微信实测（Owner 安排外部操作者）

- [ ] 安排大陆真实网络操作者（移动/联通/电信三网 + 微信内置浏览器）
- [ ] 提供可测环境：staging（已验收的隔离环境）或部署后的生产
- [ ] 按 `docs/runbooks/ISOLATED_STAGING_ACCEPTANCE.md` 的 Buyer/Seller/Staff 关键旅程逐项实测并记录
      （延迟、request ID、失败重试；Staff 需 Cloudflare Access 保护下的登录与深链）

## G9 — Staff Pilot（Owner 组织）

- [ ] 组织受控试用：8 名 Staff、每日 200 单与峰值样本（不含真实客户内容）
- [ ] 记录 pilot 周期、参与人员、发现的 P0/P1 与修复证据
- [ ] 验证 D1/R2/Provider 限额与告警

## 其他需要 Owner 的事

- [ ] app.yueguangbai.net 清理：执行或授权执行
      `docs/runbooks/PRODUCTION_CLEANUP_APP_YUEGUANGBAI_NET.md`（需 Cloudflare 账号访问）
- [ ] 部署推进（G2–G6）：授权创建生产资源、批准迁移窗口、批准部署——当前未授权
- [ ] GitHub Actions billing：维持 $0（已决定）→ Remote CI 保持 NOT VERIFIED；
      若未来恢复，rerun CI 即可转 VERIFIED

## 签署区（G1）

```text
发布负责人：___________    D1 恢复负责人：___________
R2/Drive 恢复负责人：_____   安全负责人：___________
独立告警接收人：___________
隐私告知 / AI 处理 / 保留期 / 删除流程：已批准
评论/返款平台政策风险：已记录（不得标为无风险）
备份保留 / 异地副本 / 密钥分离 / MFA / 轮换 / 演练频率 / 销毁审批：已批准
OWNER_APPROVED：__________   日期：__________
```
