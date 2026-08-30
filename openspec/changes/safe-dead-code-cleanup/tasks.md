## 1. Migration

- [x] 1.1 Confirm no database migration, D1 replay, remote resource, deployment, or data migration is required for this cleanup.

## 2. Contracts

- [x] 2.1 Move the current staff assignments response validation into the canonical staff runtime contract and route the retained invalidation tests through current buyer/seller/staff clients.
- [x] 2.2 Confirm buyer and seller DTO isolation remains covered by their existing canonical schemas; do not alter API response contracts.

## 3. Domain and API

- [x] 3.1 Remove the broken acquisition script and prune only the missing seller rate test paths.
- [x] 3.2 Remove the orphan keyword-generator template while preserving retired-service preflight tombstones.
- [x] 3.3 Remove the protected-resource schema copy, the access-management re-export shell, the retired customer-security panel and its obsolete test consumers.
- [x] 3.4 Remove only retired `/mcp` API whitelist entries and the `VER` debug output; preserve active routes, compatibility KDF labels, and security guards.

## 4. Tests

- [x] 4.1 Update retained session invalidation, staff access-management, and customer password-reset tests without deleting active behavior coverage.
- [x] 4.2 Add focused assertions that retired `/mcp` paths are not API requests and current staff assignments remains a protected endpoint.

## 5. Verifier

- [x] 5.1 Run focused tests, `npm run test:seller-principal-rate-bootstrap`, typecheck, build, check, full tests, and direct candidate/protection scans; capture command exit codes.
- [x] 5.2 Run current OpenSpec strict validation and all-change strict validation, then run `git diff --check` and inspect status/diff scope.
- [x] 5.3 Create one normal commit containing only this Change and its implementation; verify final branch, HEAD, commit SHA, and clean worktree without push or deployment.
