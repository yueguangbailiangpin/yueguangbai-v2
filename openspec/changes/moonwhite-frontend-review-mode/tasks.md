## Governance and migration

- [x] Re-read the remote feature HEAD and continue from `a97e0b5cedd7610dc17983a0aa6cc75212d520b9`, which includes post-`e58b9ef` fixes.
- [x] Freeze proposal, design, requirements, deployment boundary, rollback, and `Migration = NONE` before source edits.

## Runtime, routes, and fixtures

- [x] Add the Review basename router, home, compact Demo chrome, exact build SHA, and isolated Review QueryClient.
- [x] Add Demo Customer/Staff Session adapters and Seller/Staff role selectors that drive existing permission/capability UI.
- [x] Add centralized Demo API state/fixtures for current Buyer, Seller, Staff, dashboard, rate, access, integrity, and file surfaces.
- [x] Add local-only mutation transitions and fail-closed `REVIEW_MODE_REAL_API_BLOCKED` handling with zero fetch fallback.

## Tests and browser acceptance

- [x] Test Review home and real Buyer three-item navigation, full Seller navigation, five Staff roles, Seller OWNER/FINANCE/VIEWER differences, formal route isolation, and no real Staff Session read.
- [x] Test Review API methods for zero real network requests and exercise representative local mutations.
- [x] Run the Review browser matrix at Buyer 390x844/430x932, tablet 768x1024/1024x1366, and Seller/Staff 1280x720/1366x768/1440x900/1920x1080; record overflow/layout issues without broad redesign.
- [x] Run Web typecheck, Web tests, Review tests, production build, key formal-route regressions, and OpenSpec strict validation with truthful PASS/FAIL.

## Release and stop boundary

- [ ] Commit and push only `feature/frozen-portals-staff-acquisition-core`; do not merge main.
- [ ] Verify Wrangler v4/auth/config, build with the exact final Git SHA, dry-run, and deploy the existing `yueguangbai-v2-production` Worker/Web Assets without migrations or resource changes.
- [ ] Verify online `/review`, Buyer, Seller, Staff, role switching, `/health = 200`, no Review `/api/*` traffic, and unchanged formal Staff isolation; then STOP.
