import { pathToFileURL } from 'node:url';

const DEFAULT_READY_URL='https://app.yueguangbai.net/ready';
const REQUIRED_OK_CHECKS=['schema','scheduler','acquisition_maintenance','operational_alerts','object_storage','recovery','staff_access','release'];
const REQUIRED_NOT_REQUIRED_CHECKS=['outbox_delivery'];

export async function probeProductionReadiness({fetchImpl=fetch,readyUrl=process.env.YGB_PRODUCTION_READY_URL??DEFAULT_READY_URL}={}){
  const url=readyEndpoint(readyUrl);let response;
  try{response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10_000)});}catch{throw new Error('production_ready_probe_network_failure');}
  const text=await response.text();if(text.length>16*1024)throw new Error('production_ready_response_too_large');
  let body;try{body=JSON.parse(text);}catch{throw new Error('production_ready_response_invalid_json');}
  if(response.status!==200||body?.data?.status!=='ready')throw new Error(`production_not_ready_http_${response.status}`);
  for(const check of REQUIRED_OK_CHECKS)if(body?.data?.checks?.[check]!=='ok')throw new Error(`production_readiness_check_failed:${check}`);
  for(const check of REQUIRED_NOT_REQUIRED_CHECKS)if(body?.data?.checks?.[check]!=='not_required')throw new Error(`production_readiness_check_failed:${check}`);
  return Object.freeze({status:'PASS',ready_url:url,checks:Object.freeze([...REQUIRED_OK_CHECKS,...REQUIRED_NOT_REQUIRED_CHECKS]),external_calls:1});
}
function readyEndpoint(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/ready')throw new Error('invalid_production_ready_url');return url.href;}
async function main(){try{console.log(JSON.stringify(await probeProductionReadiness(),null,2));}catch(error){console.error(JSON.stringify({status:'NO_GO',reason:error instanceof Error?error.message:'production_readiness_failed'},null,2));process.exitCode=1;}}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await main();
