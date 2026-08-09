# 月光白 V2 全仓最终审查与优化报告

Date: 2026-08-10 (Asia/Shanghai)

## 1. 结论与边界

本地全仓审查、确定性修复和最终门禁已完成，状态为“待总控复核”。这是未提交、未推送的本地实施证据，不是 Production GO。

- `LOCAL_REVIEW_AND_FIX=COMPLETE`
- `PRODUCTION_GO=NO_GO`
- `PRODUCTION_MIGRATION=NOT_EXECUTED`
- `HISTORICAL_IMPORT=NOT_EXECUTED`
- `COMMIT/PUSH/PR/MERGE=0`
- `REMOTE_WRITES=0`
- `CLOUDFLARE/D1/R2/FEISHU/DRIVE/TENCENT_DOCS/MCP/PROVIDER_TOUCHES=0`

## 2. 基线、隔离与仓库状态

| 项目 | 最终只读证据 |
| --- | --- |
| 审查分支 | `audit/full-repo-final-review-optimization` |
| 审查 worktree | `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/full-repo-final-review-optimization` |
| 审查 HEAD | `384873ac3c5c6f83d73e6dd8e1788992081b78e7` |
| 本地 `main` | `384873ac3c5c6f83d73e6dd8e1788992081b78e7` |
| 历史订单集成分支 | `384873ac3c5c6f83d73e6dd8e1788992081b78e7` |
| 本地 `origin/main` tracking ref | `904c154b66d4acad099c89c0e3719c67837975fe` |
| origin | `https://github.com/yueguangbailiangpin/yueguangbai-v2.git` |
| 主工作树保护 | 四个既有未跟踪路径保留，未删除、未覆盖 |

本次所有写入均位于隔离 worktree。没有 fetch、reset、rebase、commit、push、PR、merge 或对主工作树的写入。

最终 `git status --porcelain=v1 --untracked-files=all` 共 83 个路径：68 个已跟踪文件被修改，其实际 diff 为 `+1,898/-466`；15 个新文件尚未跟踪，共 1,384 行（包括 0043、历史 Migration checksum、共享 verifier、新测试/通用分页文件和本 OpenSpec Change）。合计本地文本变更为 `+3,282/-466`；所有变更仍未提交。

## 3. 已实施的确定性修复

