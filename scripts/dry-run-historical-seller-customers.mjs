import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildHistoricalSellerDirectoryPlan } from '../tools/imports/historical-seller-customers/index.ts';
import { emitHistoricalSellerStagingSql } from '../tools/imports/historical-seller-customers/staging-sql.ts';

const reference = path.resolve(
  'openspec/changes/archive/2026-08-17-current-reservable-product-seller-mapping/references',
);
const files = ['dJwldHrckeFY', 'dDUYsBOrYoEk', 'davLDVdZLoPV', 'dhtkJdpmZEgh']
  .flatMap((folder) => JSON.parse(readFileSync(
    path.join(reference, `historical-file-inventory-${folder}.json`), 'utf8',
  )).readOnlyIndex);
const plan = buildHistoricalSellerDirectoryPlan(files);
if (process.argv.includes('--sql')) {
  const actor = process.env['HISTORICAL_SELLER_IMPORT_ACTOR'];
  const now = Number(process.env['HISTORICAL_SELLER_IMPORT_NOW']);
  if (!actor || !Number.isSafeInteger(now)) throw new Error('IMPORT_OPTIONS_REQUIRED');
  process.stdout.write(emitHistoricalSellerStagingSql(plan, { actorStaffId: actor, now }));
} else {
  console.log(JSON.stringify({
    status: 'LOCAL_READONLY_PREVIEW',
    source_files: plan.sourceFileCount,
    resolved_files: plan.resolvedFileCount,
    unique_sellers: plan.customers.length,
    unresolved_files: plan.unresolvedFiles.length,
    unresolved_titles: plan.unresolvedFiles.map((file) => file.sourceFileTitle),
    tencent_docs_writes: 0,
    database_writes: 0,
  }, null, 2));
}
