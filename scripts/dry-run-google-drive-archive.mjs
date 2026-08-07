import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const result=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run',
  'apps/api/src/cold-image-archive/dry-run.acceptance.test.ts'],{cwd:root,stdio:'inherit',env:{...process.env,NO_COLOR:'1'}});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
console.log(JSON.stringify({status:'DRY_RUN_PASS',evidence:'scheduled runner acceptance',
  external_network_calls:0,drive_uploads:0,drive_reads:0,r2_writes:0,r2_reads:0,r2_deletes:0,
  archive_rows:0,manifest_rows:0,reconciliation_rows:0,
  note:'Only scheduled_job_states/scheduled_job_runs operational run facts are written; no archive business fact is written.'},null,2));
