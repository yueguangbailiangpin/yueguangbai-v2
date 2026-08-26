import { build } from 'esbuild';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Stage 6 historical order import CLI (task 6.6 command surface).
//
//   node scripts/historical-import.mjs inspect   --source <file> [--source <file2>...]
//   node scripts/historical-import.mjs dry-run   --source <file> [--database <d1-sqlite>]
//   node scripts/historical-import.mjs apply-local --source <file> --database <d1-sqlite>
//       (requires HISTORICAL_IMPORT_APPLY_LOCAL=I_UNDERSTAND_THIS_WRITES_LOCAL_D1)
//   node scripts/historical-import.mjs resume    --source <file> --batch-id <id> --database <d1-sqlite>
//   node scripts/historical-import.mjs reconcile --batch-id <id> --database <d1-sqlite>
//
// Sources are read-only; apply-local only ever writes the local test D1
// SQLite file (no wrangler remote execution exists anywhere in this CLI).

const APPLY_ENV_KEY = 'HISTORICAL_IMPORT_APPLY_LOCAL';
const APPLY_ENV_VALUE = 'I_UNDERSTAND_THIS_WRITES_LOCAL_D1';
const LOCAL_D1_DIRECTORY = path.resolve('apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject');

const args = parseArgs(process.argv.slice(2));
const command = args.get('command');
if (!command || command === 'help') {
  console.error(USAGE);
  process.exit(command ? 0 : 2);
}

