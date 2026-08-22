import { existsSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { invariant as assert,readRepositoryFile,repositoryRoot as root } from './verifier-utils.mjs';
import { resolveProductionSchemaBaseline,verifyProductionSchemaDocuments } from './verify-production-schema-documents.mjs';
import { discoverCanonicalWorkspacePackages,verifyFinalProductionGoWorkflows } from './final-production-go-workflow-governance.mjs';

const read=(file)=>readRepositoryFile(file,root);
const {schema,latestMigration}=resolveProductionSchemaBaseline();
const migrations=readdirSync(path.join(root,'migrations')).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
assert(migrations.length===schema,`expected ${schema} migrations, found ${migrations.length}`);
assert(migrations.every((file,index)=>Number(file.slice(0,4))===index+1),'migration chain is not continuous');
assert(latestMigration==='0072_unified_order_day_rate_center.sql','current production schema baseline must include the unified order-day rate center in 0072');
assert(migrations.includes('0068_customer_security_deny_password_rate_limit.sql'),'immutable Customer security DENY and password-change rate-limit migration 0068 is missing');
verifyProductionSchemaDocuments();

const production=read('apps/api/wrangler.production.template.jsonc');
for(const marker of ['"APP_RELEASE_SHA": "REQUIRED_RELEASE_COMMIT_SHA"','"SCHEDULED_OPERATIONS_ENABLED": "true"','"ACQUISITION_MAINTENANCE_ENABLED": "true"','"OPERATIONAL_ALERT_MODE": "bound"','"OPERATIONAL_ALERT_SINK_IDENTITY": "REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_IDENTITY"','"OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION": "REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION"','"binding": "OPERATIONAL_ALERT_SINK"','"props": {','"STAFF_ACCESS_TEAM_DOMAIN": "REQUIRED_CLOUDFLARE_ACCESS_TEAM_HTTPS_ORIGIN"','"STAFF_ACCESS_AUD": "REQUIRED_CLOUDFLARE_ACCESS_APPLICATION_AUD"','"STAFF_AUTH_ALLOWED_ORIGINS": "REQUIRED_PRODUCTION_HTTPS_ORIGIN"'])assert(production.includes(marker),`production access/readiness marker missing: ${marker}`);
for(const forbidden of ['"STAFF_AUTH_PROVIDER": "FEISHU"','"STAFF_AUTH_ENABLED": "false"','FEISHU_WORKBENCH_APP_ID'])assert(!production.includes(forbidden),`stale Staff auth production marker remains: ${forbidden}`);

for(const file of ['apps/api/src/operational-readiness/routes.ts','apps/api/src/operational-readiness/alert-attestation.ts','apps/api/src/production-readiness/recovery-attestation-routes.ts','apps/api/src/staff-auth/cloudflare-access.ts','apps/api/src/files/r2-object-storage.ts','docs/OPERATING_INTEGRITY_FREEZE.md','docs/SECOND_LAYER_HARDENING_FREEZE.md'])assert(existsSync(path.join(root,file)),`required production boundary missing: ${file}`);
const readiness=read('apps/api/src/operational-readiness/routes.ts');assert(new RegExp(`const TARGET_SCHEMA\\s*=\\s*${schema}\\b`).test(readiness),'readiness target schema is stale');assert(readiness.includes('APP_RELEASE_SHA'),'readiness is not bound to running release');
const attestation=read('apps/api/src/production-readiness/recovery-attestation-routes.ts');assert(new RegExp(`const TARGET_SCHEMA\\s*=\\s*${schema}\\b`).test(attestation),'recovery attestation target schema is stale');assert(attestation.includes('APP_RELEASE_SHA'),'recovery proof is not bound to running release');
const localVerifier=read('scripts/verify-production-readiness-formal.mjs');assert(localVerifier.includes('external_calls:0'),'local readiness verifier must be offline');
assert(existsSync(path.join(root,'scripts/probe-production-readiness.mjs')),'explicit external readiness probe missing');

const workflowFiles=readdirSync(path.join(root,'.github/workflows')).filter((file)=>/\.ya?ml$/u.test(file));
const rootPackageManifest=JSON.parse(read('package.json'));
verifyFinalProductionGoWorkflows(Object.fromEntries(workflowFiles.map((file)=>[file,read(`.github/workflows/${file}`)])),rootPackageManifest,discoverCanonicalWorkspacePackages(root,rootPackageManifest));
const monitor=read('scripts/production-health-monitor.mjs');for(const marker of ["url.pathname!=='/ready'",'value.data.status','outbox_delivery','not_required','operational_alerts','staff_access','release'])assert(monitor.includes(marker),`production monitor does not validate current readiness: ${marker}`);
const productionProbe=read('scripts/probe-production-readiness.mjs');for(const marker of ['outbox_delivery','not_required'])assert(productionProbe.includes(marker),`production readiness probe does not enforce governed Outbox deferral: ${marker}`);

assert(!existsSync(path.join(root,'wrangler.production.jsonc')),'rendered production config exists; refresh deployment audit');
assert(!existsSync(path.join(root,'apps/api/wrangler.production.jsonc')),'rendered API production config exists; refresh deployment audit');
assert(!existsSync(path.join(root,'apps/api/wrangler.staging.jsonc')),'rendered API staging config exists; refresh deployment audit');
console.log(JSON.stringify({status:'PASS',migration:`0001-${String(schema).padStart(4,'0')}_CONTINUOUS`,staff_auth:'CLOUDFLARE_ACCESS_REQUIRED',scheduler:'PRODUCTION_REQUIRED',readiness:'/ready',recovery:`SCHEMA${schema}_CURRENT_RELEASE_D1_R2_ATTESTATION_REQUIRED`,local_external_calls:0,production_go:'OWNER_APPROVAL_AND_EXPLICIT_PROBE_REQUIRED'},null,2));
