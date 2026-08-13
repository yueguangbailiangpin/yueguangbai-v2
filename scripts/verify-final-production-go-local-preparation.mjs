import { existsSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { invariant as assert,readRepositoryFile,repositoryRoot as root } from './verifier-utils.mjs';

const read=(file)=>readRepositoryFile(file,root);
const migrations=readdirSync(path.join(root,'migrations')).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
assert(migrations.length===65,`expected 65 migrations, found ${migrations.length}`);
assert(migrations.every((file,index)=>Number(file.slice(0,4))===index+1),'migration chain is not continuous');
assert(migrations.at(-5)==='0061_post_confirmation_integrity_guards.sql'
  &&migrations.at(-4)==='0062_runtime_authority_and_privilege_guards.sql'
  &&migrations.at(-3)==='0063_advance_principal_proof_and_overpayment.sql'
  &&migrations.at(-2)==='0064_marketplace_local_date_truth.sql'
  &&migrations.at(-1)==='0065_retire_feishu_artifacts.sql','unexpected migration tail');

const production=read('apps/api/wrangler.production.template.jsonc');
for(const marker of ['"APP_RELEASE_SHA": "REQUIRED_RELEASE_COMMIT_SHA"','"SCHEDULED_OPERATIONS_ENABLED": "true"','"ACQUISITION_MAINTENANCE_ENABLED": "true"','"OPERATIONAL_ALERT_MODE": "bound"','"OPERATIONAL_ALERT_SINK_IDENTITY": "REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_IDENTITY"','"OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION": "REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION"','"binding": "OPERATIONAL_ALERT_SINK"','"props": {','"STAFF_ACCESS_TEAM_DOMAIN": "REQUIRED_CLOUDFLARE_ACCESS_TEAM_HTTPS_ORIGIN"','"STAFF_ACCESS_AUD": "REQUIRED_CLOUDFLARE_ACCESS_APPLICATION_AUD"','"STAFF_AUTH_ALLOWED_ORIGINS": "REQUIRED_PRODUCTION_HTTPS_ORIGIN"'])assert(production.includes(marker),`production access/readiness marker missing: ${marker}`);
for(const forbidden of ['"STAFF_AUTH_PROVIDER": "FEISHU"','"STAFF_AUTH_ENABLED": "false"','FEISHU_WORKBENCH_APP_ID'])assert(!production.includes(forbidden),`stale Staff auth production marker remains: ${forbidden}`);

for(const file of ['apps/api/src/operational-readiness/routes.ts','apps/api/src/operational-readiness/alert-attestation.ts','apps/api/src/production-readiness/recovery-attestation-routes.ts','apps/api/src/staff-auth/cloudflare-access.ts','apps/api/src/files/r2-object-storage.ts','docs/OPERATING_INTEGRITY_FREEZE.md','docs/SECOND_LAYER_HARDENING_FREEZE.md'])assert(existsSync(path.join(root,file)),`required production boundary missing: ${file}`);
const readiness=read('apps/api/src/operational-readiness/routes.ts');assert(readiness.includes('const TARGET_SCHEMA=65'),'readiness target schema is stale');assert(readiness.includes('APP_RELEASE_SHA'),'readiness is not bound to running release');
const attestation=read('apps/api/src/production-readiness/recovery-attestation-routes.ts');assert(attestation.includes('const TARGET_SCHEMA=65'),'recovery attestation target schema is stale');assert(attestation.includes('APP_RELEASE_SHA'),'recovery proof is not bound to running release');
const localVerifier=read('scripts/verify-production-readiness-formal.mjs');assert(localVerifier.includes('external_calls:0'),'local readiness verifier must be offline');
assert(existsSync(path.join(root,'scripts/probe-production-readiness.mjs')),'explicit external readiness probe missing');

const workflowFiles=readdirSync(path.join(root,'.github/workflows')).filter((file)=>/\.ya?ml$/u.test(file));assert(workflowFiles.length===1&&workflowFiles[0]==='production-health-monitor.yml','only audited production readiness workflow may exist');
const workflow=read('.github/workflows/production-health-monitor.yml');for(const marker of ["cron: '17 * * * *'",'workflow_dispatch:','contents: read','issues: write','persist-credentials: false','https://app.yueguangbai.net/ready','node scripts/production-health-monitor.mjs'])assert(workflow.includes(marker),`readiness workflow missing: ${marker}`);for(const forbidden of ['push:','pull_request:','pull_request_target:','deployment:','wrangler deploy','npm run deploy'])assert(!workflow.includes(forbidden),`readiness workflow contains forbidden release capability: ${forbidden}`);
const monitor=read('scripts/production-health-monitor.mjs');for(const marker of ["url.pathname!=='/ready'",'value.data.status','operational_alerts','staff_access','release'])assert(monitor.includes(marker),`production monitor does not validate current readiness: ${marker}`);

assert(!existsSync(path.join(root,'wrangler.production.jsonc')),'rendered production config exists; refresh deployment audit');
assert(!existsSync(path.join(root,'apps/api/wrangler.production.jsonc')),'rendered API production config exists; refresh deployment audit');
assert(!existsSync(path.join(root,'apps/api/wrangler.staging.jsonc')),'rendered API staging config exists; refresh deployment audit');
console.log(JSON.stringify({status:'PASS',migration:'0001-0065_CONTINUOUS',staff_auth:'CLOUDFLARE_ACCESS_REQUIRED',scheduler:'PRODUCTION_REQUIRED',readiness:'/ready',recovery:'SCHEMA65_CURRENT_RELEASE_D1_R2_ATTESTATION_REQUIRED',local_external_calls:0,production_go:'OWNER_APPROVAL_AND_EXPLICIT_PROBE_REQUIRED'},null,2));
