# Rollback and Runbook

1. This Change creates no schema migration and never modifies production data.
2. Before release, record Worker/Web commit, schema version, route inventory and Seller contract version.
3. If pre-production validation fails, stop promotion and redeploy the prior Worker/Web artifact; do not alter ledgers.
4. If generic fields have active consumers, preserve them through a forward fix; do not downgrade to a response that silently changes money meaning.
5. Any payment/refund reversal remains an audited business command controlled by Staff, never a deployment rollback mechanism.
6. Re-run Seller isolation, DTO disclosure, completion truth and JP compatibility checks after rollback or forward repair.
