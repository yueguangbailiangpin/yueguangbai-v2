import { readFileSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot as root } from './verifier-utils.mjs';

const EXPECTED_SCHEMA=61;
const DEFAULT_READY_URL='https://app.yueguangbai.net/ready';
const REQUIRED_CHECKS=['schema','scheduler','acquisition_maintenance','object_storage','recovery'];

export async function verifyProductionReadiness({
  fetchImpl=fetch,
  readyUrl=process.env.YGB_PRODUCTION_READY_URL??DEFAULT_READY_URL,
}={}){
  const migrations=readdirSync(path.join(root,'migrations')).filter((name)=>/^\d{4}_.+\.sql$/u.test(name)).sort();
  if(migrations.length!==EXPECTED_SCHEMA||migrations.some((name,index)=>Number(name.slice(0,4))!==index+1)||migrations.at(-1)!=='0061_post_confirmation_integrity_guards.sql'){
    throw new Error('repository_migration_chain_not_0001_0061');
  }
  const productionTemplate=readFileSync(path.join(root,'apps/api/wrangler.production.template.jsonc'),'utf8');
  for(const marker of [
    '"SCHEDULED_OPERATIONS_ENABLED": "true"','"ACQUISITION_MAINTENANCE_ENABLED": "true"',
    '"STAFF_ACCESS_TEAM_DOMAIN": "REQUIRED_CLOUDFLARE_ACCESS_TEAM_HTTPS_ORIGIN"',
    '"STAFF_ACCESS_AUD": "REQUIRED_CLOUDFLARE_ACCESS_APPLICATION_AUD"',
    '"STAFF_AUTH_ALLOWED_ORIGINS": "REQUIRED_PRODUCTION_HTTPS_ORIGIN"',
  ])if(!productionTemplate.includes(marker))throw new Error(`production_template_missing:${marker}`);
  for(const forbidden of ['"STAFF_AUTH_PROVIDER": "FEISHU"','"STAFF_AUTH_ENABLED": "false"'])if(productionTemplate.includes(forbidden))throw new Error(`stale_staff_auth_marker:${forbidden}`);

  const url=readyEndpoint(readyUrl);let response;
  try{response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10_000)});}catch{throw new Error('production_ready_probe_network_failure');}
  const text=await response.text();if(text.length>16*1024)throw new Error('production_ready_response_too_large');
  let body;try{body=JSON.parse(text);}catch{throw new Error('production_ready_response_invalid_json');}
  if(response.status!==200||body?.data?.status!=='ready')throw new Error(`production_not_ready_http_${response.status}`);
  for(const check of REQUIRED_CHECKS)if(body?.data?.checks?.[check]!=='ok')throw new Error(`production_readiness_check_failed:${check}`);
  return Object.freeze({status:'PASS',schema:EXPECTED_SCHEMA,migration:'0001-0061_CONTINUOUS',staff_auth:'CLOUDFLARE_ACCESS',scheduler:'READY',acquisition_maintenance:'READY',object_storage:'READY',recovery:'SCHEMA61_ATTESTED',ready_url:url});
}
function readyEndpoint(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/ready')throw new Error('invalid_production_ready_url');return url.href;}
async function main(){try{console.log(JSON.stringify(await verifyProductionReadiness(),null,2));}catch(error){console.error(JSON.stringify({status:'NO_GO',reason:error instanceof Error?error.message:'production_readiness_failed'},null,2));process.exitCode=1;}}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await main();