const bundle = await build({
  stdin: {
    contents: `
      import { SqliteDatabase } from ${JSON.stringify(path.resolve('packages/testkit/src/sqlite-database.ts'))};
      import {
        discoverHistoricalSources,
        HISTORICAL_CSV_HEADERS,
        parseHistoricalCsv,
        parseHistoricalJsonl,
      } from ${JSON.stringify(path.resolve('tools/imports/historical-order-importer/index.ts'))};
      import { reconcileHistoricalImport, runHistoricalImport } from ${JSON.stringify(
        path.resolve('tools/imports/historical-order-importer/pipeline.ts'),
      )};
      export {
        SqliteDatabase, discoverHistoricalSources, HISTORICAL_CSV_HEADERS,
        parseHistoricalCsv, parseHistoricalJsonl, reconcileHistoricalImport, runHistoricalImport,
      };
    `,
    resolveDir: process.cwd(),
    sourcefile: 'historical-import-cli-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'historical-import-cli-'));
const temporaryModule = path.join(temporaryDirectory, 'entry.mjs');
writeFileSync(temporaryModule, bundle.outputFiles[0].text);
const {
  SqliteDatabase,
  discoverHistoricalSources,
  HISTORICAL_CSV_HEADERS,
  parseHistoricalCsv,
  parseHistoricalJsonl,
  reconcileHistoricalImport,
  runHistoricalImport,
} = await import(pathToFileURL(temporaryModule).href);

try {
  await runCommand();
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function runCommand() {
  switch (command) {
    case 'inspect': {
      const sources = requiredSources();
      const { files } = await discoverHistoricalSources({
        sourceSystem: 'HISTORICAL_ORDER_CSV',
        files: sources.map((file) => ({ name: path.basename(file.path), text: file.text })),
      });
      const entries = [];
      for (const source of sources) {
        const discovered = files.find((file) => file.name === path.basename(source.path));
        if (!discovered) throw new Error(`source_not_discovered:${source.path}`);
        const sha = discovered.sha256;
        let rows = null;
        let headerOk = true;
        let headerError = null;
        try {
          rows = source.format === 'JSONL'
            ? parseHistoricalJsonl(path.basename(source.path), source.text, sha)
            : parseHistoricalCsv(path.basename(source.path), source.text, sha);
        } catch (error) {
          headerOk = false;
          headerError = error instanceof Error ? error.message : String(error);
        }
        entries.push({
          name: path.basename(source.path),
          path: source.path,
          format: source.format,
          sha256: sha,
          bytes: Buffer.byteLength(source.text, 'utf8'),
          header_ok: headerOk,
          header_error: headerError,
          header_expected: [...HISTORICAL_CSV_HEADERS],
          rows: rows === null ? null : rows.length,
        });
      }
      console.log(JSON.stringify({
        status: 'INSPECT_ONLY',
        files: entries,
        runs_created: 0,
        database_writes: 0,
        remote_writes: 'none',
      }, null, 2));
      break;
    }
    case 'dry-run': {
      const { database, label } = openDatabase(args.get('database'));
      const sources = requiredSources();
      const result = await runHistoricalImport(database, {
        sourceSystem: sourceSystemOf(sources),
        files: sources.map((file) => ({ name: path.basename(file.path), text: file.text })),
      }, { mode: 'DRY_RUN' });
      console.log(JSON.stringify({
        status: 'LOCAL_DRY_RUN',
        database: label,
        replayed: result.replayed,
        batch_id: result.batch_id,
        report: result.report,
        database_writes: 'batch_provenance_only_no_fact_rows',
        remote_writes: 'none',
      }, null, 2));
      database.close();
      break;
    }
    case 'apply-local': {
      if (process.env[APPLY_ENV_KEY] !== APPLY_ENV_VALUE) {
        throw new Error(
          `apply_local_env_gate_missing: set ${APPLY_ENV_KEY}=${APPLY_ENV_VALUE} to confirm this writes the LOCAL test D1 only`,
        );
      }
      const databasePath = path.resolve(required(args, 'database'));
      assertInsideRepository(databasePath);
      const { database, label } = openDatabase(databasePath, { explicit: true });
      const sources = requiredSources();
      const result = await runHistoricalImport(database, {
        sourceSystem: sourceSystemOf(sources),
        files: sources.map((file) => ({ name: path.basename(file.path), text: file.text })),
      }, { mode: 'APPLY_LOCAL' });
      console.log(JSON.stringify({
        status: result.report.can_apply ? 'LOCAL_APPLY_COMPLETED' : 'LOCAL_APPLY_BLOCKED',
        database: label,
        batch_id: result.batch_id,
        replayed: result.replayed,
        resumed_from: result.resumed_from,
        applied_orders: result.applied_orders,
        report: result.report,
        tables_written: ['historical_import_batches', 'historical_orders',
          'historical_order_files', 'historical_import_quarantine'],
        live_tables_written: 'none_formal_orders_untouched',
        remote_writes: 'none',
      }, null, 2));
      database.close();
      if (!result.report.can_apply) process.exitCode = 1;
      break;
    }
    case 'resume': {
      const batchId = required(args, 'batch-id');
      const databasePath = path.resolve(required(args, 'database'));
      assertInsideRepository(databasePath);
      const { database, label } = openDatabase(databasePath, { explicit: true });
      const batch = await database.prepare(
        'SELECT source_files_sha256,status,mode FROM historical_import_batches WHERE id=?',
      ).bind(batchId).first();
      if (!batch) throw new Error('BATCH_NOT_FOUND');
      if (batch.mode !== 'APPLY_LOCAL') throw new Error('RESUME_APPLY_LOCAL_ONLY');
      if (batch.status !== 'RUNNING') {
        throw new Error(`BATCH_NOT_RESUMABLE:${batch.status}`);
      }
      const sources = requiredSources();
      const input = {
        sourceSystem: sourceSystemOf(sources),
        files: sources.map((file) => ({ name: path.basename(file.path), text: file.text })),
      };
      const { combinedSha } = await discoverHistoricalSources(input);
      if (combinedSha !== batch.source_files_sha256) {
        throw new Error(
          `SOURCE_CHANGED_SINCE_BATCH: batch=${batch.source_files_sha256} current=${combinedSha} — a changed source must start a NEW run, not resume`,
        );
      }
      const result = await runHistoricalImport(database, input,
        { mode: 'APPLY_LOCAL', resumeBatchId: batchId });
      console.log(JSON.stringify({
        status: 'LOCAL_RESUME_COMPLETED',
        database: label,
        batch_id: batchId,
        resumed_from: result.resumed_from,
        applied_orders: result.applied_orders,
        report: result.report,
        remote_writes: 'none',
      }, null, 2));
      database.close();
      break;
    }
    case 'reconcile': {
      const batchId = required(args, 'batch-id');
      const { database, label } = openDatabase(args.get('database'));
      const reconciliation = await reconcileHistoricalImport(database, batchId);
      console.log(JSON.stringify({
        status: 'LOCAL_RECONCILIATION',
        database: label,
        reconciliation,
        remote_writes: 'none',
      }, null, 2));
      database.close();
      break;
    }
    default:
      console.error(USAGE);
      process.exit(2);
  }
}

function requiredSources() {
  const values = args.get('source');
  if (!values || values.length === 0) throw new Error('missing_argument:--source <file> (repeatable)');
  return values.map((value) => {
    const filePath = path.resolve(value);
    let format;
    if (filePath.endsWith('.jsonl')) format = 'JSONL';
    else if (filePath.endsWith('.csv')) format = 'CSV';
    else throw new Error(`unsupported_source_extension:${path.basename(filePath)} (expected .csv or .jsonl)`);
    return { path: filePath, format, text: readFileSync(filePath, 'utf8') };
  });
}

function sourceSystemOf(sources) {
  const formats = new Set(sources.map((source) => source.format));
  if (formats.size > 1) throw new Error('mixed_source_formats_not_supported');
  return formats.has('JSONL') ? 'HISTORICAL_ORDER_JSONL' : 'HISTORICAL_ORDER_CSV';
}

function openDatabase(explicitPath, { explicit = false } = {}) {
  let databasePath;
  if (explicit || explicitPath) {
    databasePath = path.resolve(explicit ? explicitPath : explicitPath);
  } else {
    databasePath = discoverLocalD1Database();
  }
  return { database: new SqliteDatabase(databasePath), label: databasePath };
}

function discoverLocalD1Database() {
  let candidates = [];
  try {
    candidates = readdirSync(LOCAL_D1_DIRECTORY)
      .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
  } catch {
    candidates = [];
  }
  if (candidates.length !== 1) {
    throw new Error(
      `local_d1_not_discovered: expected exactly one D1 sqlite under ${LOCAL_D1_DIRECTORY}; pass --database explicitly (after \`npm run db:migrate:local\`)`,
    );
  }
  return path.join(LOCAL_D1_DIRECTORY, candidates[0]);
}

function assertInsideRepository(databasePath) {
  const repositoryRoot = process.cwd();
  if (databasePath !== repositoryRoot && !databasePath.startsWith(repositoryRoot + path.sep)) {
    throw new Error(`apply_local_database_outside_repository:${databasePath}`);
  }
}

function parseArgs(values) {
  const parsed = new Map([['source', []]]);
  if (values.length === 0) return parsed;
  if (!values[0].startsWith('--')) parsed.set('command', values[0]);
  for (let index = parsed.has('command') ? 1 : 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) throw new Error(`invalid_argument:${value}`);
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing_value:${key}`);
    if (key === 'source') parsed.get('source').push(next);
    else parsed.set(key, next);
    index += 1;
  }
  return parsed;
}

function required(values, key) {
  const value = values.get(key);
  if (!value || value.length === 0) throw new Error(`missing_argument:--${key}`);
  return value;
}

const USAGE = `historical-import — stage 6 historical order importer CLI (local only)

Usage:
  node scripts/historical-import.mjs inspect --source <file.csv|file.jsonl> [--source <more>...]
  node scripts/historical-import.mjs dry-run --source <file> [--database <d1-sqlite>]
  HISTORICAL_IMPORT_APPLY_LOCAL=I_UNDERSTAND_THIS_WRITES_LOCAL_D1 \\
  node scripts/historical-import.mjs apply-local --source <file> --database <d1-sqlite>
  node scripts/historical-import.mjs resume --source <file> --batch-id <id> --database <d1-sqlite>
  node scripts/historical-import.mjs reconcile --batch-id <id> --database <d1-sqlite>

Commands:
  inspect      Header check, row count and source SHA-256. No run is created, nothing is written.
  dry-run      Default mode: full parse/validate/identity/classification report, can_apply gate.
               Records only batch provenance rows in the local database.
  apply-local  Writes historical_* snapshot tables in the LOCAL test D1 only (env gate required).
               Live formal_orders is never written by the importer.
  resume       Continues a RUNNING APPLY_LOCAL batch; the source file SHA-256 must match the batch.
  reconcile    Prints the reconciliation summary for a finished batch.

Sources are CSV (frozen 30-column header) or JSONL (raw_fields manifest form).`;
