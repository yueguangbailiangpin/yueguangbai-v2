# 月光白 V2 AI 工程治理

## 1. 文档目的

本文件冻结月光白 V2 长期 AI 协作流程、安全边界和验收责任。它约束总控对话、网页开发对话、本地 Codex 与 Ponytail 的分工；不替代产品规则、架构、合同、测试和人工最终决定。

## 2. 当前正式架构

- Node.js 24、TypeScript、Cloudflare Workers/Hono。
- D1 SQLite 为业务事实存储，R2 用于文件对象。
- 正式前端为 React/Vite/Tailwind。
- 事实时间使用 UTC，业务展示与日期判断使用 `Asia/Shanghai`。
- JPY 为整数日元，CNY 为整数分，汇率为 `cny_per_jpy_e8`；财务计算使用 `BigInt`，JSON 使用十进制字符串。
- 禁止 `REAL`、`FLOAT`、`parseFloat` 和 `toFixed` 参与财务计算；财务事实通过冲销和新事实更正，不原地修改。
- Buyer、Seller、Staff 分离，后端实施数据隔离与字段投影；Personal DENY 最终优先。
- 文件必须经过 upload intent、upload、VERIFIED、entity link、audience grant、short read intent；不得暴露 `object_key` 或永久 URL。

### Staff 身份现状

当前 Staff 使用独立身份、可信后端会话和权限模型，不使用旧共享角色链接。飞书是大模块 6 才可能接入的员工入口、通知渠道或身份源，不是当前唯一权威身份系统，也不是 D1 业务事实的替代品。未经独立 OpenSpec Change 和总控批准，不得将正式前端登录流程或 Staff Auth 强制绑定飞书。

### 财务权限边界

内部公司财务与 Seller 结算视图不是同一个权限域；`SELLER_SETTLEMENT_VIEW` 不等于 `FINANCIAL_VIEW`，Seller Organization OWNER 也不等于 system owner。内部公司财务查看必须同时满足 Active Staff、system owner role 和 `FINANCIAL_VIEW`，且 Personal DENY 最终优先；内部导出还必须具有 `FINANCIAL_EXPORT`。Seller 不得读取内部利润、Buyer Refund 成本、公司现金流、内部财务异常或内部财务导出。未来卖家端可能存在安全导出，但必须通过单独 Change、Contract、Permission 和字段投影，不得复用内部公司财务 API 或 `FINANCIAL_EXPORT`。

## 3. 角色分工

总控对话决定规则、分支、冻结与采纳；网页开发对话是已冻结 Feature 的主要源码写入者；本地 Codex 负责真实本地工具验收和治理维护；Ponytail 只提供受限的只读审查意见。

## 4. 总控对话职责

- 选择大模块，创建远程 Feature 分支，冻结 OpenSpec 规划结果。
- 对 Spec 与代码冲突作最终判断，决定是修复代码还是改变规则。
- 审查静态结果、Ponytail 建议和完整验收，并决定采纳、拒绝或以后再看。
- 只在干净 Integration 验证完成后，以非强制快进方式推进 `main`。

## 5. 网页开发对话职责

- 在总控冻结 Spec 后，作为该 Feature 的唯一主要源码写入者实现真实 Feature。
- 不自行重写冻结的业务规则、权限、财务事实或 Migration 策略。
- 完成远程源码后提交可供总控静态审查和本地 Codex 验收的明确范围。

## 6. 本地 Codex 职责

- 在 Feature 开始阶段只创建和维护 OpenSpec 规划文件，不抢写主要业务源码。
- 运行真实 Node、D1、Wrangler、浏览器和回归门禁，并如实报告结果。
- 维护 OpenSpec 配置、长期治理文档和只读审查流程；不访问远程 D1、R2、Cloudflare 或飞书，不部署。

## 7. Feature 唯一写入者规则

一个 Feature 同时只能有一个源码写入者。总控须在冻结 Spec 时指定写入者；其他对话只能审查、规划、验收或提出建议。Integration 只验证，绝不作为开发工作树。

## 8. OpenSpec 使用流程

本项目当前使用 Custom profile（delivery 为 both），工作流包含 propose、explore、new、continue、apply、update、ff、sync、archive 和 verify。开发前使用 `/opsx:explore` 或 `/opsx:propose`；本地 `/opsx:apply` 不是主要业务代码开发入口。OpenSpec 记录未来变化与长期有效规则，不为 0001–0026 或既有 Wave 伪造历史 Change。

正式流程固定为：

> 总控选择大模块 → 创建远程 Feature → 本地 Codex 只创建 OpenSpec 规划文件 → 总控审查并冻结 Spec → 网页开发对话成为唯一源码写入者 → 网页完成远程源码 → 总控静态审查 → 本地 Codex 真实验收 → OpenSpec 结构验证 → OpenSpec 实现一致性审查 → Ponytail 只读审查 → 总控决定是否采纳建议 → 必要修复 → 再次完整验收 → OpenSpec sync/archive → 干净 Integration → main 非强制快进

Spec 与代码冲突时，不得静默修改 Spec 来掩盖问题；必须交回总控判定。

### Verify、sync 与 archive 的实际执行

开发完成并通过本地门禁后，执行 `/opsx:verify`。当前 OpenSpec 1.7.0 为 Codex 生成的实际技能名为 `$openspec-verify-change`，其语义等同于上述 Verify 流程。Verify 结果符合 Spec 时，才可继续 Ponytail 只读审查；如实现不符合 Spec，必须停止晋级，不得直接改 Spec 掩盖代码错误。总控判断应修复代码还是发生正式规则变化；如规则正式变化，必须先更新 Change Artifact，再重新 Verify。

