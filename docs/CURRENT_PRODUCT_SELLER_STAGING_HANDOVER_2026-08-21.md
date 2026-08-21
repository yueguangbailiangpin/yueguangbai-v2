# 当前产品、卖家资料与 Staging 交接说明（2026-08-21）

## 1. 文档用途与结论

本文交接 2026-08-21 完成的当前可预约产品导入、历史卖家恢复、产品库修复、卖家产品名展示、买卖家微信号展示以及 Cloudflare Staging 发布工作。

当前结论：

- 已完成本地实现、Staging D1 数据导入和 Staging Worker 部署。
- 腾讯文档全程只读，没有修改任何腾讯文档、文件夹或工作表。
- 当前正式运行环境仍未上线；本次所有远程业务改动均限定在 Staging。
- `STAGING PASS` 不等于 `PRODUCTION PASS`。系统继续保持 `PRODUCTION = NO-GO`。
- 2026-08-21 状态更新：仓库已转为 public；首个功能提交 `4cf2fff` 已通过 PR #111 合入 `main`（合并提交 `5a186d4`）。其余 5 个功能修复、本文档修订与 manifest 归档通过后续 PR 合入。

## 2. 环境与入口

### 2.1 Staging 网站

- 网站根地址：<https://staging.yueguangbai.net>
- 管理员/员工入口：<https://staging.yueguangbai.net/staff/login>
- 买家入口：<https://staging.yueguangbai.net/buyer/login>
- 卖家入口：<https://staging.yueguangbai.net/seller/login>
- Staff 页面受 Cloudflare Access 保护；页面右上角显示 `Staging Owner` 时，表示当前处于测试环境。

### 2.2 Cloudflare Staging 资源

- Worker：`yueguangbai-v2-staging`
- 自定义域名：`staging.yueguangbai.net`
- D1：`yueguangbai-v2-staging`
- D1 ID：`0731d3e7-0a58-40fe-878d-66c522737067`
- R2：`yueguangbai-v2-staging-files`
- 当前 Worker Version：`bf875556-b43e-4231-8d0f-9122e585331a`
- 当前 Release SHA：`17dca59ee96c497694b4bd9c53fcc7798520e1da`

配置中仍保持以下安全开关关闭：

- `OUTBOX_DELIVERY_ENABLED=false`
- `SCHEDULED_OPERATIONS_ENABLED=false`
- `ACQUISITION_MAINTENANCE_ENABLED=false`
- Google Drive 冷归档写入、复制、代理读取和 R2 删除均为 `false`

## 3. 数据来源与本次确认规则

### 3.1 当前可预约产品来源

腾讯文档“产品出单汇总”的两个分表被视为当前预约白名单来源。此次操作将只读抓取结果冻结为本地 manifest，再生成确定性的导入计划；没有回写腾讯文档。

本次实际导入使用的 manifest：

- 版本：`2026-08-21-live-readonly`
- Hash：`3a112efe533aea646fc319dc99aa956914467f33b2fb668c296126ce5f10eef0`
- Staging import batch：`seller-import-batch-8ee3b8846cbf0a6a06339f3e439eb75de2ff0e5c34d0d191bc1e9bc0342379dc`

注意：该 live manifest 原保存在本机 `/tmp/current-reservable-live-manifest.json`（易失目录），现已归档进仓库：`openspec/changes/current-reservable-product-seller-mapping/references/current-reservable-live-manifest-2026-08-21.json`。归档件 sha256 为 `d64ecf1ea204fd605d7c0f0c4bf455402a093637879871397154a7747b373652`，与上文导入时记录的 hash 不一致，且常见规范化序列化无法复现上文值；两处 `manifestVersion` 均为 `2026-08-21-live-readonly`，文件修改时间（14:03）早于导入开放时间（14:27）。归档件应视为仅存快照备查，导入事实仍以本节 D1 batch 为准。仓库内较早的压缩只读快照仍可能输出 88 个唯一产品；不要混用两个快照的统计。

### 3.2 历史卖家来源

四个历史卖家文件夹对应的渠道如下：

| 腾讯文件夹 ID | 渠道 |
| --- | --- |
| `dJwldHrckeFY` | `ido-mango` |
| `dDUYsBOrYoEk` | `ygbceping` |
| `davLDVdZLoPV` | `yinghua1942` |
| `dhtkJdpmZEgh` | `yueguangbaiai` |

其中 `ido-mango` 是渠道，不是卖家微信号。历史表名通常按“产品名-卖家微信-渠道”组成，例如：

- `紫光灯-Michael_er-dio`
- 产品名：`紫光灯`
- 卖家微信：`Michael_er`
- 渠道：`ido-mango`（`dio` 是历史写法）

四个冻结目录的当前权威统计为：

