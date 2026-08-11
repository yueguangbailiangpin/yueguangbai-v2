# Local Git hygiene audit

Audit date: 2026-08-11
Final product ref: `feature/frozen-portals-staff-acquisition-core`
Cleanup worktree: `chore/final-stabilization-cleanup`

This is a local-machine hygiene record. It does not assert or mutate GitHub branch state.

## Result

| Item | Before | After | Action |
| --- | ---: | ---: | --- |
| Registered worktrees | 118 | 5 | Removed 113 clean worktree checkouts after verifying every checkout had a local branch |
| Local branches | 121 | 34 | Deleted 87 local branch refs whose tips were ancestors of the final product ref |
| `origin/*` refs | 108 | 108 | No remote ref was changed |
| Top-level legacy delivery artifacts | 87 / 31 MiB | 0 in `~/Projects` | Moved to a dedicated macOS Trash directory; not permanently erased |

The recoverable Trash location is `/Users/yueguangbai/.Trash/yueguangbai-v2-legacy-artifacts-20260811-ma2cFw`.

## Preserved worktrees

- `/Users/yueguangbai/Projects/yueguangbai-v2`: dirty; user-owned main checkout
- `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/controlled-production-data-import`: dirty; five uncommitted paths
- `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/final-stabilization-cleanup`: current cleanup worktree
- `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/frozen-portals-staff-acquisition-core`: named final product checkout
- `/Users/yueguangbai/.codex/worktrees/72491d56-dc91-4a2f-84e2-1cd3a2a85028/integration-openspec-ponytail-governance-bootstrap`: Codex-managed detached checkout

## Preserved non-merged local branches

These 30 branch tips are not ancestors of the final product ref. Their worktree directories were removed because they were clean and reconstructible, but their local branch refs were retained to avoid losing potentially unique commits.

| Branch | Tip | Commits not in final ref | Upstream |
| --- | --- | ---: | --- |
| `chore/archive-staff-four-role-consolidation` | `5ed1f338dbcd` | 1 | `origin/chore/archive-staff-four-role-consolidation` |
| `chore/frontend-route-code-splitting-performance` | `3fddd37f67ab` | 1 | `origin/chore/frontend-route-code-splitting-performance` |
| `chore/post-m10-product-governance` | `4156c606aff0` | 4 | `origin/chore/post-m10-product-governance` |
| `feature/admin-business-dashboard` | `fdd856b99c0f` | 2 | `origin/feature/admin-business-dashboard` |
| `feature/feishu-production-app-operational-alert-readiness` | `6abcfb120e6d` | 1 | `origin/main` |
| `feature/frontend-runtime-loading-performance-v2` | `20588099350b` | 1 | `origin/feature/frontend-runtime-loading-performance-v2` |
| `feature/google-drive-cold-archive-production-preflight` | `45db5deae26c` | 2 | `origin/main` |
| `feature/phase3c-files` | `2f1e06c0221f` | 2 | `origin/feature/phase3c-files` |
| `feature/phase3c2-file-audience-grants` | `94001c131be2` | 3 | `origin/feature/phase3c2-file-audience-grants` |
| `feature/phase3d-order-evidence` | `62d9a8cff1d3` | 2 | `origin/feature/phase3d-order-evidence` |
| `feature/phase3e-pricing` | `0531d840b9e6` | 2 | `origin/feature/phase3e-pricing` |
| `feature/phase3f-formal-orders` | `83bf7264bdfe` | 2 | `origin/feature/phase3f-formal-orders` |
| `feature/phase4a-http-auth` | `9fe3b0288b44` | 2 | `origin/feature/phase4a-http-auth` |
| `feature/phase4a2-buyer-self-registration` | `991694f8f74c` | 3 | `origin/feature/phase4a2-buyer-self-registration` |
| `feature/phase4b1-buyer-portal-api` | `4f8e409bbe1a` | 3 | `origin/feature/phase4b1-buyer-portal-api` |
| `feature/phase4b2-buyer-order-evidence-api` | `c16b949130b7` | 2 | `origin/feature/phase4b2-buyer-order-evidence-api` |
| `feature/phase4b3-buyer-formal-order-api` | `1555064d732a` | 3 | `origin/feature/phase4b3-buyer-formal-order-api` |
| `feature/phase4b4-buyer-review-api` | `1b1bc20b216d` | 2 | `origin/feature/phase4b4-buyer-review-api` |
| `feature/phase4b5-buyer-refund-status-api` | `5b51c1323568` | 2 | `origin/feature/phase4b5-buyer-refund-status-api` |
| `feature/phase4c1-seller-portal-api` | `09296d43b8da` | 4 | `origin/feature/phase4c1-seller-portal-api` |
| `feature/phase4c2-seller-formal-order-api` | `88c78f2b5c58` | 2 | `origin/feature/phase4c2-seller-formal-order-api` |
| `feature/phase4c3-seller-review-api` | `f2ad39f8a207` | 2 | `origin/feature/phase4c3-seller-review-api` |
| `feature/phase5b-buyer-refunds` | `1c2b60ae7bc5` | 3 | `origin/feature/phase5b-buyer-refunds` |
| `feature/rakuten-tiktok-jp-real-adapter-preparation` | `c27028afbee2` | 2 | none |
| `feature/seller-principal-rate-bootstrap` | `abd6f77be2b1` | 1 | `origin/main` |
| `feature/staff-acquisition-funnel-workbench` | `08597ca5e166` | 2 | `origin/feature/staff-acquisition-funnel-workbench` |
| `feature/staff-mcp-ai-production-enablement-prep` | `f5bf06da36d7` | 1 | none |
| `integration/admin-business-dashboard` | `fdd856b99c0f` | 2 | `origin/integration/admin-business-dashboard` |
| `integration/frontend-runtime-loading-performance-v2` | `20588099350b` | 1 | `origin/integration/frontend-runtime-loading-performance-v2` |
| `integration/staff-acquisition-funnel-workbench` | `08597ca5e166` | 2 | `origin/integration/staff-acquisition-funnel-workbench` |

## Recovery

A removed worktree can be recreated from a retained branch with `git worktree add <path> <branch>`. Deleted merged local branch refs remain reachable through the final product ref and, where present, through unchanged remote refs. The 87 non-Git delivery artifacts can be restored by moving them out of the Trash directory above.
