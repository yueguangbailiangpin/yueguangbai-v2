import { readdirSync } from 'node:fs';
import path from 'node:path';
import { invariant as assert,readRepositoryFile as read,repositoryRoot as root } from './verifier-utils.mjs';

const EXPECTED_SCHEMA=71;
const migrations=readdirSync(path.join(root,'migrations')).filter((name)=>/^\d{4}_.+\.sql$/u.test(name)).sort();
assert(migrations.length===EXPECTED_SCHEMA,'repository migration count must match schema 71');
assert(migrations.every((name,index)=>Number(name.slice(0,4))===index+1),'Migration chain must be continuous');
assert(migrations.at(-1)==='0071_product_application_amount.sql','latest migration must persist Seller product application amount');

const template=read('apps/api/wrangler.production.template.jsonc');
for(const marker of [
  '"APP_RELEASE_SHA": "REQUIRED_RELEASE_COMMIT_SHA"',
  '"SCHEDULED_OPERATIONS_ENABLED": "true"',
  '"ACQUISITION_MAINTENANCE_ENABLED": "true"',
  '"OPERATIONAL_ALERT_MODE": "bound"',
  '"OPERATIONAL_ALERT_SINK_IDENTITY": "REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_IDENTITY"',
  '"OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION": "REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION"',
  '"binding": "OPERATIONAL_ALERT_SINK"',
  '"STAFF_ACCESS_TEAM_DOMAIN": "REQUIRED_CLOUDFLARE_ACCESS_TEAM_HTTPS_ORIGIN"',
  '"STAFF_ACCESS_AUD": "REQUIRED_CLOUDFLARE_ACCESS_APPLICATION_AUD"',
])assert(template.includes(marker),`production template missing ${marker}`);
assert(!template.includes('"STAFF_AUTH_PROVIDER": "FEISHU"'),'Feishu must not be Staff auth authority');
assert(!template.includes('FEISHU_WORKBENCH_APP_ID'),'production template must not require legacy Feishu workbench identity');

const readiness=read('apps/api/src/operational-readiness/routes.ts');
for(const marker of ['const TARGET_SCHEMA = 71','APP_RELEASE_SHA','production_recovery_attestations','operationalAlertAttestationReady','last_backlog_count','staff_access','release'])
  assert(readiness.includes(marker),`readiness boundary missing ${marker}`);
const recovery=read('apps/api/src/production-readiness/recovery-attestation-routes.ts');
assert(recovery.includes('const TARGET_SCHEMA = 71'),'recovery attestation must target schema 71');
assert(recovery.includes('APP_RELEASE_SHA'),'recovery attestation must bind current release SHA');
const alertAttestation=read('apps/api/src/operational-readiness/alert-attestation.ts');
for(const marker of ['verifyOperationalAlertChallenge','OPERATIONAL_ALERT_CHALLENGE_TYPES','nonce','release_sha','sink_identity','sink_deployment_version','sink_config_fingerprint','verified_receipts','expires_at'])assert(alertAttestation.includes(marker),`operational alert attestation missing ${marker}`);
for(const forbidden of ['delivery_result','failure_result','recovery_result'])assert(!alertAttestation.includes(`body['${forbidden}']`),`client controls ${forbidden}`);
const monitor=read('.github/workflows/production-health-monitor.yml');
assert(monitor.includes('https://app.yueguangbai.net/ready'),'external health monitor must probe readiness');

console.log(JSON.stringify({
  status:'PASS',
  check:'production-readiness-local-static',
  schema:EXPECTED_SCHEMA,
  migrations:'0001-0071_CONTINUOUS',
  staff_auth:'CLOUDFLARE_ACCESS',
  scheduler:'REQUIRED',
  acquisition_maintenance:'REQUIRED',
  recovery:'CURRENT_RELEASE_SHA_REQUIRED',
  operational_alerts:'BOUND_SINK_AND_CURRENT_IMMUTABLE_ATTESTATION_REQUIRED',
  external_calls:0,
  production_go:'NOT_PROBED',
},null,2));