- 文件条目：184
- 已可靠识别卖家：155 个文件
- 唯一卖家微信：146
- 缺少可靠卖家标识：29 个文件

29 个缺标识文件没有猜测或虚构卖家。此前对话中出现的“213 张表”不作为本次权威统计；本次实际使用的四目录冻结 inventory 是 184 个文件条目。

### 3.3 Owner 已确认的产品规则

- 暂停行排除，不开放预约。
- 缺少必要标识的异常行排除。
- 飞利浦空白异常行排除，不给它虚构 ASIN；其他有完整标识的飞利浦行按普通产品处理。
- Somiso JP 的四行归并为一个标准产品，统一 ASIN `B0GR5C43PG`。
- `B0GRMRV64K` 只保留实际卖家 `szgavin68`（来源渠道 `ido-mango`）；`ygbceping / shiguo0317` 只保留历史证据，不作为当前可用供给。
- 只有“卖家已匹配 + 当前行有效 + 订单总量为正整数”的产品才开放预约。
- 满足条件的产品从导入时起开放 30 天。
- 订单总量为空或不是正整数的产品保留在标准产品库，但不开放预约。
- 未匹配卖家的产品保留在标准产品库，但不开放预约。
- 后续可由员工在产品库继续维护产品版本与预约需求。

### 3.4 两个特殊 ASIN 的实际状态

| ASIN | 归并结果 | Staging 当前状态 |
| --- | --- | --- |
| `B0GR5C43PG` | 已将 live 行 36、43、44、45 归并为一个标准产品 | 订单量分别为 1、1、2、4，但没有可靠卖家映射，原因 `UNMAPPED_SELLER`，因此未开放 |
| `B0GRMRV64K` | 当前卖家映射为 `ido-mango / szgavin68`；历史 `ygbceping / shiguo0317` 已排除 | 当前行订单总量为空，原因 `NO_POSITIVE_INTEGER_ORDER_TOTAL`，因此未开放 |

这两个 ASIN 都已存在于 `standard_products`，但当前均没有 ACTIVE offering，不会出现在可领取预约任务中。

## 4. 本次代码和功能改动

### 4.1 当前产品与单卖家映射

提交：`4cf2fff56367d3c5cd9f35110bac077d8e8e59dd`

主要改动：

- 新增 current reservable manifest 到稳定、幂等的 Staging 导入计划。
- 生成标准产品、卖家组织、店铺、seller offering、产品版本和 demand batch 的稳定 ID。
- 不通过重新运行消耗 `seller_channels.next_sequence`。
- Amazon 产品进入现有预约运行时；两个 Rakuten 标识只写入平台产品身份，不创建 Amazon 预约对象。
- 同 ASIN 不会因行重复而错误合并不同订单量或评价要求。
- 图评、文评和混合评价被拆成对应任务；无法可靠识别时保守回退为 `TEXT`，要求员工复核。
- 导入 SQL 使用稳定 ID 与 `INSERT OR IGNORE`，具备重复执行边界。

主要文件：

- `tools/imports/current-product-seller-mapping/index.ts`
- `tools/imports/current-product-seller-mapping/staging-import-plan.ts`
- `tools/imports/current-product-seller-mapping/staging-import-sql.ts`
- `scripts/dry-run-staging-current-reservable-import-plan.mjs`
- `openspec/changes/current-reservable-product-seller-mapping/`

### 4.2 修复产品库无法打开/编辑全部产品

提交：`3d4d0a5c705d112890f23b7e1031077224e20148`

问题原因：Staff 产品详情查询在 demand batch 排序时使用了错误时间字段，导致详情接口失败，页面统一显示“操作未完成，请核对输入后重试”。

修复内容：

- 将 demand batch 排序字段从 `demand.created_at` 改为真实存在并符合业务语义的 `demand.submitted_at`。
- 增加“创建产品后立即读取产品详情”的回归测试。

主要文件：

- `apps/api/src/product-reservation-scheduling/read-model.ts`
- `apps/api/src/catalog/catalog.test.ts`

### 4.3 修正搜索关键词

提交：`f5998a33b6609982ab04c48ba8478ec47aac2bc1`

原问题：初始导入把产品名和 ASIN 当作搜索关键词，没有使用腾讯表格“搜索关键词”列。

修复内容：

- 从当前腾讯工作表的“搜索关键词”字段读取关键词。
- 一行一个关键词，去掉“关键词1：”等标签，保留原顺序并去重。
- 不再把 ASIN 当成买家搜索词。
- 没有关键词时才回退为产品名。
- Staging 中 31 个已开放导入产品全部创建了 version 2 并切换为当前版本；当前版本中包含 ASIN 作为关键词的数量为 0。
- 示例：太阳镜 `B0HBWS4YB8` 当前 version 2 的关键词为 `["サングラス"]`。

主要文件：

