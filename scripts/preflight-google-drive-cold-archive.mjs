import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { externalReleaseConfigPath, readLocalReleaseConfig } from './preflight-cloudflare-release.mjs';

const root=path.resolve(import.meta.dirname,'..');
const scope='https://www.googleapis.com/auth/drive.file';
const environments=new Set(['staging','production']);
const secretNames=Object.freeze(['GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN']);
const sha=/^[a-f0-9]{64}$/u;
const commit=/^[a-f0-9]{40}$/u;
const safe=/^[A-Za-z0-9._-]{1,500}$/u;

export function validateColdArchiveActivation(config,environment,declaredSecrets,evidence){
  const vars=config?.vars&&typeof config.vars==='object'?config.vars:null; const errors=[];
  if(!environments.has(environment)) return ['environment:invalid'];
  if(!vars) return ['vars:missing'];
  if(vars.APP_ENVIRONMENT!==environment) errors.push('vars.APP_ENVIRONMENT:wrong_environment');
  for(const key of ['SCHEDULED_OPERATIONS_ENABLED','DRIVE_ARCHIVE_ENABLED','DRIVE_ARCHIVE_COPY_ENABLED']) if(vars[key]!=='true') errors.push(`vars.${key}:must_be_true`);
  for(const key of ['DRIVE_ARCHIVE_PROXY_READ_ENABLED','DRIVE_ARCHIVE_R2_DELETE_ENABLED']) if(vars[key]!=='false') errors.push(`vars.${key}:must_remain_false`);
  for(const key of ['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_FOLDER_ID','GOOGLE_DRIVE_OWNER_ACCOUNT_KEY']) if(typeof vars[key]!=='string'||!safe.test(vars[key])||/REQUIRED|PLACEHOLDER|TODO/iu.test(vars[key])) errors.push(`vars.${key}:missing_or_invalid`);
  for(const key of secretNames) if(Object.hasOwn(vars,key)) errors.push(`vars.${key}:managed_secret_forbidden`);
  for(const key of secretNames) if(!new Set(declaredSecrets).has(key)) errors.push(`managed_secret.${key}:not_declared`);
  if(!evidence.oauth||evidence.oauth.requested_scope!==scope||evidence.oauth.returned_scope!==scope||evidence.oauth.tokens_persisted!==false||evidence.oauth.owner_only!==true||evidence.oauth.anonymous_readback_sha256!==true||evidence.oauth.resume_and_duplicate!==true||evidence.oauth.revoked!==true) errors.push('oauth_evidence:invalid');
  if(!evidence.backup||evidence.backup.encrypted!==true||!sha.test(String(evidence.backup.encrypted_bundle_sha256??''))||!sha.test(String(evidence.backup.manifest_sha256??''))||!Number.isSafeInteger(evidence.backup.schema_version)||evidence.backup.schema_version<1||!commit.test(String(evidence.backup.release_commit_sha??''))) errors.push('backup_attestation:invalid');
  if(!evidence.controls||evidence.controls.copy_enabled!==1||evidence.controls.proxy_read_enabled!==0||evidence.controls.r2_delete_enabled!==0) errors.push('d1_controls:shadow_copy_only_required');
  return [...new Set(errors)].sort();
}

function privateExternalFile(value,label){
  const input=externalReleaseConfigPath(value); if(!input.file) return {file:null,error:`${label}:${input.error}`};
  try { const stat=statSync(input.file); if((stat.mode&0o077)!==0) return {file:null,error:`${label}:not_owner_private`}; return {file:input.file,error:null}; }catch{return {file:null,error:`${label}:unreadable`};}
}
function parseEvidence(file){
  try { const value=JSON.parse(readFileSync(file,'utf8')); if(hasSensitiveEvidence(value)) throw new Error('sensitive_field'); return value; }catch{return null;}
}
function hasSensitiveEvidence(value){if(Array.isArray(value))return value.some(hasSensitiveEvidence);if(!value||typeof value!=='object')return typeof value==='string'&&/^https?:\/\//iu.test(value);return Object.entries(value).some(([key,item])=>/^(?:access_token|refresh_token|authorization_code|drive_file_id|folder_id|owner_account_key|resumable_session|object_key|client_secret)$/iu.test(key)||hasSensitiveEvidence(item));}
function args(values){const out={secrets:[]};for(let i=0;i<values.length;i+=1){const k=values[i];if(!k.startsWith('--'))throw new Error('arguments:invalid');if(k==='--declared-secret'){out.secrets.push(values[++i]??'');continue;}const v=values[++i];if(!v||v.startsWith('--'))throw new Error('arguments:invalid');if(!['--environment','--config','--oauth-evidence','--backup-evidence','--d1-controls'].includes(k))throw new Error('arguments:invalid');out[k.slice(2)]=v;}return out;}
function output(status,environment,errors){console.log(JSON.stringify({status,environment,required_managed_secret_names:secretNames,required_external_approvals:['owner_mfa_and_recovery','private_owner_only_drive_hierarchy','managed_secret_injection','anonymous_provider_e2e','proxy_read_separate_approval','r2_delete_separate_approval','production_go_signature'],errors:[...new Set(errors)].sort(),external_calls:0,provider_calls:0,d1_calls:0,r2_calls:0,resource_mutations:0},null,2));if(status==='BLOCKED')process.exitCode=1;}
function main(){let input;try{input=args(process.argv.slice(2));}catch{output('BLOCKED',null,['arguments:invalid']);return;}const environment=input.environment;if(!environments.has(environment)){output('BLOCKED',environment??null,['environment:invalid']);return;}if(!input.config){output('LOCAL_NO_GO',environment,['external_evidence_not_supplied']);return;}const files={};const errors=[];for(const [key,label] of [['config','config'],['oauth-evidence','oauth_evidence'],['backup-evidence','backup_evidence'],['d1-controls','d1_controls']]){const r=privateExternalFile(input[key],label);if(!r.file)errors.push(r.error);else files[key]=r.file;}if(errors.length){output('BLOCKED',environment,errors);return;}const oauth=parseEvidence(files['oauth-evidence']);const backup=parseEvidence(files['backup-evidence']);const controls=parseEvidence(files['d1-controls']);if(!oauth)errors.push('oauth_evidence:invalid_or_sensitive');if(!backup)errors.push('backup_evidence:invalid_or_sensitive');if(!controls)errors.push('d1_controls:invalid_or_sensitive');let config;try{config=readLocalReleaseConfig(files.config);}catch{errors.push('config:unreadable_or_invalid');}if(!errors.length)errors.push(...validateColdArchiveActivation(config,environment,input.secrets,{oauth,backup,controls}));output(errors.length?'BLOCKED':'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO',environment,errors);}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main();
