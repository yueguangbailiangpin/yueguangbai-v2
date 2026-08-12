## Why

The canonical Buyer portal already uses the three-item product/task/me model, but the Module 1 formal verifier still depends on a retired Dashboard task-ranking test. That leaves dead runtime code as required evidence and makes safe removal impossible.

## What Changes

- Move Module 1 Buyer routing/task-center evidence to the canonical route, navigation, task classification, and behavior tests.
- Remove the unreachable Buyer Dashboard page, its retired deadline/global-deduplication helper and test, and CSS used only by that page.
- Record the retirement as a narrow successor to D-033 without rewriting historical Decisions or archived Changes.
- Preserve existing reservation, manual review, order-evidence, review, refund, API, contract, and migration behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an evidence and dead-runtime cleanup; it does not change a user-visible or API behavior requirement.

## Impact

Affected code is limited to the Buyer formal verifier, canonical Buyer task tests, the obsolete Dashboard files, and their unused styles. No Migration, production resource, permission, privacy boundary, API contract, or dependency changes are in scope. The local diff can be reverted before remote action.