| 审查面 | 已证明缺陷 | 本地修复与语义边界 |
| --- | --- | --- |
| Customer 认证 | 不存在账号的 dummy PBKDF2 仅 10,000 次，新凭证默认 310,000 次 | 导出并复用唯一当前 work factor `310_000`；未知账号仍只返回统一无效凭证界面 |
| Seller 文件上传 | FINANCE/VIEWER 能创建未关联的产品申请图片 upload intent | 仅 OWNER/OPERATIONS 可创建、上传和完成；已签发后角色降级也立即拒绝 |
| Seller explicit audience | 非聊天用途只核验 Organization grant，未回到当前业务实体和 Store scope | 为产品申请图、产品主图、评论证据、legacy/platform 聊天截图建立 `purpose + entity_type` 固定映射；重验当前 Organization、ACTIVE Store、OWNER/OPERATIONS 和非 OWNER Store scope；未知映射 fail closed |
| 文件防枚举 | 不存在、未验证、未链接、无 audience 和越权路径可返回不同错误 | Buyer/Seller Customer 读取统一 concealed 404；Staff 既有语义不变；版本冲突在授权之后判定，越权错版本也是 404，已授权 OWNER 仍得到 409 |
| read intent 并发 | 条件消费未证明“本次”取得使用权，并发可以返回两份 bytes | 消费 UPDATE 后立即断言 `changes()=1`，同一 batch 失败回滚；并发测试只有一个请求返回 bytes、一条消费事件 |
| Seller 正式订单 | legacy 查询未要求 Store ACTIVE，OWNER 仍可读停用店铺订单 | legacy 与 platform 统一限定 ACTIVE Store；停用后列表隐藏、详情 404；不改写历史订单/快照 |
| Staff 卖家本金策略 | UI 默认提交十进制 `0.004`，API 却只接受 E8 整数字符串 | 新增专用绝对 markup 十进制 parser，接受 `0`、`0.004`、`+0.004`、最多 8 位小数；库内/响应仍为 E8 整数 |
| Staff 路由 | 卖家本金策略工作台已实现但没有注册路由 | 注册 `/staff/seller-principal-rate-policies`，补路由级回归 |
| Seller 角色 DTO | 共享 Contract/API 已是 OWNER/OPERATIONS/FINANCE/VIEWER，Seller 页面 runtime 仍是旧 `OWNER/OPERATOR` | runtime schema 与中文标签同步四角色；旧 `OPERATOR` 明确拒绝 |
| UI unavailable | Seller 首页/结算首页读失败时仍把空数组显示为权威 `0`/“暂无” | 初始读失败显示 `—` 和“暂时不可用”，不再伪造空财务/订单事实 |
| Seller 分页 | 多个 Seller 列表固定只读 `limit=100` 首页，首页数量可被当成总数 | 复用通用 opaque cursor 链；Store/Product/Application/Demand/Order/Review/Payable 都可继续取页；首页指标在有后页时显示 `+` 和非最终说明 |
| 金额显示 | Staff 负数 minor-unit 使用 BigInt `%` 时会形成错误小数/负号 | 先分离符号和绝对值，再格式化；CNY 负号位于 `¥` 前 |
| 跨平台标识 | 通用平台 ID 只拒绝 C0/DEL，Unicode C1 控制字符可通过 | 使用 Unicode `Cc` 类别 fail closed，补 U+0085/U+009F 负向测试 |
| 历史 dry-run 隐私 | raw source manifest/summary 在常规 umask 下可为 0755/0644 | 新建输出目录 0700，新建或覆盖 manifest/summary 强制 0600；manifest bytes/SHA 不变 |
| 操作治理 | Production GO 清单仍只覆盖 Migration 0038/0039，verifier 不验证文档 tail | 清单改为完整 0001–0043 链，明确线上只能是连续前缀；verifier 断言新 tail 并拒绝旧 tail；Staff MCP 当前 schema 文档同步为 43 |

## 4. 权限与文件负向矩阵

| 场景 | 期望/实测结果 |
| --- | --- |
| 未知 Customer 账号 | 使用 310,000 次 PBKDF2 dummy，返回统一无效凭证 |
| Staff 非唯一/失效角色、Personal DENY、超出 Data Scope | 现有动态服务和全仓测试持续 fail closed，无成功 Audit/Idempotency 事实 |
| Seller 跨 Organization/跨 Store | 列表不返回，详情/文件隐藏 404 |
| Seller OWNER 读停用 Store | legacy/platform 正式订单都隐藏 |
| Seller OPERATIONS 无 Store scope | 创建 read intent 404；即使 expected version 错误也不泄漏 409 |
| Seller FINANCE/VIEWER 已有 Store scope | 文件上传 403，Seller-visible 产品/评论/聊天文件读取 404 |
| 授予 scope 后 OPERATIONS | 正常创建 read intent；scope 撤销后消费立即 404 |
| 文件不存在/未 verified/未 link/无 audience/撤销 | Buyer/Seller 统一 404 |
| 同一 read intent 两个并发消费 | 恰好一个返回 bytes，另一个版本冲突，消费事件计数 1 |
| 响应隐私 | 无 object key、Drive ID、永久 URL、可重用 token 或密码/hash 投影泄漏 |

## 5. Migration 0001–0043 与前向恢复

### 5.1 修复前真实 finding

- 0003、0004、0005、0006、0007、0008、0010 可在跳过直接前驱时成功提交 DDL 并跳升 schema。
- 0041 允许同一 policy version 第二条 CONFIRMED event，且 actor/time 可伪造。
- 0041 允许 `effective_from <= confirmed_at` 的策略绕过 Application Service 直接确认。
- 0041 快照只信客户端 `created_at`，可为旧订单晚补未来策略，且金额可与 legacy financial snapshot/payable 分叉。

### 5.2 实施

