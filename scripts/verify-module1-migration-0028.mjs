import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'migrations');
const files = readdirSync(directory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
if (files.length < 28
  || files[27] !== '0028_buyer_amazon_order_date.sql') {
  throw new Error('expected preserved migrations 0001-0028');
}
const module1Files = files.slice(0, 28);

const database = new DatabaseSync(':memory:');
try {
  database.exec('PRAGMA foreign_keys=ON;');
  for (const file of module1Files) {
    database.exec(readFileSync(path.join(directory, file), 'utf8'));
  }
  const schemaVersion = Number(database.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get()?.schema_version);
  const count = (type) => Number(database.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_schema
    WHERE type=? AND name NOT LIKE 'sqlite_%'
  `).get(type)?.count);
  if (schemaVersion !== 28
    || count('table') !== 117
    || count('trigger') !== 221
    || count('view') !== 10) {
    throw new Error('migration 0028 object counts changed unexpectedly');
  }
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
    throw new Error('migration 0028 guards are incomplete');
  }
  console.log(JSON.stringify({
    status: 'PASS',
    migrations: module1Files.length,
    schema_version: schemaVersion,
    tables: count('table'),
    triggers: count('trigger'),
    views: count('view'),
    historical_null: 'PRESERVED',
  }, null, 2));
} finally {
  database.close();
}
