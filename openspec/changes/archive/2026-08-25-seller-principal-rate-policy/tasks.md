## Baseline and Migration

- [x] 只读核验主工作树脏状态、`origin/main` 当前提交和仓库现状；从 `origin/main` 创建独立工作树/分支。
- [x] 阅读 `AGENTS.md`、OpenSpec 配置、正式订单/汇率/结算/权限实现及相关测试。
- [x] 新增连续 Migration 0041；本地验证 schema 41、完整性、外键、错序/重复保护；不执行远程 Migration。
- [x] 补策略版本初始状态/决策状态机、终态不可变/禁止删除、事件严格组合约束和事件不可变/禁止删除。
- [x] 补 pending/effective boundary 唯一性、跨日期基准、默认 NULL 与组织覆盖归属的数据库保护及直接 SQL/并发负向测试。
- [x] 补数据库金额 guard：用无溢出商余数分解证明 HALF_UP 结果，并覆盖直接 SQL 篡改、0、半入边界和样例金额。
- [ ] 总控复核 Migration 0041 的生产应用窗口、备份和代码回退顺序。

## Contracts and domain

- [x] 增加策略版本、读取 DTO、策略快照 DTO 和稳定缺失汇率错误码。
- [x] 增加 BigInt 整数刻度的绝对加点与最终汇率计算；覆盖边界、0、HALF_UP 和 overflow。
- [x] 增加默认/组织覆盖优先级、未来生效和按下单日读取的解析器。

## API and confirmation integration

- [x] 增加 Staff 受控读取、提交、确认、拒绝 API；检查可信 Staff、角色/权限、幂等和版本冲突。
- [x] 接入可信 `staffDataScope`：范围外读 concealed 404、范围外写 403、仅 GLOBAL Owner 提交默认或组织覆盖、Seller Ops 只提交分配组织覆盖、Personal DENY/无策略事实/no-store HTTP 测试。
- [x] 增加 Staff 工作台导航与默认/覆盖读取、明确 0 展示、Seller Ops 提交、Owner 确认/拒绝闭环；API 成功/失败均 no-store。
- [x] 更新独立正式订单确认和审核并原子确认两条路径，写策略快照并保持 Buyer/fee/refund 非范围不变。
- [x] 更新 Seller DTO/runtime schema/UI，安全展示基准、加点、最终汇率和策略版本；历史快照显示兼容字段。

## Tests and verifier

- [x] 覆盖默认加点、组织覆盖、明确 0、未来生效、缺下单日汇率、边界日期、精度/取整、幂等/并发版本冲突和 Staff 拒绝。
- [x] 覆盖正式订单历史值不变、新策略快照不可变、旧 agreement 变化不改变新本金金额。
- [x] 覆盖策略/事件直接改删、错误事件组合、重复 pending/effective、基准日期错配和跨组织覆盖。
- [x] 更新 Migration 版本守卫、当前 schema 证据和数据库约定；新增回滚/外部写入证据。
- [x] 运行并记录完整仓库门禁、OpenSpec strict、全 workspace typecheck/build；若环境失败必须保留真实失败原因。

## Local-only acceptance and handoff

- [x] 明确 `REMOTE_WRITES=no`、Cloudflare/D1/R2/Feishu/Drive/Tencent Docs/MCP/真实 secrets/生产数据均未触碰。
- [x] 运行完成后把最终基线、实际 diff、Migration/回滚、公式样例、权限、兼容性、命令结果和未完成项交总控复核。
- [x] 记录生产切换顺序：先 0041，再默认 JPY→CNY 策略提交/Owner 确认及生效时间，最后启用确认代码；本地只验证，不执行生产。
- [x] 实现默认关闭的 `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED` 两阶段切换，并覆盖关闭/开启/缺策略/已有策略；仅记录本地 runbook，不改生产配置。
- [ ] 停在“待总控复核”，不提交、不推送、不建 PR、不合并、不部署。