收尾依次执行 `/opsx:sync` 和 `/opsx:archive`（当前生成的实际技能名分别为 `$openspec-sync-specs` 与 `$openspec-archive-change`）。只有完成重新 Verify、必要修复和总控确认后，才可 sync/archive。

## 9. Ponytail 使用流程

Ponytail 全局默认 `off`，正式开发期间保持 `off`。仅在测试和 OpenSpec 一致性检查完成后，才允许以 `@ponytail-review` 发起当前 Feature 相对 `main` 的只读 Diff 审查。若未来实际插件命令变化，以插件实际提供的等价只读 review 技能为准。

每次审查必须明确附加：不得修改代码、不得创建 Commit。Ponytail 建议只供总控决定采纳、拒绝或以后再看。

## 10. 哪些变化必须建立 OpenSpec Change

- 大模块、行为变化、用户可见流程变化和跨层设计变化。
- 需要 Migration、权限或隐私边界变化、财务/状态机变化、文件授权变化。
- 需要新增或改变 API 合同、事务边界、幂等、Audit、Outbox 或回滚策略的变化。

## 11. 哪些小修可以跳过 Change

纯类型修复、Fixture 修复和版本断言修复可以跳过 Change，前提是不改变业务行为、合同、权限、数据事实、Migration 或验收边界。总控有权要求任何小修升级为 Change。

## 12. Ponytail 允许审查范围

Ponytail 仅可寻找无价值抽象、重复实现、不必要依赖、可用平台原生能力替代的代码、只使用一次的包装层、重复 DTO 映射、过度复杂测试 Fixture，以及安全可删除的死代码。

每条建议必须包含：文件和位置、当前设计、建议内容、是否改变行为、预计减少行数、安全风险、需要的回归测试，以及“接受／拒绝／以后再看”的建议状态。不得自动应用建议。

## 13. Ponytail 禁止建议删除范围

不得建议删除、合并或弱化：Migration、`CHECK`/`UNIQUE`/`FOREIGN KEY`、Trigger、`transaction_assertions`、Idempotency、Audit、Outbox、Personal DENY、Staff Data Scope、文件动态授权、Buyer/Seller/Staff 后端隔离、不可变财务事实、Payment/Allocation/Reversal、Buyer Refund、财务公式、BigInt、CSV Injection、错误处理、数据丢失保护或可访问性要求。

## 14. Feature 验收流程

验收必须在网页开发完成和总控静态审查之后进行。至少执行 typecheck、Vitest、完整本地 D1 链路、Wrangler、浏览器验收、权限测试、财务测试和本模块验证器。随后执行 OpenSpec 结构验证、实现一致性审查和限定范围的 Ponytail 只读审查。必要修复后必须再次完整验收。

OpenSpec 不是代码正确性证明。Ponytail 不是安全审查工具。二者都不能替代 typecheck、Vitest、D1 全链、Wrangler、浏览器验收、权限测试、财务测试或 Integration。

## 15. Integration 流程

只有已完成完整验收、OpenSpec sync/archive 且工作树干净的 Feature 才可进入 Integration。Integration 只作组合验证、回归与提交准入；不得开发、重构或创建竞争性 Migration。发现问题应回到唯一写入者的 Feature 修复并重新验收。

## 16. main 推进规则

`main` 只能由总控在干净 Integration 通过后推进，且只能普通、非强制快进。禁止直接向 `main` 开发、强推、rebase 后覆盖历史或以治理工作树替代 Integration。不得自动创建 PR 或部署。

## 17. Migration 纪律

Migration 必须连续，禁止跳号、补造历史、并行创建互相竞争的 Migration。任何涉及 D1 事实结构的变更先判断是否需要 Migration，并在 OpenSpec proposal、design、tasks 中明确。不得弱化数据库约束、触发器、事务最终断言、幂等、审计或 Outbox 来换取简化。

## 18. 失败和回退流程

门禁、验收或一致性审查失败时，停止晋级，保留证据并报告失败命令、影响范围、未通过项和安全风险。回退优先使用可审计的反向业务事实、显式修复或分支级隔离；不得 force push、reset、删除工作树或篡改历史。规则不清楚时交回总控，不自行猜测。

## 19. 大模块 5、6、7 的工具使用强度

| 大模块 | OpenSpec | Ponytail | 边界 |
| --- | --- | --- | --- |
| 5：正式前端 | 强制 | 强制只读 Review | 重点审查 React Hook、状态管理、重复组件/展示逻辑、多余依赖、表单封装和浏览器原生能力替代。 |
| 6：内部运营与飞书 | 强制 | 选择性只读 Review | 仅普通页面、普通 API glue、DTO/通知格式化；不得简化 Staff 权限、Assignment、Personal DENY、Audit 或客户隔离。 |
| 7：迁移、上线、生产验收 | 强制 | 默认关闭 | 仅非关键辅助脚本、文档生成和纯展示代码；不得审查简化迁移、备份恢复、回滚、抽样验收、生产门禁、数据一致性或校验和审计。 |

## 20. 标准报告格式

每次治理、Feature 验收或只读审查报告至少包含：

```text
TASK=
FEATURE_OR_CHANGE=
FILES_CHANGED=
COMMANDS_RUN=
OPENSPEC_STATUS=
PONYTAIL_MODE=off|not-run|readonly-review
TESTS_PASSED=
TESTS_FAILED=
SECURITY_AND_PERMISSION_RESULTS=
MIGRATION_RESULTS=
REMOTE_WRITES=no|explicitly-authorized
INTEGRATION_STATUS=
OPEN_RISKS=
TOTAL_CONTROL_DECISION_REQUIRED=
NEXT_SAFE_STEP=
```

报告不得把未执行的检查描述为通过，也不得把 Ponytail 建议描述为已经采纳。
