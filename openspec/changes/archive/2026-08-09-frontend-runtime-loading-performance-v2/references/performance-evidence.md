# Frontend Runtime Loading Performance V2 Evidence

## Environment

- Baseline commit: `cace231f2249aaf28d68677bce2483980c8b248d`
- Node: `v24.18.1`
- npm: `11.16.0`
- Lockfile SHA-256: `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`
- Browser: bundled Playwright Chromium
- Method: production `vite build`, loopback preview, disabled cache, three fresh browser contexts per identity; median is the middle of three login-click-to-workbench-heading samples.
- Interpretation: these are local laboratory measurements, not production LCP, INP or CLS.

## Matching-environment runtime results

| Identity | Baseline visible median | After visible median | Baseline post-login JS | After post-login JS | JS reduction | Baseline requests | After requests |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Buyer | 350.0 ms | 353.0 ms | 66,799 B | 40,216 B | 39.8% | 5 | 6 |
| Seller | 350.0 ms | 351.6 ms | 70,698 B | 36,149 B | 48.9% | 4 | 4 |

Buyer after samples were 361.4/353.0/343.9 ms. Seller after samples were 351.6/351.5/352.1 ms. The visible-time differences are within local-run noise; the deterministic improvement is that the default workbenches parse substantially less JavaScript. Buyer has one additional small request because shared helpers are now independently cached, while total transferred JavaScript is lower.

The earlier Vite development preview decoded about 11.7 MB across 48 login-shell resources and triggered about 80 Buyer or 77 Seller post-login resources. The repository-owned local production preview now exercises hashed production assets, so it is the supported local experience URL.

## Production bundle inventory

The table uses exact raw bytes and the same local `gzip -9` command for both trees; Vite's rounded build output remains available in the command transcript.

| Chunk | Baseline raw/gzip | After raw/gzip | Acceptance note |
| --- | ---: | ---: | --- |
| Initial entry | 245,637 / 74,169 B | 245,784 / 74,236 B | Raw +147 B (0.06%) and gzip +67 B (0.09%) for dynamic-import mapping; both remain within the explicit 1% guard. |
| Buyer default route | 19,145 / 4,868 B | 14,955 / 4,082 B | Instruction view removed from default route. |
| Buyer instruction route | included above | 4,910 / 1,782 B | Loaded only on the protected instruction route. |
| Protected file read | 22,904 / 8,037 B plus 15,723 / 4,656 B | 1,830 / 1,092 B plus 15,806 / 4,684 B | No longer requested by the default Buyer dashboard. |
| Seller default route | 40,890 / 10,579 B | 18,794 / 5,238 B | Submission pages removed from default route. |
| Seller layout | included above | 13,438 / 4,367 B | Shared authenticated shell. |
| Seller submission route | included above | 9,786 / 3,382 B | Loaded only on product/demand submission routes. |
| File upload | 20,781 / 5,804 B | 20,864 / 5,833 B | No longer requested by the default Seller dashboard. |
| Largest JavaScript chunk | 245,637 B | 245,784 B | No JavaScript chunk exceeds 500 kB. |

## Rejected experiment

An authentication-success preload was tested and removed. It changed the Buyer median from 350.0 ms to 369.9 ms and added a request without reducing required work. The accepted implementation instead moves measurable Buyer instruction/file-read and Seller submission/upload dependencies behind existing authenticated route boundaries.

## Safety and external state

- `NO_SCHEMA_CHANGE`; no Migration, API, Contract, Domain, financial, permission or file Audience change.
- Preview identities and data are anonymous and process-local; process exit destroys them.
- No Cloudflare, D1, R2, domain, DNS, Drive, Feishu, MCP, Secret, production data, deployment or external write was used.
- Rollback is source-only: remove the preview/measurement scripts and restore the two route imports.

## Acceptance verification

- Focused on-demand browser checks: 2/2 passed.
- Complete Chromium suite: 181 passed; 1 pre-existing manual-environment check skipped.
- Complete `npm run check`: 205 test files and 1,325 tests passed; Web 445/445; workspace typechecks/builds, local Wrangler dry-run, security verifiers and Migration 0001–0038 validation passed.
- Dependency risk: 0 vulnerabilities at every severity.
- Static production output: 27 files, 0 source maps, 0 external calls.
- OpenSpec strict validation: 1/1 valid.
- Final process-local smoke: Buyer `/buyer` rendered `当前开放产品`; Seller `/seller` rendered `业务进度`; Staff `/__test/staff-login` reached `/staff` and rendered `员工工作台`.
- Preview shutdown was exercised with `SIGINT`; its in-memory database was closed and the same loopback port was subsequently reused successfully.
