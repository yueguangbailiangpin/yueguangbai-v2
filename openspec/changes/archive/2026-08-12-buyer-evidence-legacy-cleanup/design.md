## Authority and scope

D-033 and the Frozen Product Baseline are authoritative: Buyer navigation is exactly `产品` / `任务` / `我的`; `/buyer` enters `/buyer/products`; the task center aggregates reservation, order-evidence, review, and refund facts. The legacy Dashboard and `rankBuyerTasks` deadline-ranking/global-deduplication behavior are not current requirements.

This change changes only local implementation evidence and dead client runtime. It does not alter buyer DTOs, API calls, manual reservation approval, state transitions, migrations, or task-center product behavior.

## Evidence migration

The Module 1 formal verifier will keep the archived 58-requirement / 116-scenario completeness check, but map `buyer-routing-dashboard` to canonical route and navigation implementation plus focused canonical tests. The verifier checks evidence paths rather than fragile source-string markers; runtime behavior is exercised by route/navigation and task-classification tests.

The task classification test asserts only current semantics: Buyer-required actions count as actionable; pending reservation/evidence/review and due/partially-paid refund states are system-processing and do not count. It deliberately does not reintroduce ranking, deadline ordering, global deduplication, or a new-reservable-product Dashboard task.

## Retirement boundary

After the canonical evidence is present, delete only the old Buyer Dashboard page, its helper/test, and CSS demonstrated to have no remaining canonical consumers. Do not remove other Buyer files. The final repository search must show no dangling runtime import, verifier mapping, source marker, test dependency, or inaccurate active documentation reference.

## Safety and rollback

No Migration, database access, production resource, or remote action is performed. If a canonical/runtime conflict appears, stop for controller decision; do not redesign the Buyer journey. Before any later remote action, the uncommitted diff is reversible with a normal revert.
