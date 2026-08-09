## Context

Buyer and Seller share one HttpOnly Customer-session transport cookie but keep separate route guards and query roots. The Seller account page currently exposes only password change; Buyer exposes voluntary logout. Shared mismatch and 401 handling invokes Customer logout and clears both Customer roots.

## Goals / Non-Goals

**Goals:**

- Make the absence of a Seller logout entry an explicit long-term product rule.
- Preserve Buyer logout and fail-closed shared Customer cleanup.

**Non-Goals:**

- No Seller UI, API, controller, route, test, or session implementation change.
- No change to Staff logout or Customer cookie ownership.

## Decisions

- Update decision, product, and OpenSpec authority because the existing code already matches the desired Seller presentation.
- Keep the shared Customer logout transport available to automatic mismatch/401/invalidation cleanup. Removing it would weaken cross-persona isolation.
- Reject adding a hidden or alternate Seller logout action because it would contradict the explicit product decision.

## Risks / Trade-offs

- [Future work may infer all Customer personas need identical voluntary actions] → The decision and spec explicitly distinguish UI presentation from mandatory security cleanup.
- [A future refactor may remove shared cleanup after seeing no Seller logout UI] → The modified requirement retains concrete mismatch, 401, and invalidation scenarios.

## Migration Plan

No data or deployment migration. Revert the authority changes together if the product owner later makes a new explicit decision.