- 0001–0042 全部保持基线提交 `384873ac3c5c6f83d73e6dd8e1788992081b78e7` 的原始字节；未修改任何已存在、可能已执行的历史 Migration。
- 新增 42 项逐文件 SHA-256 清单，并固定文件名 + NUL + 原始字节的聚合 SHA-256。`verify:migration-guards` 在运行 SQL 前先验证这两层不可变基线；0043 以后只追加连续版本，不回写已集成版本。
- verifier 用显式外层事务执行每个错序/重复尝试。35 个错序由历史 SQL 自身拒绝；0003–0008、0010 原始 SQL 不自拒绝，verifier 在提交前发现 predecessor mismatch 后回滚并如实列名。该证据只属于本地 harness，不代表 Wrangler/生产 D1 已验证。
- 新增前向 Migration `0043_seller_principal_rate_integrity_hardening.sql`：
  - 要求起点 schema 42；
  - 在任何新 DDL 前拒绝已存非 future-effective policy、重复/错配 event、时间或金额分叉快照；
  - 新增 `(version_id,event_type)` 唯一索引、event fidelity trigger、future-effective trigger、snapshot confirmation/amount trigger；
  - 仅增加索引/触发器并推进 42→43，不回填、不删除、不重算任何事实。

### 5.3 动态验证

| 证据 | 结果 |
| --- | --- |
| Migration 连续性 | 43 个，`0001 -> 0043` |
| 基线直接 diff | `git diff --exit-code 384873a -- migrations/0001…0042` exit 0；七个退回文件逐项 exit 0 |
| fresh/sequential | schema 43，完整 inventory 一致 |
| 0001–0042 字节不可变 | 42/42 与基线一致；聚合 SHA-256 `d389081b1d9a4a5d00b62fa00781e4e97a72695283d38f2bb969cb390e4a9119` |
| wrong-order | 42/42 不提交：35 个 SQL 自拒绝；7 个 predecessor mismatch 由 verifier 外层事务回滚 |
| repeat | 43/43 拒绝 |
| 失败前后完整 schema+全表数据快照 | 85/85 完全不变 |
| 对象 inventory | 187 tables / 550 indexes（含 autoindex）/ 357 triggers / 10 views / 1,104 objects |
| inventory SHA-256 | `71ea6d9142575ca6de4e33b1eb8b1ea729921f8e2ae5a0dd78ea6c13defacb51` |
| 关键负向 DML | 3/3 拒绝 |
| `integrity_check` | `ok` |
| FK errors | 0 |

### 5.4 回滚边界

- 0043 是 forward-only。一旦产生 schema 43 事实，不得 down-migrate 或删除 policy/event/snapshot。
- 应用代码回滚只能回到“兼容 schema 43”的版本，保留索引和 trigger。
- 0043 preflight 若在任何真实 schema 42 数据失败，必须停止并人工核查；不得自动删除、回填或改金额。
- 0001–0042 没有任何内容或 checksum 改写。Wrangler/生产 D1 的 ledger、应用状态和执行行为未验证；真实 0043 应用仍需老板单独授权。

## 6. 历史订单完整 dry-run

| 项目 | 实测值 |
| --- | --- |
| source SHA-256 | `c7d0ae7a7169337ed8929f59e7cb78beac4e57be098a5f086970446e6269b937` |
| source size | 1,535,867,397 bytes |
| manifest SHA-256 | `a9eb168fba97bd1ae53fbcb200d5091398510b3edeebff928bb66658bf6ede87` |
| 总记录 | 16,304 |
| candidate + quarantine | 14,902 + 1,402 = 16,304 |
| recognized rows / unique platform orders | 16,038 / 15,419 |
| Amazon | 15,551 rows / 14,933 unique orders |
| Rakuten | 477 rows / 476 unique orders |
| TikTok | 10 rows / 10 unique orders |
| duplicate | 584 groups / 1,203 rows |
| exact / conflicting duplicate groups | 11 / 573 |
| valid product rows / unique keys | 15,051 / 1,596 |
| H 聊天图 | 1,910 images / 1,901 rows = 1,786 planned + 124 isolated，守恒 |
| K 到货图 | 1,412，`IGNORE_DO_NOT_MODEL_DO_NOT_IMPORT` |
| media bytes opened/extracted | 0 / 0 |
| 输出权限 | directory 0700 / manifest 0600 / summary 0600 |
| external/database/R2/Tencent/Migration/deployment writes | 0/0/0/0/0/0 |
| production import | `NOT_EXECUTED` |
| Migration 0041 历史重算 | `NOT_EXECUTED`, `recalculate_by_current_policy=false` |

