# 卖家本金汇率策略生产初始化与激活

状态：`LOCAL_READY / PRODUCTION_BLOCKED`

本说明只准备卖家本金最终汇率 `平台下单日权威日汇率 + 绝对加点` 的生产初始化。JPY→CNY 默认加点固定为 `+0.004`，即 `400000 / 100000000`。卖家组织专属覆盖优先，明确 `0` 是有效覆盖而不是未设置。

本流程不导入卖家编号、卖家组织、店铺、产品、历史订单或 R2 历史图片，不重算历史卖家本金，不修改买家返款、服务费、退款或结算口径。

## 当前代码边界

- 仓库 schema tail 为 0043；本 Change 不新增 Migration。
- 0041 提供策略版本、不可变事件和正式订单本金快照；0043 追加 future-effective、事件 fidelity、订单确认时点和本金金额一致性保护。
- 两条 Amazon 正式订单确认路径只在 `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED="true"` 时强制新策略；模板和本地配置当前都显式为 `false`。
- 缺少精确平台下单日权威日汇率或生效策略时，开启后的确认返回 `SELLER_PRINCIPAL_RATE_NOT_FOUND`，并且不创建正式订单、本金 payable 或策略快照。
- GLOBAL Owner 可在没有卖家组织主数据时读取和提交默认 JPY→CNY 策略；组织覆盖仍必须选择已授权 ACTIVE 组织。Seller Ops 不能读取或写入全局默认。

## 本地机器预检

先确认仓库模板继续保持关闭。注意：`npm run preflight:seller-principal-rate` 脚本已从 main 移除（随 0069 卖家协议费率运行时退役清理），不再存在；当前真实可用的本地门禁为：

```text
npm run check:seller-principal-rate-bootstrap
```

该门禁包含 db:verify、verify:migration-guards、verify:seller-agreement-rate-retirement、test:seller-principal-rate-bootstrap 与相关 workspace typecheck；它不再输出旧的 `LOCAL_TEMPLATE_SAFE_PRODUCTION_BLOCKED` 状态。

snapshot 模式（`--database/--expected-schema/--phase/--as-of/--enforcement-state`）preflight 已随脚本移除而不可执行；其历史设计与守恒要求见 archived Change `2026-08-17-seller-principal-rate-production-bootstrap-preflight`（设计记录，不代表 main 存在可执行脚本）。恢复副本的备份、attestation、保管与销毁仍必须先按生产备份恢复流程获得单独授权。该模式的结果只证明所给本地副本，不证明当前线上 D1、Worker、配置或 Staff 账号。

### 预检动作与预期守恒

| `recommended_action` | Staff 后续动作 | policy version | event | Audit | Outbox | COMMITTED idempotency |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `NO_POLICY_MUTATION_REQUIRED` | 不写策略 | +0 | +0 | +0 | +0 | +0 |
| `WAIT_FOR_EFFECTIVE_BOUNDARY` | 等待已确认策略到生效点 | +0 | +0 | +0 | +0 | +0 |
| `OWNER_CONFIRM_EXISTING` | Owner 确认正确 future pending | +0 | +1 | +1 | +1 | +1 |
| `SUBMIT_AND_OWNER_CONFIRM` | GLOBAL Owner 提交并确认 | +1 | +2 | +2 | +2 | +2 |
| `BLOCKED_MANUAL_REVIEW` | 停止并复核 | 不确定 | 不确定 | 不确定 | 不确定 | 不确定 |

所有动作的历史订单更新和既有本金快照更新都必须为 0。`fact_graph_anomalies` 必须为 0；preflight 会要求每个策略版本的 submitted/decision event 与 Audit、Outbox、COMMITTED idempotency 一一守恒。输出不包含 Staff、组织、policy、request 或 idempotency 标识。

## 待批准的生产顺序

下面每一步都需要总控按项批准；本 Change 未执行其中任何生产动作。

