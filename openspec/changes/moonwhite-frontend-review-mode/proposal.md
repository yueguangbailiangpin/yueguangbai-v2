## Why

The production Worker already serves the frozen Buyer, Seller, and Staff frontends, but their real authentication and production-data boundaries prevent a public design review. The owner needs one public, unmistakably Demo-only surface that renders those exact frontends with representative local data and cannot reach production business APIs or file storage.

## What Changes

- Add `/review`, `/review/buyer`, `/review/seller`, and `/review/staff` to the existing web application.
- Reuse the existing BuyerFrame, SellerLayout, StaffShell, route modules, pages, components, CSS, navigation, forms, dialogs, states, tables, and capability-driven visibility.
- Mount the real identity route trees under a Review-specific router basename, with Demo customer/staff sessions and centralized in-memory API/file fixtures.
- Add Buyer lifecycle, Seller store/role, and Staff role/marketplace/capability fixtures with local-only mutation transitions.
- Display a persistent compact Demo marker and build SHA on every Review route.
- Fail closed with `REVIEW_MODE_REAL_API_BLOCKED` for every Review `/api/*` request that is not explicitly handled by the Demo adapter.
- Add unit/browser coverage proving Review isolation, role-sensitive navigation, no real API writes, and unchanged formal identity routes.
- Build, push the named feature branch, and deploy only the existing `yueguangbai-v2-production` Worker/Web Assets after gates pass.

## Capabilities

### New Capabilities

- `moonwhite-frontend-review-mode`: Public, non-persistent, production-isolated review of the real Buyer, Seller, and Staff frontends.

### Modified Capabilities

- None. Formal Buyer, Seller, Staff, Staff Access, API, file, and data contracts remain unchanged.

## Impact

- Web routing, centralized frontend transport selection, Demo fixtures/runtime, Review presentation, tests, and OpenSpec evidence change.
- Existing production Worker assets are updated after a successful release gate; no second Worker or infrastructure is created.
- No API route, API authority contract, D1/R2 binding, Cloudflare Access rule, Staff Session behavior, production data, or migration changes.
- Rollback is a Worker version rollback or revert of the Review-only web commit; no data rollback is needed.