`npm run test:historical-order-migration` 的 19 个负向用例全部通过。完整 dry-run 保持 manifest bytes/SHA 不变，不提取图片字节，不将本地结果写成生产完成。

## 7. 跨平台与卖家本金

- 0042 registry、Contract、runtime DTO 和正式订单使用 canonical `RAKUTEN_JP/TIKTOK_JP`；平台标识以 Marketplace scope 隔离，同标识跨平台不冲突。
- Rakuten/TikTok provider/adapter 仍为 unavailable；非 Amazon 正式订单的 legacy/finance 字段保持 null/unavailable，不伪造 ASIN、Amazon 订单号或财务值。
- legacy/platform 聊天截图均经正式订单、evidence、file link/grant 和 short read intent 链，读取时重验组织/店铺/scope。
- 卖家本金仍固定为订单日 base rate + 绝对 markup；组织覆盖优先，显式 0 不是缺失；全程 BigInt/整数 E8/HALF_UP。
- 两条确认路径都有动态证据：缺策略时 order/legacy snapshot/0041 snapshot/payable/event/audit/outbox 全为 0；成功时 legacy snapshot = 0041 snapshot = principal payable = 53,280 分。
- 新策略、新汇率或停用店铺不改写已确认的历史快照。

## 8. Contract/API/UI、分页、缓存与性能

- Seller 四角色在 shared Contract、API、runtime schema 和中文 UI 一致。
- Staff 卖家本金 markup 的展示十进制输入与 API E8 存储边界一致。
- null、provider unavailable、初始读失败都保持明确“不可用”，浏览器不推算权威财务或权限事实。
- Seller 所有可增长列表都跟随服务端 opaque cursor；测试证明后页请求使用原样 cursor 且保留前页。
- 通用 cursor hook 的 reset key 绑定 identity root/Store/页大小；mutation prefix invalidation 覆盖所有已取页。
- 聊天截图列表不发 read intent、不读 bytes；只在用户显式展开并点击时读取。
- 最终 Web build：2,133 modules；主包 247.87 kB / gzip 75.86 kB；Seller route chunk 23.84 kB / gzip 6.46 kB；source maps 0；无 chunk warning；构建外部调用 0。
- API Worker 仅执行 Wrangler local `--dry-run`；gzip 371.61 KiB；所有 Scheduler/Acquisition/Drive/Feishu/MCP/卖家本金强制开关均保持 false/disabled。

## 9. 静态 verifier 与可维护性

- Migration guard verifier 从仅 31 个版本和单 sentinel 提升为：42 个历史文件字节不可变校验、全 43 版本、85 个显式事务回滚场景、完整 schema+全表数据快照对比，并区分 SQL 自拒绝与 verifier predecessor mismatch。
- DB verifier 从部分对象计数提升为 fresh/sequential 的 1,104 个 name+SQL 完整清单/SHA 对比，并有关键负向 DML。
- Buyer 安全 verifier 曾真实拒绝新 Seller cursor adapter；最终不是只改数量，而是加入精确路径并断言其只映射已验证 page DTO、不含 API path、直接 fetch 或浏览器持久凭据。
- Production GO verifier 现在校验操作清单的 0001–0043 tail，并对旧 0038/0039 tail 失败。
- TypeScript 全局开启 `noUnusedLocals` 与 `noUnusedParameters`；依赖实际引用复核未找到可安全删除依赖。
- Ponytail 在完整门禁和 OpenSpec strict 之后执行只读全仓审查，结论为 `Lean already. Ship.`。一行 re-export 和 RouteModule 均有多处调用或懒加载边界，本轮不为追求行数删除。