1. 在窗口开始时重新核验候选完整 SHA、远程身份、备份/恢复证据和线上 Migration ledger。线上 schema 只能是连续前缀，不得从仓库 tail 推断线上已经到 0043。
2. 如果 ledger 未到 0043，单独批准并按连续顺序应用缺少的既有 Migration。0040–0043 必须分别服从前驱断言；0043 如发现不兼容既有策略/事件/快照事实，立即停止，不删除、不回填、不改金额。
3. 部署与 schema 43 兼容、且 `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED="false"` 的 Worker。部署、Migration 和配置不是同一授权。
4. 以真实 ACTIVE GLOBAL Owner Session 打开 `/staff/seller-principal-rate-policies`。默认配置不需要先创建卖家组织；不要为了初始化默认策略导入或伪造组织。
5. 按 preflight 动作处理：
   - `SUBMIT_AND_OWNER_CONFIRM`：提交默认范围、JPY→CNY、`+0.004`、明确未来生效时间和页面返回的 expected version；然后由具有 `FINANCIAL_CORRECT` 的 Owner 在生效时间之前确认。
   - `OWNER_CONFIRM_EXISTING`：核对 pending 正是 `+0.004`、未来生效、默认范围，再确认。
   - 其他动作按表格停止、等待或不写。
6. 保存页面 request ID，并只读复核实际行数增量与策略/event/Audit/Outbox/idempotency 守恒；不得把失败命令或重放重复计为成功事实。
7. 到达生效边界后，以至少一个明确的受控 smoke 平台下单日期运行 enablement 验证——旧 `preflight:seller-principal-rate` 命令已不存在；当前真实可用验证为 `npm run test:seller-principal-rate-bootstrap` 与 `npm run check:seller-principal-rate-bootstrap`（针对本地恢复 SQLite 副本的只读断言仍须按生产备份恢复流程单独授权）。

8. 只有状态为 `LOCAL_READY_PRODUCTION_BLOCKED`、指定每个日期都 `available=true`、开关仍为 false，且真实线上配置/账号/资源另行复核后，才能申请单独授权把开关改为 `true`。
9. 单独批准受控 smoke，分别覆盖独立正式订单确认和审核原子确认路径。验证正式财务快照、新本金策略快照和 Seller Principal payable 金额完全相等；不使用历史订单做重算。

## 权限与并发

- 默认-only 读取/提交只允许可信 Staff Session 下的 `owner + SELLER_MANAGE + GLOBAL`；Owner 确认还必须有 `FINANCIAL_CORRECT`。Personal DENY 最终优先。
- Seller Ops 只能读取/提交其分配 ACTIVE 组织的专属覆盖，不能读取或提交默认策略。
- 相同 Idempotency-Key 与请求哈希重放原响应；相同 key 不同请求冲突。
- 同一 target 同时只能有一个 pending。并发提交恰有一个成功，其他请求稳定冲突；不得通过直接 SQL 绕过。

## 停止与回滚

- 开关开启前：保持 false 即停止，不产生新正式订单策略快照。
- 错误 pending：由 Owner 通过受控流程拒绝；不得删除行或事件。
- 已 confirmed 但尚未生效或值错误：保持 false，使用新的未来版本纠正；不得覆盖或删除旧版本。
- 开关开启后 smoke 失败：先以单独配置授权恢复 false；保留策略、事件、Audit、Outbox、Idempotency、正式订单和快照。任何已经形成的财务事实按既有冲正/更正流程处理，不重算历史。
- 0043 是 forward-only；不得 down-migrate 已承载事实的 schema。

## 本 Change 未执行

`PRODUCTION_MIGRATION=NOT_EXECUTED`

`PRODUCTION_D1/R2/DRIVE/FEISHU/MCP_WRITE=0`

`DEPLOYMENT/SECRET/REAL_ACCOUNT_OPERATION=0`

`GITHUB_PUSH/PR/MERGE=0`
