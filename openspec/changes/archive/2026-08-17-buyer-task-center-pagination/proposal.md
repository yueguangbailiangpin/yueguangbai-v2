## Why

The canonical Buyer task center currently reads only the first 50 records from each required task source even when the source provides `next_cursor`. That causes Buyer-visible task lists and actionable counts to omit later tasks.

## What Changes

- Consume every cursor page for the six existing Buyer task sources before classification.
- Fail the task-center total closed if a required source cannot be read completely, returns a repeated cursor, or exceeds the cursor safety limit.
- Keep successful task rows usable during a source failure, but do not present a partial actionable total.

## Capabilities

### New Capabilities

- `buyer-task-center-pagination`: Complete, cancellation-safe aggregation of the existing Buyer task-source cursor APIs.

### Modified Capabilities

- None.

## Impact

- Affects `apps/web/src/buyer/tasks/BuyerTasksPage.tsx` and focused Web tests.
- Uses existing Buyer APIs and runtime contracts only; no API, authorization, database, migration, or production-resource change is required.