- `tools/imports/current-product-seller-mapping/index.ts`
- `tools/imports/current-product-seller-mapping/staging-import-plan.ts`
- `tools/imports/current-product-seller-mapping/staging-import-plan.test.ts`

### 4.4 恢复全部历史卖家客户目录

提交：`3e1d17bc9d96fa0826f455ef59e7a8ac98643756`

原问题：卖家客户页面只显示获客 lead，历史卖家没有进入页面，所以看起来只有约 10 个客户。

修复内容：

- 从四个冻结目录建立 146 个唯一卖家微信映射。
- 将可识别历史卖家建立或关联为正式 seller organization。
- 历史导入不会创建 acquisition lead，不重复计入“新增客户”。
- 新增 Staff API：`GET /api/staff/customer-onboarding/seller-directory`。
- Owner 和 seller_ops 可按自己的 Marketplace 范围读取卖家目录。
- 卖家客户页面改为读取正式 seller organization 目录，并显示总数、站点、历史文件数量和网站账号状态。
- 导入采用稳定 ID；如果同一微信已存在正式 seller organization，则关联已有组织，不重复创建。

主要文件：

- `tools/imports/historical-seller-customers/index.ts`
- `tools/imports/historical-seller-customers/staging-sql.ts`
- `apps/api/src/customer-onboarding/historical-seller-directory.ts`
- `apps/api/src/customer-onboarding/routes.ts`
- `apps/web/src/staff/acquisition/CustomerIntakeWorkspace.tsx`

### 4.5 在卖家客户页面显示产品名字

提交：`1311522ddeedb1d73bb38c8117a8ea2eb94312c7`

修复内容：

- 从冻结文件标题中分离产品名、卖家微信和渠道别名。
- 生成 146 个冻结卖家的 seller-to-product 静态映射。
- 卖家客户页面新增“合作产品”列。
- 同一卖家关联多个历史产品时全部显示并去重。
- 典型示例：`Michael_er → 紫光灯`、`yinxc520 → 贴纸`、`w903488068 → 成人`。
- 文件标题没有有效产品名时显示“未标注产品”，不虚构产品名。

主要文件：

- `apps/api/src/customer-onboarding/frozen-historical-seller-products.ts`
- `apps/api/src/customer-onboarding/historical-seller-directory.ts`
- `tools/imports/historical-seller-customers/index.ts`
- `apps/web/src/staff/acquisition/CustomerIntakeWorkspace.tsx`

### 4.6 买家和卖家微信号取消脱敏显示

提交：`17dca59ee96c497694b4bd9c53fcc7798520e1da`

修复内容：

- 卖家客户目录直接返回并显示完整 `display_wechat`。
- 买家 acquisition lead 仍以 AES-GCM 加密数据存储；只有通过 Staff 权限和 Marketplace 范围校验后的接口响应才解密显示完整微信号。
- 没有把买家微信改为数据库明文存储。
- Buyer/Seller 门户隔离、Staff 角色权限、Marketplace scope 和 Customer Security secret 校验均保留。
- 已匿名化的 lead 不会恢复原微信号。

主要文件：

- `apps/api/src/acquisition/privacy.ts`
- `apps/api/src/acquisition/leads.ts`
- `apps/api/src/acquisition/routes.ts`
- `apps/api/src/customer-onboarding/historical-seller-directory.ts`

## 5. Staging 导入结果

### 5.1 当前产品导入计划

| 项目 | 数量 |
| --- | ---: |
| 当前标准产品（Amazon + Rakuten 标识） | 92 |
| Amazon 运行时标准产品 | 90 |
| Rakuten identity-only | 2 |
| seller organization（本次产品导入涉及） | 10 |
| 已匹配并创建的 seller offering | 31 |
| 已开放产品 | 31 |
| 已发布预约任务 | 31 |
| 缺少卖家映射 | 54 |
| 订单总量为空/非正整数 | 13 |
| 暂停、异常或隔离 | 10 |

31 个本次导入任务的开放时间：

- 开放：2026-08-21 14:27:57（Asia/Shanghai）
- 下单截止：2026-09-20 14:27:57（Asia/Shanghai）
- 时长：30 天

### 5.2 2026-08-21 最新只读核对的 Staging D1 总量

以下是整个 Staging D1 当前总量，不全等于本次导入增量：

| 表/业务事实 | 当前数量 |
| --- | ---: |
| ACTIVE `standard_products` | 90 |
| ACTIVE `seller_product_offerings` | 31 |
| OPEN `product_reservation_openings` | 31 |
| ACTIVE legacy `products` | 32 |
| `product_versions` | 63 |
| PUBLISHED `demand_batches` | 33 |
| ACTIVE seller organizations | 148 |
| ACTIVE buyer customers | 6 |
| ACTIVE acquisition leads | 7 |

