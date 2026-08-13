# Local Acceptance

- `npm run test:production-health-monitor` 覆盖 `/ready` full envelope；本 Change 不把历史 `/health` 结果冒充为 `/ready` 验收。
- `npm run test:final-production-go` 与 `npm run verify:final-production-go:local` 覆盖 canonical 双 workflow allowlist、未知 workflow、deploy command、危险 trigger、缺 canonical workflow 和 Schema65 当前操作文档一致性。
- 本修复只运行 static-governance 等价的定向 gates；不重跑 full `npm test`、`npm run check` 或 E2E。`npm run release:check` 在干净已提交候选上仍会串行执行其完整本地 gates，不能从本次定向运行推导 PASS。
- Migration decision: `NO_SCHEMA_CHANGE`；未新增、修改或执行 Migration。
- 本地阶段生产外部调用、GitHub Issue 写入、Cloudflare/飞书/D1/R2 写入与部署均为 0。
- 外部接收器验收另见 `external-acceptance.md`。
