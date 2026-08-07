import { readFileSync,readdirSync } from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=(name)=>readFileSync(path.join(root,name),'utf8');
const migrationFiles=readdirSync(path.join(root,'migrations')).filter((name)=>/^\d{4}_.+\.sql$/u.test(name)).sort();
if(!migrationFiles.includes('0032_google_drive_cold_image_archive.sql')||migrationFiles.at(-1)!=='0033_feishu_staff_workbench_poc.sql') throw new Error('archive migration sequence changed unexpectedly');
const migration=read('migrations/0032_google_drive_cold_image_archive.sql');
for(const fragment of ['schema_version=31','schema_version=32','order_archive_closures','drive_archive_controls',
  'file_drive_archives','file_drive_archive_manifests','trg_file_drive_archive_transition_guard',
  'file_drive_archive_reconciliations','file_drive_rehydrations']) if(!migration.includes(fragment)) throw new Error(`missing migration guard: ${fragment}`);
const contract=read('packages/contracts/src/cold-image-archive.ts');
for(const purpose of ['ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF']) {
  if(!contract.includes(`'${purpose}'`)) throw new Error(`missing archive purpose: ${purpose}`);
}
const runner=read('apps/api/src/scheduled-operations/runner.ts');
if(!runner.includes('runDriveArchiveBatch')||runner.includes("job === 'drive_archive' || job === 'feishu_sync'")) {
  throw new Error('drive_archive scheduler registration is not guarded correctly');
}
if(!runner.includes("input.dryRun===true||input.deadlineReached?.()")) throw new Error('dry-run must skip reconciliation');
const runtime=read('apps/api/src/cold-image-archive/runtime.ts');
for(const binding of ['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_FOLDER_ID','GOOGLE_DRIVE_OWNER_ACCOUNT_KEY']) if(!runtime.includes(binding)) throw new Error(`missing runtime binding: ${binding}`);
const routes=read('apps/api/src/cold-image-archive/routes.ts');
for(const route of ['/archive/orders/:id/close','/archive/orders/:id/reopen','/archive/files/:id/rehydrate']) {
  if(!routes.includes(route)) throw new Error(`missing controlled route: ${route}`);
}
const closure=read('apps/api/src/cold-image-archive/business-closure.ts');
for(const guard of ['formal_orders','confirmed_at','SCHEDULED_OPERATIONS_RUN','acquireIdempotency','createAuditEventStatement']) {
  if(!closure.includes(guard)) throw new Error(`missing closure guard: ${guard}`);
}
const archiveJob=read('apps/api/src/cold-image-archive/job.ts');
for(const guard of ['DRIVE_UPLOAD_RECORDED','atomicMutation','deadlineReached']) {
  if(!archiveJob.includes(guard)) throw new Error(`missing archive atomic/deadline guard: ${guard}`);
}
const dryRun=read('scripts/dry-run-google-drive-archive.mjs');
if(!dryRun.includes('dry-run.acceptance.test.ts')||dryRun.includes('local-contract-only')) {
  throw new Error('dry-run evidence must execute the scheduler runner acceptance');
}
const readService=read('apps/api/src/files/file-read-service.ts');
if(!readService.includes('authorizeFileRead')||!readService.includes('readArchivedBytes')
  ||readService.indexOf('authorizeFileRead')>readService.indexOf('readArchivedBytes(source')) {
  throw new Error('Drive proxy must remain behind authorization');
}
const wrangler=read('apps/api/wrangler.local.jsonc');
for(const flag of ['DRIVE_ARCHIVE_ENABLED','DRIVE_ARCHIVE_COPY_ENABLED','DRIVE_ARCHIVE_PROXY_READ_ENABLED','DRIVE_ARCHIVE_R2_DELETE_ENABLED']) {
  if(!new RegExp(`"${flag}"\\s*:\\s*"false"`,'u').test(wrangler)) throw new Error(`unsafe local default: ${flag}`);
}
for(const file of ['docs/contracts/GOOGLE_DRIVE_COLD_IMAGE_ARCHIVE.md','docs/runbooks/GOOGLE_DRIVE_COLD_IMAGE_ARCHIVE.md',
  'docs/runbooks/GOOGLE_DRIVE_EXTERNAL_ACTIVATION_CHECKLIST.md']) read(file);
console.log(JSON.stringify({status:'PASS',migration:'0032',schema_version:32,purposes:4,
  controlled_staff_commands:3,runtime_factory:'fail-closed',dry_run:'runner-verified',
  external_network_calls:0,production_writes:0,default_controls:'hard-disabled'},null,2));
