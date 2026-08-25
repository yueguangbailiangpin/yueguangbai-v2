// Original verify-module1-migration-0028 asserted the legacy chain's mid-state
// at 0028 (117 tables / 221 triggers / 10 views). Those chain-position counts
// retired with the legacy chain (D-054). The protected assertions — the
// amazon_order_date authority columns with their date-validity CHECK, and the
// evidence/formal-order guard triggers binding the formal order date to the
// evidence submission date — are re-anchored on the stage 3 clean baseline's
// applied final schema.
import { applyBaseline } from './baseline-schema-helper.mjs';

const database = applyBaseline();
try {
  for (const table of ['order_evidence_versions', 'formal_orders']) {
    const column = database.prepare(`PRAGMA table_info(${table})`).all()
      .find((value) => value.name === 'amazon_order_date');
    const sql = String(database.prepare(`
      SELECT sql FROM sqlite_schema WHERE type='table' AND name=?
    `).get(table)?.sql ?? '');
    if (column?.type !== 'TEXT' || Number(column.notnull) !== 0
      || !sql.includes('date(amazon_order_date)=amazon_order_date')) {
      throw new Error(`${table}.amazon_order_date is not safely checked`);
    }
  }
  const evidenceGuard = String(database.prepare(`
    SELECT sql FROM sqlite_schema
    WHERE type='trigger' AND name='trg_order_evidence_version_submission_guard'
  `).get()?.sql ?? '');
  const formalGuard = String(database.prepare(`
    SELECT sql FROM sqlite_schema
    WHERE type='trigger' AND name='trg_formal_order_source_guard'
  `).get()?.sql ?? '');
  if (!evidenceGuard.includes('NEW.amazon_order_date IS NULL')
    || !formalGuard.includes('evidence.amazon_order_date=NEW.amazon_order_date')) {
    throw new Error('baseline amazon_order_date guards are incomplete');
  }
  console.log(JSON.stringify({
    status: 'PASS',
    baseline: 'stage3-clean-baseline-0001-0019',
    schema_version: Number(database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()?.schema_version),
    historical_null: 'PRESERVED',
  }, null, 2));
} finally {
  database.close();
}
