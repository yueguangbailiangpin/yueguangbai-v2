import type { SqlDatabase, SqlStatement } from '@ygb/contracts';

export function releaseProvisionalOrderNumberClaimStatement(
  database: SqlDatabase,
  evidenceSubmissionId: string | null,
  now: number,
): SqlStatement {
  return database.prepare(`
    UPDATE formal_order_number_claims
    SET status='RELEASED', version=version+1,
        updated_at=MAX(?, updated_at+1), released_at=?
    WHERE evidence_submission_id=COALESCE(?, '') AND status='PROVISIONAL'
  `).bind(now, now, evidenceSubmissionId);
}
