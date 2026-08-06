# Multi-Marketplace and Multi-Currency Foundation

## Why

当前 Schema、Contract 与领域字段大量把 Marketplace、Amazon、JP 和 JPY 固定在组织、订单、汇率与金额中，无法满足已确认的 Amazon US、Coupang KR、Buyer 单站点和 Seller 多站点规则。继续在 Seller 门户或韩国站上叠加条件分支会放大数据迁移和财务风险。

## What Changes

- 建立平台/站点注册表，首批稳定代码为 `AMAZON_JP`、`AMAZON_US`、`COUPANG_KR`。
- Seller Organization 改为全局主体，Store 成为 Marketplace 归属边界。
- Buyer 保持单 Marketplace，并增加正式事实前的 owner 审计纠正命令。
- 金额改为整数最小货币单位加显式币种，支持 JPY/USD/KRW 付款和 CNY 返款/结算。
- Buyer 日汇率、Seller 协议汇率和服务费规则按 D-016 的组合键版本化。
- 将 ASIN、Amazon Order Number/Date 等平台字段抽象为平台中性事实，由 Marketplace Adapter 执行真实平台校验。

## Non-Goals

- 不开通真实美国站或韩国站。
- 不臆造 Coupang 编号、URL 或 API 规则。
- 不实现 Seller 门户、飞书或 MCP。
- 不改变评论产生返款/服务费的业务模式。
- 不迁移旧生产数据或部署远程资源。

## Migration and Contract Impact

需要一个或多个连续 D1 Migration；仅在该 Change 成为唯一实现 Change 时领取下一可用编号。Migration 必须重建受 JP/JPY CHECK、唯一键和触发器约束影响的表，保留不可变财务事实和断言，禁止通过删除约束简化迁移。Contracts 需要新增 Marketplace/Currency DTO、通用 Money/Rate 字段、平台标识字段和 Adapter 错误语义。

## Dependencies and Order

依赖当前 Module 1 完成治理收尾与稳定基线。该 Change 必须先于 Customer 邀请改造、Seller 完整门户和任何美国/韩国站实现完成。实施期间不得有第二个 Change 创建竞争性 Migration。

## Rollback Boundary

发布前回滚使用旧 Worker 与迁移前 D1 隔离备份；禁止在已写入 USD/KRW 或多站点正式事实后直接降级旧 Schema。灰度期间必须有新旧数据计数、金额哈希和外键对账，失败时停止写入并从隔离备份恢复，不做破坏性逆向 SQL。

## Acceptance

本地新建与升级 D1、全量 Migration verifier、JP 回归、USD/KRW 金额/取整、Buyer 单站点、Seller 多站点、权限隔离、汇率快照、财务不可变和 Contract runtime tests 全部通过后才可 Verify。规划完成不等于实现或站点开通。
