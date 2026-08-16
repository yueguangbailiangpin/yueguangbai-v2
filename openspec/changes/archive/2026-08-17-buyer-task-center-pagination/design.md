## Context

See `proposal.md` for the defect. The six canonical Buyer task inputs are separately authenticated, cursor-paginated read APIs, and D-033 retains the current task classification while explicitly excluding the retired dashboard ranking and global deduplication model.

## Goals / Non-Goals

**Goals:**

- Read every required cursor chain with the query lifecycle's abort signal.
- Preserve the current source contracts and classification semantics.
- Fail closed rather than displaying an incomplete actionable total.

**Non-Goals:**

- No API/read-model/contract/database/migration change.
- No new aggregated task API, old Dashboard, deadline ranking, cross-source global deduplication, new-product task, or APPROVED+UNPUBLISHED UX redesign.

## Decisions

- A small shared Web helper will fetch pages sequentially per source, while the six React Query sources start in parallel. This preserves each API's cursor order and avoids a second aggregation architecture or backend change.
- The helper receives the React Query `AbortSignal`, checks it between pages, and passes it to every request. Query cancellation therefore cannot commit a stale task-center result after unmount.
- The helper permits an empty page with `next_cursor`, rejects a repeated cursor, and rejects a chain exceeding a fixed page ceiling. These conditions are incomplete data, not a reason to silently truncate the count.
- Each source supplies its own stable `type:id` resource key. The helper removes repeats only inside that source chain; cross-source semantics remain entirely in `classifyBuyerTasks`.
- If any source query errors, the UI retains the existing partial-read warning but replaces the numeric headline with an incomplete-state heading. This keeps successfully fetched tasks reachable without presenting a false total.

## Risks / Trade-offs

- [Very large source chains increase client reads] → Existing source limit stays 50, sources remain parallel, and the hard ceiling makes unbounded server behavior explicit.
- [A server returns a malformed repeating cursor] → Stop and surface the existing incomplete-state warning instead of looping or counting partial data.
- [Cancellation races with page transitions] → Use the supplied query signal for each request and test that cancellation is propagated.

## Migration Plan

No migration or deployment procedure is required. The change is a reversible Web-only code change: reverting the commit restores the prior first-page behavior, though that behavior omits later tasks.
