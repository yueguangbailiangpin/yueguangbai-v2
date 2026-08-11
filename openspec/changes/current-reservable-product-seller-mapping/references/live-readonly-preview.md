# 完整只读预览（冻结 114/109/88）

快照日期：2026-08-09。第 115 行/第 89 个产品按老板决定跳过，不追查、不猜测、不补造。

## 来源与守恒

- 当前白名单工作簿：[DZEZ6a2F2aE1MWHdi](https://docs.qq.com/sheet/DZEZ6a2F2aE1MWHdi?tab=1pne3d)。
- `工作表1`：91 条非空数据行；`飞利浦产品`：23 条非空数据行；合计 114 条。
- 有效标识行 109：Amazon 合法 ASIN 107 行，Rakuten `R-1`/`S-1` 2 行。
- 缺标识隔离行 5：工作表1 第 53、54、69、70、71 行。
- 唯一当前产品 88：Amazon ASIN 86，Rakuten 产品标识 2。
- 完整本地快照由 [full-readonly-manifest.mjs](../../../../tools/imports/current-product-seller-mapping/fixtures/full-readonly-manifest.mjs) 组装，包含 114 条 current、157 条历史命中行和 184 条历史文件索引。
- 这里的“157 条历史命中行”是先扫描 184 个历史文件，再按 marketplace-aware 产品键与当前 88 个产品匹配得到的相关历史行；它不是旧的 1,695 行全量历史事实的缩写或照抄。其余文件按稳定 `scanStatus` 保持隔离，详见四份 inventory JSON。

## 88 个当前产品逐项结果

- [产品 1–30](./full-readonly-product-table-01.md)
- [产品 31–60](./full-readonly-product-table-02.md)
- [产品 61–88](./full-readonly-product-table-03.md)

每行列出 marketplace-aware 产品键、平台标识、current 来源行、映射状态和卖家组织。`JP_RAKUTEN:R-1` 与 `JP_RAKUTEN:S-1` 均为 `MAPPED`，保留为有效产品身份，不冒充 ASIN。

## 映射与异常

- mapped seller offerings：52。
- 映射产品与未解析产品互斥且覆盖全部 88 个产品：51 个产品至少有一个 mapped offering，37 个产品为 unresolved（`51 + 37 = 88`）；52 条 offering 的唯一键 `(productKey, organizationKey)` 为 52。
- 同产品多卖家：1 个，`JP_AMAZON:B0GRMRV64K`；未覆盖或错误合并均不发生。
- 确认卖家但无历史证据：23 个，保留为本地预览结果。
- 未解析当前产品：37 个，稳定列在 dry-run 输出的 `unresolved_current_products`。
- 字段冲突：7 个，稳定列在 dry-run 输出的 `field_conflicts`。
- 当前隔离：5 个，统一为 `MISSING_PRODUCT_IDENTIFIER`。
- GoldHorizon Direct 与 Philips Power オフィシャル均归 `ygbceping:ls381048211`。
- 历史文件索引 184 个；命中产品行文件 26 个；其余 158 个保持未确认/隔离。四个稳定索引文件分别为 [dJwldHrckeFY](./historical-file-inventory-dJwldHrckeFY.json)、[dDUYsBOrYoEk](./historical-file-inventory-dDUYsBOrYoEk.json)、[davLDVdZLoPV](./historical-file-inventory-davLDVdZLoPV.json)、[dhtkJdpmZEgh](./historical-file-inventory-dhtkJdpmZEgh.json)。
- 历史 inventory 扫描状态守恒为：`MATCHED 26`、`NO_CURRENT_MATCH 153`、`EXCLUDED 1`、`NOT_PRODUCT_SOURCE 1`、`NO_PRODUCT_SHEET 3`，合计 184；四文件夹文件数为 `93/51/2/38`。

## 默认 dry-run 实证

默认 `node scripts/dry-run-current-reservable-product-seller-mapping.mjs` 使用完整本地 manifest，不使用 9 行 fixture。manifest hash 为 `1172e8410024a508306e2db150439537fc3c5b75db10a82f423bd9fbb830e393`，输出守恒为 114/109/88，历史文件索引为 184。

## 外部边界与 Migration

- 状态：`LOCAL_READONLY_PREVIEW`。
- 外部调用、腾讯文档写入、数据库写入、账号创建、邀请发送、部署：全部 0。
- Migration：none；Migration 0040 未执行。
- 本地预览不创建卖家登录、不开放预约、不写生产 D1/R2。
