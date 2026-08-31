## 1. Scope and evidence

- [x] 1.1 Confirm the fixed branch, HEAD, clean worktree, and ahead count before editing.
- [x] 1.2 Read `AGENTS.md`, the completed `safe-dead-code-cleanup` Change, D-056/6.6 historical handoffs, and both candidate files.
- [x] 1.3 Record tracked/hidden-worktree scans and AST-resolved import/export/dynamic-loader evidence for both candidates.

## 2. Source cleanup

- [x] 2.1 Delete only `apps/api/src/customers/allocate-buyer-number.ts` and `apps/api/src/pricing/index.ts`.
- [x] 2.2 Confirm canonical buyer numbering and all pricing leaf deep-path consumers remain unchanged.

## 3. Verification

- [x] 3.1 Run focused import/source scans and the required typecheck, test, build, check, API contract, web/source boundary, OpenSpec strict, and diff checks.
- [x] 3.2 Inspect final diff/status and create one atomic local commit; confirm no remote or production action.