## 10. 最终验证证据

| 命令/证据 | 最终结果 |
| --- | --- |
| 本次历史 Migration 修正后 focused | 14 files / 105 tests PASS |
| 高风险 focused 统一回归 | 15 files / 129 tests PASS |
| 文件/Seller Portal 专项 | Seller Portal 13/13；audience+storage 11/11；chat+catalog 43/43；Wave13 file 12/12 PASS |
| 跨平台/卖家本金 focused | 12 files / 116 tests PASS |
| 0043 focused | 1 file / 4 tests PASS |
| 最终 Seller runtime/unavailable focused | 2 files / 9 tests PASS |
| `npm run test:historical-order-migration` | 19/19 negative cases PASS |
| `npm run dry-run:historical-order-migration` | PASS，manifest/conservation 如第 6 节 |
| `npm run db:verify` | PASS，schema 43 / integrity ok / FK 0 |
| `npm run verify:migration-guards` | PASS，42 个 baseline hash；42 wrong-order 不提交（35 SQL 自拒绝 + 7 verifier rollback）；43 repeat；85 unchanged |
| checksum 临时篡改负向样本 | PASS，0003 增加一个字节后门禁拒绝；临时目录已删除 |
| `npm run verify:openspec:strict` | 57/57 PASS |
| 最终 `npm run check` | 226 files / 1,481 tests PASS；全 workspace build PASS |
| Web 子门禁 | 43 files / 468 tests PASS |
| `git diff --check` | PASS |

门禁过程中的真实失败未被隐藏：第一次完整 `npm run check` 在 Buyer 安全 verifier 拒绝新 Seller cursor adapter 时停止。修复为精确路径+行为负向断言后，第二次完整门禁 1,479 个测试通过；随后独立回归审查发现并修复 UI unavailable 误报，最终版再从头运行完整门禁，1,481 个测试通过。

## 11. 未实施与需老板单独授权

1. **历史 manifest 与 0042 canonical registry 冲突**：冻结 manifest 仍把 Rakuten/TikTok 记为 source-local `JP_RAKUTEN/JP_TIKTOK` 并带旧 registry-unsupported blocker，而 0042 已建立 canonical `RAKUTEN_JP/TIKTOK_JP`。修复 generator 必然重签 16,304 行 manifest 并改变冻结 SHA；需老板批准新 manifest schema/hash 版本。未批准前 production eligibility 继续全 false。
2. **完全禁止事后等值快照**：0043 能禁止错时间、未来策略和金额分叉，但 DB 无法区分“确认事务中写入”与“事后伪造相同 confirmed_at/相同金额且使用当时已生效策略的 backfill”。彻底禁止需新权威 marker/确认协议。
3. **Policy event 完整性协议**：0043 保证已存/新写 event 的唯一性与 actor/time/reason fidelity；Application Service 以一个 batch 写 policy+event。但 SQLite 没有 deferred 跨表约束，若要在 DB 层要求每个 policy 一定存在对应 event，需新写入协议或由 trigger 代写 event，不可在本次自行改变。
4. **read intent 并发底层读放大**：CAS 位于对象读取和完整性校验之后，N 个并发请求可能都执行 R2/Drive 读及 hash，但只有一个返回 bytes。若在读前 claim 会改变“存储短暂失败后可重试同一 intent”的现有语义；需设计可恢复 `CLAIMED` 状态。当前为 P3 性能 hardening，不是重复字节返回或越权泄漏。
5. **任何生产/外部操作**：生产 Migration、D1/R2 读写、历史导入、部署、真实账号/Secret/Provider、Cloudflare、Feishu、Drive、腾讯文档、MCP、GitHub push/PR/merge 都需老板按项单独授权。

## 12. 待总控复核

工作树故意保持未提交。总控应复核实际 diff、0001–0042 字节不可变门禁、0043 前向边界、上述 OWNER_AUTH_REQUIRED 设计项和所有外部 NO-GO。复核前不得 commit、push、建 PR、merge、部署或执行真实 Migration。
