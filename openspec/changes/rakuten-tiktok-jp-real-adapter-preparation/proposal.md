# Rakuten and TikTok Japan Real Adapter Preparation

## Why

`RAKUTEN_JP` 与 `TIKTOK_JP` 已有平台、币种、平台中性标识、Seller Organization/Store scope、正式订单/证据与 `adapter_status=UNAVAILABLE` 基础，但尚无真实 Provider contract、官方签名、受限 transport、fake provider、webhook verifier 或机器 preflight。直接把 registry 改成 `AVAILABLE` 会过早解锁仍含 Amazon-only 假设的产品、卖家与财务流程，因此本 Change 只完成默认关闭、可本地复核的真实接入准备。

## What Changes

- 仅依据 Rakuten 与 TikTok Shop 官方资料建立逐项事实矩阵；无法从当前公开 Rakuten RMS 资料确认的认证、签名、API wire contract、分页、限流、错误与事件语义统一标记 `UNKNOWN/BLOCKED`。
- 为两站增加 read-only Provider contract、稳定错误分类和零网络 fake provider；Provider DTO 只承载订单/产品最小白名单字段，不能成为权限、财务或审计权威。
- 为 TikTok Shop 增加官方 origin、HMAC-SHA256 请求签名、订单/产品只读分页查询、有限重试与官方 webhook 原始字节验签的本地可测实现；不注册路由、不接 scheduler、不接 D1 ingestion。
- 为 Rakuten 增加 truthful unavailable adapter；在老板提供当前官方规格工件并通过新一轮审阅前，不构造真实请求，不猜测常见凭证、endpoint 或错误码。
- 增加机器 preflight：只验证仓库外匿名清单和 managed-secret 名称，输出最高为 `LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO`，且始终报告外部调用、Provider 调用、资源写入、Secret 写入和部署为 0。
- 增加回归测试，保留 Rakuten 产品 `R-1`/`S-1`、TikTok 长数字订单号与 `tiktokDLP2555Q`，并证明两站标识不套 Amazon 校验。

## Non-Goals

- 不导入历史订单、产品库、卖家编号或 R2 历史图片；不读取真实 Excel/Tencent Docs/Drive。
- 不注册真实 Rakuten/TikTok 账号或应用，不授权商家，不读取或写入凭证，不调用真实 Provider。
- 不增加 Worker route、webhook receipt、poll cursor/job、connection state、dead letter 或 ingestion service。
- 不修改 registry adapter 状态，不解锁 UI，不绕过 Seller Organization、Store、权限、Personal DENY、财务快照、幂等与审计。
- 不部署、不执行生产 Migration，不写生产 D1/R2/Cloudflare/飞书/MCP，不 push/PR/merge。

## Migration Decision

`NO_SCHEMA_CHANGE`。本 Change 只有 contract、纯签名/验签、注入式只读 transport、fake provider、静态 verifier 与本地 preflight。若后续增加 webhook durable receipt/replay、轮询 cursor/lease/job、店铺连接状态、Provider dead letter 或受控 ingestion，必须另立 Change 并在实施时重新分配 Migration；本 Change 不预占版本号。

## Production Status

即使全部本地测试通过，`RAKUTEN_JP` 与 `TIKTOK_JP` 仍必须保持 `adapter_status=UNAVAILABLE`。本地结果只能表述为 implementation-ready preparation；没有真实凭证、商家授权、测试店铺、回调注册与匿名真实 E2E，生产结论必须是 `PRODUCTION_NO_GO`。
