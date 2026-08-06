# Rollback and Recovery Runbook

1. This Change introduces no D1 Migration and never rewrites existing business or financial facts.
2. Before promotion, record the Web/API commit, route inventory, schema version and deterministic visual evidence.
3. If pre-production validation fails, stop promotion and restore the prior Web/API artifact. Do not reverse Buyer refunds, Seller payments, allocations or review/order facts as a deployment rollback.
4. Work-item cursor and review-file fields are additive. If an active client depends on them, keep the fields and use a forward repair instead of silently removing the contract.
5. Clear only ephemeral client Query/file state during a Web rollback. Never delete D1 audit, idempotency, outbox, file, order, review or ledger rows.
6. Re-run Staff session/permission/scope/404, DTO leak, file audience, finance separation, empty/upgrade migration and full browser gates after rollback or forward repair.

Verification evidence: the fresh D1 chain and guarded sequential `0001 -> 0030` upgrade both passed with schema version 30, integrity `ok`, zero foreign-key errors, 134 tables and 261 triggers.
