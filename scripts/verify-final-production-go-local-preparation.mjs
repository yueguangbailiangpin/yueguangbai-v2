import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { invariant as assert, readRepositoryFile, repositoryRoot as root } from './verifier-utils.mjs';

const read=(file)=>readRepositoryFile(file,root);
const migrations=readdirSync(path.join(root,'migrations')).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
assert(migrations.length===58,`expected 58 migrations, found ${migrations.length}`);
assert(migrations.every((file,index)=>Number(file.slice(0,4))===index+1),'migration chain is not continuous');
assert(migrations.at(-5)==='0054_access_channel_marketplace_hardening.sql'
  && migrations.at(-4)==='0055_order_review_advance_compensation.sql'
  && migrations.at(-3)==='0056_customer_identifier_seller_members.sql'
  && migrations.at(-2)==='0057_acquisition_machine_credentials.sql'
  && migrations.at(-1)==='0058_marketplace_dates_recovery_attestation.sql','unexpected migration tail');

const production=read('apps/api/wrangler.production.template.jsonc');
for(const marker of [
  '"SCHEDULED_OPERATIONS_ENABLED": "true"',
  '"ACQUISITION_MAINTENANCE_ENABLED": "true"',
  '"STAFF_ACCESS_TEAM_DOMAIN": "REQUIRED_CLOUDFLARE_ACCESS_TEAM_HTTPS_ORIGIN"',
  '"STAFF_ACCESS_AUD": "REQUIRED_CLOUDFLARE_ACCESS_APPLICATION_AUD"',
  '"STAFF_AUTH_ALLOWED_ORIGINS": "REQUIRED_PRODUCTION_HTTPS_ORIGIN"',
])assert(production.includes(marker),`production access/readiness marker missing: ${marker}`);
for(const forbidden of ['"STAFF_AUTH_PROVIDER": "FEISHU"','"STAFF_AUTH_ENABLED": "false"']){
  assert(!production.includes(forbidden),`stale Staff auth production marker remains: ${forbidden}`);
}

const runbook=read('docs/runbooks/PRODUCTION_READINESS_BACKUP_RESTORE.md');
for(const marker of ['`0001`–`0058`','schema_version=58','--expected-schema 58','R2 Manifest','/ready','STAFF_ACCESS_TEAM_DOMAIN']){
  assert(runbook.includes(marker),`production runbook missing current marker: ${marker}`);
}
const recoverySpec=read('openspec/specs/production-backup-recovery/spec.md');
for(const marker of ['`0001`–`0058`','schema_version=58','R2','production_recovery_attestations','/ready']){
  assert(recoverySpec.includes(marker),`recovery spec missing current marker: ${marker}`);
}

for(const file of [
  'apps/api/src/operational-readiness/routes.ts',
  'apps/api/src/staff-auth/cloudflare-access.ts',
  'apps/api/src/files/r2-object-storage.ts',
  'apps/api/src/cloudflare-runtime.ts',
  'docs/OPERATING_INTEGRITY_FREEZE.md',
])assert(existsSync(path.join(root,file)),`required production boundary missing: ${file}`);

const workflowFiles=readdirSync(path.join(root,'.github/workflows')).filter((file)=>/\.ya?ml$/u.test(file));
assert(workflowFiles.length===1&&workflowFiles[0]==='production-health-monitor.yml','only audited production readiness workflow may exist');
const workflow=read('.github/workflows/production-health-monitor.yml');
for(const marker of ["cron: '17 * * * *'",'workflow_dispatch:','contents: read','issues: write','persist-credentials: false','https://app.yueguangbai.net/ready','node scripts/production-health-monitor.mjs']){
  assert(workflow.includes(marker),`readiness workflow missing: ${marker}`);
}
for(const forbidden of ['push:','pull_request:','pull_request_target:','deployment:','wrangler deploy','npm run deploy']){
  assert(!workflow.includes(forbidden),`readiness workflow contains forbidden release capability: ${forbidden}`);
}

const monitor=read('scripts/production-health-monitor.mjs');
assert(monitor.includes("url.pathname !== '/ready'")&&monitor.includes("value.data.status === 'ready'")
  && monitor.includes("['schema','scheduler','acquisition_maintenance','object_storage','recovery']"),
  'production monitor does not validate the full readiness envelope');

assert(!existsSync(path.join(root,'wrangler.production.jsonc')),'rendered production config exists; refresh deployment audit');
assert(!existsSync(path.join(root,'apps/api/wrangler.production.jsonc')),'rendered API production config exists; refresh deployment audit');
assert(!existsSync(path.join(root,'apps/api/wrangler.staging.jsonc')),'rendered API staging config exists; refresh deployment audit');

console.log(JSON.stringify({
  status:'PASS',
  migration:'0001-0058_CONTINUOUS',
  staff_auth:'CLOUDFLARE_ACCESS_REQUIRED',
  scheduler:'PRODUCTION_REQUIRED',
  readiness:'/ready',
  recovery:'SCHEMA58_D1_R2_ATTESTATION_REQUIRED',
  production_go:'OWNER_APPROVAL_REQUIRED',
},null,2));