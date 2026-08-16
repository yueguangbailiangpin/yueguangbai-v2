## Context

T8 established the isolated Schema 70 staging Worker/D1/R2/Access/domain baseline but expressly excluded business acceptance and recovery. The current `V2_ACCEPTANCE_MATRIX.md` has 67 A-H entries; two runbook references still say 68. Several entries are historical repository-bootstrap statements, while H01-H03 belong to T10 and H05/H07 require external or production authority.

## Goals / Non-Goals

**Goals:**

- Execute all 67 rows far enough to produce a truthful terminal status and evidence dependency.
- Use formal staging UI/API paths for synthetic business mutation and remote D1/R2 readback for final-state assertions.
- Stop on product-contract conflicts instead of changing current code to satisfy stale text.

**Non-Goals:**

- No production operation, real customer data, scheduler/alert activation or new staging resource.
- No T10 backup/restore execution inside this Change.
- No rewriting historical migrations, decisions or archived evidence.

## Decisions

Each row uses one primary evidence class: `REMOTE_HTTP`, `REMOTE_D1`, `REMOTE_R2`, `LOCAL_FIXED_SHA`, `T10_LINK`, `EXTERNAL_OPERATOR` or `GOVERNANCE`. A row can pass only when its primary class has direct evidence; supporting tests are not substitutes.

Execution proceeds in batches: baseline/local checks; Staff identities and authorization; synthetic Buyer/Seller onboarding; catalog/demand/reservation/order; review/finance/task; R2 compensation; then linked/external H rows. Low-risk reads and rejection paths precede financial writes and concurrency cases.

Synthetic identifiers, credentials and raw JSON live under the managed staging directory at mode `0600`. The committed register stores only stable IDs, statuses, aggregate counts and hashes. Mutations use unique idempotency keys and minimal synthetic amounts; irreversible or production-scoped actions are never inferred from the blanket staging authorization.

## Risks / Trade-offs

- [Current matrix contains stale repository-bootstrap assertions] -> Mark `CONFLICT` with current authority; do not delete Git origin or migrations.
- [Some rows depend on separate work] -> Keep them in the denominator as `BLOCKED` and link T10/external operator evidence later.
- [Authentication or runtime blocker appears] -> Fix it in an independent PR, review/merge/deploy the exact SHA, then resume; do not contaminate the evidence PR.
- [Synthetic business facts accumulate] -> Prefix and inventory them for later formal disable/retention handling; never direct-delete immutable facts.

## Migration Plan

`NO_SCHEMA_CHANGE`. T9 uses Schema 70. Rollback of the repository Change removes only evidence; synthetic staging accounts can be disabled through formal lifecycle controls, while immutable business/audit facts remain as staging evidence. Production remains untouched.
