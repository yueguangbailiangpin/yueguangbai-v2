# Frontend Route Code-Splitting Performance Evidence

## Reproducibility

- Baseline commit, `HEAD`, `origin/main`, and merge base before implementation: `ff580939ea4ded21762727ebba345480c4157b34`.
- Node `v24.18.1`; npm `11.16.0`; `package-lock.json` SHA-256 `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`.
- Commands: `npm ci --ignore-scripts` with a worktree-local npm cache, then `npm run build --workspace @ygb/web`. Chunk sizes below are `wc -c` and `gzip -9 -c` of that production output.
- Cold condition: production `vite preview` loopback server, Chromium at 1440×900, one browser instance, a new context for every serial run, deterministic local API fixtures, no HTTP cache, no throttling, and three runs per identity. JavaScript bytes are fetched `assets/*.js` response bodies. Visible and interactive are `performance.now()` DOM-observer timestamps for the representative route heading and control; the separately recorded Playwright polling wait is not a paint measure.

## Production bundle inventory

| Build | Asset | Raw bytes | gzip bytes |
| --- | --- | ---: | ---: |
| Before | `index-DDMyrN38.js` | 650,256 | 176,114 |
| Before | `index-Vs7GsPaH.css` | 44,381 | 8,889 |
| After | `index-C0k1iaGC.js` | 245,562 | 74,271 |
| After | `session-invalidation-CbTwbbhc.js` | 150,228 | 44,847 |
| After | `StaffRouteModule--njfCNzP.js` | 76,845 | 19,418 |
| After | `index-Vs7GsPaH.css` | 44,381 | 8,907 |
| After | `SellerRouteModule-Bgl9qgDE.js` | 33,358 | 8,914 |
| After | `ProtectedFileButton-Dd0Xzwaw.js` | 21,828 | 7,576 |
| After | `BuyerOrderRouteModule-BPO-zLMS.js` | 21,756 | 5,866 |
| After | `useFileUpload-Degnxz2g.js` | 20,833 | 5,854 |
| After | `StaffSchedulingRouteModule-BRGvC-Ig.js` | 19,768 | 5,976 |
| After | `file-read-controller-DcIVRBUk.js` | 15,782 | 4,700 |
| After | `BuyerRouteModule-DifaWqIm.js` | 15,185 | 4,210 |
| After | `BuyerAfterSalesRouteModule-B5GyaLSN.js` | 15,128 | 4,235 |
| After | `StaffAdminRouteModule--vmzdSza.js` | 12,527 | 4,101 |
| After | `src-DLlvdkD1.js` | 5,451 | 1,775 |
| After | `BuyerMutationRecovery-sJ8wsxF0.js` | 3,676 | 1,668 |
| After | `useMutation-CmBy3J7N.js` | 2,285 | 991 |
| After | `customer-auth-api-CdcVX7wz.js` | 1,041 | 569 |
| After | `StaffCallbackModule-gVaxUd3_.js` | 283 | 261 |

The initial entry is 245,562 raw bytes, below Vite's 500 kB default. Every emitted JavaScript chunk is below 500 kB; the largest is the 245,562-byte entry. The build emits no chunk-size warning, keeps `sourcemap: true`, and does not configure `chunkSizeWarningLimit`.

## Chosen boundaries and demand evidence

- `App.tsx` owns the small static route table and authentication/forced-password boundaries. Only after `CustomerSessionBoundary` or `StaffSessionBoundary` succeeds can it load the matching Buyer, Seller, or Staff portal.
- Buyer keeps product, demand, reservation, and instruction pages in its 15,185-byte portal. Order-material/detail/form and account pages form the 21,756-byte `BuyerOrderRouteModule`; review/refund form, detail, and list pages form the 15,128-byte `BuyerAfterSalesRouteModule`. Thus `/buyer/products` has neither group as a prerequisite.
- Staff keeps the 76,845-byte workbench and acquisition workspace together: acquisition has no measured size that justifies another request. The 12,527-byte business dashboard and 19,768-byte product/reservation scheduling workspace load only on their matching routes.
- Seller remains one 33,358-byte portal. It is below the measured heavy-group range and splitting it would add a request without a meaningful transfer saving.
- Browser request assertions prove `/buyer/products` does not request either Buyer follow-up chunk and `/staff` does not request dashboard or scheduling chunks; after navigation to their routes the matching chunk is first requested. Existing direct-deep-link and refresh coverage still exercises the same static children through `Outlet`.

## Three-run cold-start results

| Identity | Before visible / interactive ms (median) | After visible / interactive ms (median) | Before → after JS bytes (median) | Before → after requests |
| --- | ---: | ---: | ---: | ---: |
| Buyer | 93.3/93.3, 80.7/80.7, 78.2/78.2 → **80.7/80.7** | 365.6/365.6, 356.7/356.7, 355.2/355.2 → **356.7/356.7** | 650,256 → 458,753 | 1 → 8 |
| Seller | 95.3/95.3, 84.0/84.0, 78.3/78.3 → **84.0/84.0** | 370.6/370.6, 359.8/359.8, 357.8/357.8 → **359.8/359.8** | 650,256 → 460,149 | 1 → 7 |
| Staff | 91.7/91.7, 78.3/78.3, 76.3/76.3 → **78.3/78.3** | 369.0/369.0, 358.7/358.7, 360.4/360.4 → **360.4/360.4** | 650,256 → 518,027 | 1 → 8 |

The prior micro-chunk sample is invalidated: it issued 11 Buyer and 14 Staff portal requests and used Playwright locator polling, yielding a non-comparable roughly 0.84 s result. The coarse portal plus only evidenced follow-up groups keeps current observer medians at 0.357–0.360 s; no representative route shows that invalidated 0.84 s regression. The first-run resource trace shows the post-session portal and its required shared dependencies start together, not as a page-by-page waterfall.

## Security, verification, and rollback

- Browser coverage includes direct deep links and refresh, login/logout, forced password, 401/403, Personal DENY, cache isolation, chunk failure/reload, keyboard/reduced-motion/zoom, cross-identity chunk isolation, and the new on-demand chunk assertions. A failed import has a Chinese alert and an explicit user-triggered whole-page reload; it does not loop or reveal protected content.
- The static boundary is outside each dynamic portal, so a rejected customer or staff session does not start a sensitive identity import. No prefetch is used.
- Module 1's precise allowlist includes only the four new UI route modules. Its composition checks reject `/api/` and `fetch(` in all changed route modules; no API/contract, schema, migration, database, permission, or cache-isolation behavior is added.
- Rollback is source-only: restore static identity imports in `App.tsx` and remove portal/route-module boundaries. The baseline build proves this restores the 650,256-byte entry. No migration, production resource, or external write is involved.

Controller Implementation Verify passed on 2026-08-08 (Asia/Shanghai). The controller independently reran `npm run check` (193 files / 1271 tests), the complete Playwright browser/accessibility suite (159/159), target/all OpenSpec strict validation (41/41), and `git diff --check`; no implementation/spec mismatch or unresolved performance budget exception remains. Archive and Git integration are the next controlled steps; no production deployment or external activation is authorized by this acceptance.
