## Why

将已确认的当前预约产品与历史卖家资料修正规则落到本地预览层，供后续经过审核的数据导入使用。

## What Changes

- 当前摘要仍是预约白名单；历史资料只提供卖家来源证据。
- 暂停行与飞利浦空白异常行隔离。
- Somiso JP 四行使用 ASIN `B0GR5C43PG` 归并为一个产品。
- `B0GRMRV64K` 的 `ygbceping / shiguo0317` 保留历史证据但不作为可用供给，只保留 `ido-mango / szgavin68`。

## Non-Goals

不读取或写入腾讯文档，不执行 D1 远程导入，不部署 Cloudflare，不生成缺失的实时源数据。
