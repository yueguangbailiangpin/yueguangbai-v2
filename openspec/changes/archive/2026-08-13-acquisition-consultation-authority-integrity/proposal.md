# Change Proposal: Acquisition consultation authority and integrity

## Why

The current Acquisition runtime drifted from D-026 and the owner-only consultation contract: `acquisition` can submit consultation writes, the consultation batch no longer writes the general Audit event or final state/version/count assertion, failed batches do not clean up the idempotency claim, and history reads do not conceal cross-Marketplace records. The canonical UI also renders the write form to `acquisition`.

## What Changes

- Record D-040 without rewriting D-026, D-034, D-035 or D-038.
- Keep `acquisition` as a Marketplace-scoped Prospect/source/read operator while restricting consultation record/correct commands to `owner`.
- Treat historical Personal GRANT and Team/Leader packs as audit-only inputs that cannot expand current role authority.
- Restore consultation Audit, batch-final assertion and idempotency failure cleanup; conceal cross-scope history as not found.
- Assert the conditional mutation changed exactly one row before event/Audit/idempotency completion, and preserve unknown dependency errors for the route's 503 boundary.
- Prove trusted Staff-cookie/D1 recomputation and Personal-DENY UI behavior instead of relying only on injected request context.
- Align API/D1, route, UI and browser evidence with the five-role model and read-only Acquisition consultation surface.

## Non-Goals

- No Migration or Schema change.
- No `correctLeadSource` or other Acquisition redesign.
- No production, Cloudflare, D1/R2 remote, Secret, DNS, Access, deployment, GitHub or real-data action.
- No rewrite of historical Decisions, migrations or archived Changes.

## Migration and rollback

No Migration is required. Each phase is an ordinary source/document/test diff and can be reverted independently before any external write; this task performs no external write.

## Acceptance boundary

Acceptance requires targeted API/D1 and UI behavior tests, route security invariants, Acquisition and Staff-role checks, relevant typecheck/browser evidence, target and all strict OpenSpec validation, implementation Verify, `git diff --check`, and one final `npm run check`. Sync/archive remain controller-gated after independent review and are not claimed here.
