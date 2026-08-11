import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { invariant as assert, readRepositoryFile, repositoryRoot as root } from './verifier-utils.mjs';

const read=(file)=>readRepositoryFile(file,root);
const migrations=readdirSync(path.join(root,'migrations')).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
assert(migrations.length===61,`expected 61 migrations, found ${migrations.length}`);
assert(migrations.every((file,index)=>Number(file.slice(0,4))===index+1),'migration chain is not continuous');
assert(migrations.at(-6)==='0056_customer_identifier_seller_members.sql'
  && migrations.at(-5)==='0057_acquisition_machine_credentials.sql'
  && migrations.at(-4)==='0058_marketplace_dates_recovery_attestation.sql'
  && migrations.at(-3)==='0059_seller_member_portal_grants.sql'
  && migrations.at(-2)==='0060_marketplace_effective_dates.sql'
  && migrations.at(-1)==='0061_post_confirmation_integrity_guards.sql','unexpected migration tail');

const production=read('apps/api/wrangler.production.template.jsonc');
for(const marker of [
  '"SCHEDULED_OPERATIONS_ENABLED": "true"','"ACQUISITION_MAINTENANCE_ENABLED": "true"',
  '"STAFF_ACCESS_TEAM_DOMAIN": "REQUIRED_CLOUDFLARE_ACCESS_TEAM_HTTPS_ORIGIN"',
  '"STAFF_ACCESS_AUD": "REQUIRED_CLOUDFLARE_ACCESS_APPLICATION_AUD"','"STAFF_AUTH_ALLOWED_ORIGINS": "REQUIRED_PRODUCTION_HTTPS_ORIGIN"',
])assert(production.includes(marker),`production access/readiness marker missing: ${marker}`);
for(const forbidden of ['"STAFF_AUTH_PROVIDER": "FEISHU"','"STAFF_AUTH_ENABLED": "false"'])assert(!production.includes(forbidden),`stale Staff auth production marker remains: ${forbidden}`);

const runbook=read('docs/runbooks/PRODUCTION_READINESS_BACKUP_RESTORE.md');
for(const marker of ['`0001`–`0061`','schema_version=61','--expected-schema 61','R2 Manifest','/ready','STAFF_ACCESS_TEAM_DOMAIN'])assert(runbook.includes(marker),`production runbook missing current marker: ${marker}`);
const recoverySpec=read('openspec/specs/production-backup-recovery/spec.md');
for(const marker of ['`0001`–`0061`','schema_version=61','R2','production_recovery_attestations','/ready'])assert(recoverySpec.includes(marker),`recovery spec missing current marker: ${marker}`);

for(const file of [
  'apps/api/src/operational-readiness/routes.ts','apps/api/src/production-readiness/recovery-attestation-routes.ts',
  'apps/api/src/staff-auth/cloudflare-access.ts','apps/api/src/files/r2-object-storage.ts','apps/api/src/cloudflare-runtime.ts',
  'docs/OPERATING_INTEGRITY_FREEZE.md','docs/SECOND_LAYER_HARDENING_FREEZE.md',
])assert(existsSync(path.join(root,file)),`required production boundary missing: ${file}`);

const readiness=read('apps/api/src/operational-readiness/routes.ts');
assert(readiness.includes('const TARGET_SCHEMA=61'),'readiness target schema is stale');
const attestation=read('apps/api/src/production-readiness/recovery-attestation-routes.ts');
assert(attestation.includes('const TARGET_SCHEMA=61'),'recovery attestation target schema is stale');

const workflowFiles=readdirSync(path.join(root,'.github/workflows')).filter((file)=>/\.ya?ml$/u.test(file));
assert(workflowFiles.length===1&&workflowFiles[0]==='production-health-monitor.yml','only audited production readiness workflow may exist');
const workflow=read('.github/workflows/production-health-monitor.yml');
for(const marker of ["cron: '17 * * * *'",'workflow_dispatch:','contents: read','issues: write','persist-credentials: false','https://app.yueguangbai.net/ready','node scripts/production-health-monitor.mjs'])assert(workflow.includes(marker),`readiness workflow missing: ${marker}`);
for(const forbidden of ['push:','pull_request:','pull_request_target:','deployment:','wrangler deploy','npm run deploy'])assert(!workflow.includes(forbidden),`readiness workflow contains forbidden release capability: ${forbidden}`);

const monitor=read('scripts/production-health-monitor.mjs');
assert(monitor.includes("url.pathname !== '/ready'")&&monitor.includes("value.data.status === 'ready'")&&monitor.includes("['schema','scheduler','acquisition_maintenance','object_storage','recovery']"),'production monitor does not validate the full readiness envelope');

assert(!existsSync(path.join(root,'wrangler.production.jsonc')),'rendered production config exists; refresh deployment audit');
assert(!existsSync(path.join(root,'apps/api/wrangler.production.jsonc')),'rendered API production config exists; refresh deployment audit');
assert(!existsSync(path.join(root,'apps/api/wrangler.staging.jsonc')),'rendered API staging config exists; refresh deployment audit');

console.log(JSON.stringify({status:'PASS',migration:'0001-0061_CONTINUOUS',staff_auth:'CLOUDFLARE_ACCESS_REQUIRED',scheduler:'PRODUCTION_REQUIRED',readiness:'/ready',recovery:'SCHEMA61_D1_R2_ATTESTATION_REQUIRED',production_go:'OWNER_APPROVAL_REQUIRED'},null,2));
