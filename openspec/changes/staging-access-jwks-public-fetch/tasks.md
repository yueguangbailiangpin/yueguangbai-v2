## 1. Runtime contract

- [x] 1.1 Record that the merged redirect repair still fails closed at `JWKS_FETCH` on real staging.
- [x] 1.2 Confirm the current Cloudflare Worker-to-Worker global fetch contract and Access JWKS endpoint contract.
- [x] 1.3 Audit API global outbound fetch usage and select the minimum compatibility flag.
- [x] 1.4 Require the exact flag in staging and production templates, release preflight and the static release-configuration verifier.
- [x] 1.5 Add fail-closed tests for missing, private-origin and expanded flag sets.
- [x] 1.6 After independent review, pin one exact Access team origin across shared validation, runtime, readiness and both preflight layers; add self-loop and arbitrary-host negatives.

## 2. Verification and delivery

- [x] 2.1 Run focused preflight tests, strict OpenSpec validation, type/build checks and `git diff --check`.
- [x] 2.2 Run the full repository check and secret scan.
- [x] 2.3 PR #120 更新为全量流+固定 SHA 审查记录（Codex 四轮只读审查，终批 1457d251；机器本地日志 /tmp/codex_*.md）。
- [x] 2.4 合并完成（merge commit 5c72627e）；树一致性证明：merge-tree 结果树=HEAD 树=858db6f9（与 release:check candidate 树三方吻合），零冲突。
- [x] 2.5 完成（2026-09-01）：preflight 校验过（errors 空、operator 字段全备）；merged SHA 5c72627e 已部署（51 资源）；staging D1 经 Owner 授权重置（备份 1.8MB 存档）后全新 41 迁移至 schema 41；Access 隔离门验证（302→cloudflareaccess，aud 吻合）；Owner bootstrap 证明（STAGING_FIRST_OWNER_BOOTSTRAPPED，owner 角色，production_touched=false）。证据：evidence.md。
- [x] 2.6 T9 登记册 v5 终版完成（五轮走查）：**62 PASS / 0 FAIL / 3 CONFLICT / 2 BLOCKED**（仅剩 H05 大陆网络+H07 生产授权外部依赖）。STAGING_ACCEPTED 成立；PRODUCTION 仍 NO_GO。五轮累计发现并修复 T9-DEFECT-001（买家首号补零）/002（卖家创建端点）/004（激活端点）/005（幂等 409）+ B09（冻结端点）+ 409 文案，全部实测验证关闭。登记册=T9_REGISTER_2026-09-01.md，证据=t9-evidence-2026-09-01/。
