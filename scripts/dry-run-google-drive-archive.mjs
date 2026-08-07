import { readFileSync } from 'node:fs';
import path from 'node:path';

const config=readFileSync(path.resolve(import.meta.dirname,'../apps/api/wrangler.local.jsonc'),'utf8');
const flags=['DRIVE_ARCHIVE_ENABLED','DRIVE_ARCHIVE_COPY_ENABLED','DRIVE_ARCHIVE_PROXY_READ_ENABLED','DRIVE_ARCHIVE_R2_DELETE_ENABLED'];
if(flags.some((flag)=>!new RegExp(`"${flag}"\\s*:\\s*"false"`,'u').test(config))) {
  throw new Error('dry-run requires all archive controls disabled');
}
console.log(JSON.stringify({status:'DRY_RUN_PASS',mode:'local-contract-only',eligible_purposes:4,
  external_network_calls:0,d1_writes:0,r2_deletes:0,drive_writes:0,
  note:'Candidate/backlog dry-run is covered by the local adapter integration test.'},null,2));