`products=32`、`demand_batches=33` 是整个 Staging 数据库总量；本次 import batch 对应的开放产品和已发布任务均为 31，不能把总量差额误认为本次多导入。

## 6. 验证与测试

本次完成并通过的验证包括：

- 当前产品/卖家映射只读 dry-run：PASS。
- 历史卖家目录 dry-run：PASS（184 / 155 / 146 / 29）。
- 历史卖家目录、产品名映射、API contract 定向测试：6 项 PASS。
- 买家微信授权解密、卖家完整微信、权限及 acquisition 回归测试：34 项 PASS。
- `@ygb/api` TypeScript typecheck：PASS。
- `@ygb/web` TypeScript typecheck：PASS。
- Web production build：PASS。
- Wrangler Staging dry-run：PASS。
- Cloudflare 部署状态：当前版本 100% 为 `bf875556-b43e-4231-8d0f-9122e585331a`。
- 部署后 D1 只读统计：所有查询 `success=true`、`rows_written=0`。

GitHub-hosted Remote CI 本次没有形成新证据；不得将本地测试或 Staging 部署写成 Remote CI PASS。

## 7. Git 状态与提交顺序

当前工作目录：

`/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller`

当前分支：`fix/product-catalog-detail-ordering`

6 个功能提交（基于 `origin/main@30ef53d`；其中首个 `4cf2fff` 已通过 PR #111 合入 `origin/main@5a186d4`）：

1. `4cf2fff` — `feat: seed current reservable seller mapping`
2. `3d4d0a5` — `fix: restore staff product detail reads`
3. `f5998a3` — `fix: import Tencent search keywords`
4. `3e1d17b` — `fix: restore frozen historical seller directory`
5. `1311522` — `fix: show historical seller product names`
6. `17dca59` — `fix: show full customer WeChat IDs to staff`

当前状态：

- `origin/main@5a186d4` 已包含 `4cf2fff`；其余 5 个修复、manifest 归档与本文档修订通过后续 PR 合入 `main`。
- Staging Worker 部署自 `17dca59`，包含本列表全部功能。
- 仓库可见性自 2026-08-21 起为 public；GitHub Actions 已恢复可用。

## 8. 已知边界与待办

### 8.1 需要人工确认的数据

- 29 个历史文件没有可靠卖家微信，暂未导入卖家身份。
- 部分冻结文件名无法可靠提取产品名，页面显示“未标注产品”。
- 54 个当前标准产品没有卖家映射，因此不开放。
- 13 个产品没有正整数订单总量，因此不开放。
- Somiso `B0GR5C43PG` 当前仍缺可靠卖家映射；如果需要开放，必须在产品库或正式来源中补卖家关系，不能只靠 ASIN 推断。
- `B0GRMRV64K` 已确定卖家来源，但订单总量为空；按 Owner 规则保持不开放。

### 8.2 数据同步边界

- 腾讯文档不是运行时数据库，不会自动同步到 D1。
- 本次导入是一次性只读快照；腾讯文档后续变化不会自动出现在网站。
- 后续日常产品修改应在 Staff 产品库完成。
- 修改产品信息会创建新版本；已经发布的需求继续保留其发布时版本，除非另有明确业务决定和迁移。

### 8.3 发布边界

- 当前只有 Staging 上线。
- 生产 Worker、D1、R2、Access、Secrets、DNS 和 Migration ledger 尚未完成正式放行核验。
- 不得因为 Staging 正常就创建或恢复生产资源。
- 生产仍为 `NO-GO`，需要单独 Owner 授权和 Production Gate 流程。

## 9. 建议交接顺序

1. 使用 Owner 或相应岗位账号登录 Staging。
2. 在“产品库”随机打开多个产品，确认详情与编辑页不再报错。
3. 检查太阳镜 `B0HBWS4YB8`，确认关键词显示为 `サングラス`，而不是 ASIN。
4. 在“卖家客户”确认显示约 148 个正式卖家组织、完整微信号和“合作产品”列。
5. 在“买家客户”确认授权员工能看到完整微信号。
6. 在买家端确认只出现 31 个本次满足开放条件的预约需求。
7. 对 Somiso、`B0GRMRV64K`、未标注产品和 29 个未解析历史文件单独做业务复核。
8. 业务验收后，将剩余提交合入最新 `main`（首个提交已通过 PR #111 合入）。
9. 合入 `main` 不等于生产上线；生产部署必须另行授权。

## 10. 禁止误解的事项

- 本次没有修改腾讯文档。
- 本次没有把买家微信以明文写入数据库。
- 历史卖家导入不计入新增客户。
- 标准产品存在不等于已经开放预约。
- seller mapping 存在但订单总量为空时，仍不开放。
- Staging 数据和测试通过不代表 Production GO。
- 当前 Staging 版本来自尚未合并进 GitHub `main` 的本地提交。
