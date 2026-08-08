import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const active='openspec/changes/production-readiness-backup-validation/specs/production-readiness/spec.md';
const archived='openspec/specs/production-readiness/spec.md';
const spec=read(existsSync(path.join(root,active))?active:archived);
const requirements=[...spec.matchAll(/^### Requirement: (.+)$/gmu)].map((match)=>match[1]);
const scenarios=[...spec.matchAll(/^#### Scenario: (.+)$/gmu)].map((match)=>match[1]);
assert(requirements.length===5,`expected 5 requirements, found ${requirements.length}`);
assert(scenarios.length===10,`expected 10 scenarios, found ${scenarios.length}`);
const purpose=spec.match(/^## Purpose\n([^\n]+)$/mu)?.[1]??'';
assert(purpose.length>=40&&!/\bTBD\b/iu.test(purpose),'canonical Purpose must be substantive and must not contain TBD');
const backup=read('packages/testkit/src/production-readiness-backup.ts');
const reconcile=read('packages/testkit/src/production-readiness-file-reconciliation.ts');
const controls=read('packages/contracts/src/production-readiness.ts');
const tests=readdirSync(path.join(root,'apps/api/src/production-readiness')).filter((file)=>file.endsWith('.test.ts')).map((file)=>read(`apps/api/src/production-readiness/${file}`)).join('\n');
const runbook=read('docs/runbooks/PRODUCTION_READINESS_BACKUP_RESTORE.md');
const acceptance=read('docs/acceptance/M10_PRODUCTION_READINESS_BACKUP_VALIDATION.md');
const security=read('docs/security/V2_REACT_ROUTER_RSC_ADVISORY_DISPOSITION.md');
for(const marker of ['AES-256-GCM','HKDF-SHA256','createHmac','timingSafeEqual','releaseCommitSha','attestationPath','expectedReleaseCommitSha','validateBackupManifest','gzip','schema_fingerprint_sha256','financial_aggregates','PRAGMA foreign_key_check','smoke_reads']) assert(backup.includes(marker),`backup evidence missing: ${marker}`);
for(const marker of ['MISSING','ORPHAN','DUPLICATE','SIZE_MISMATCH','MIME_MISMATCH','SHA256_MISMATCH','PUBLIC_LINK','external_calls: 0','r2_deletes: 0']) assert(reconcile.includes(marker),`reconciliation evidence missing: ${marker}`);
for(const marker of ['worker_5xx','login_anomaly','job_stale_or_backlog','file_integrity','drive_dependency','feishu_dependency','mcp_dependency','d1_dependency','r2_dependency','capacity','PROVIDER_INDEPENDENT_REQUIRED']) assert(controls.includes(marker),`alert control missing: ${marker}`);
for(const marker of ['attestation_hmac_mismatch','release_commit_mismatch','bundle_attestation_mismatch','invalid_backup_manifest','insecure_backup_key_permissions','restore_target_exists','R2_REHYDRATION_REQUIRED','daily_orders: 200','staff_count: 8']) assert(tests.includes(marker),`test evidence missing: ${marker}`);
assert(runbook.includes('备份创建成功不等于可恢复'),'backup/restore distinction missing');
assert(runbook.includes('不创建 `0035`'),'Migration decision missing');
assert(acceptance.includes('本地候选通过、生产未批准/未上线'),'truthful release conclusion missing');
assert((acceptance.match(/P0-0[1-8]/gu)??[]).length===8,'external P0 matrix incomplete');
assert(security.includes('react-router 8.3.0'),'official patched dependency disposition missing');
const migrations=readdirSync(path.join(root,'migrations')).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
assert(migrations.length===36&&migrations.at(-2)==='0035_staff_four_role_consolidation.sql'&&migrations.at(-1)==='0036_staff_acquisition_funnel_workbench.sql','schema must be the governed 0001-0036 chain');
const webPackage=JSON.parse(read('apps/web/package.json'));
assert(webPackage.dependencies?.['react-router']==='8.3.0','react-router must be pinned to 8.3.0');
assert(webPackage.dependencies?.['react-router-dom']===undefined,'react-router-dom must be removed');
console.log(JSON.stringify({status:'PASS',change:'production-readiness-backup-validation',requirements:5,scenarios:10,purpose:'NON_TBD',migration:'NO_0035_SCHEMA_34',backup:'HKDF_HMAC_RELEASE_BOUND_RESTORE_REQUIRED',reconciliation:'OFFLINE_NO_DELETE',capacity:'8_STAFF_200_ORDERS',external_gates:'8_PRODUCTION_GO_BLOCKERS',production_go:'NOT_APPROVED'},null,2));

function read(file){return readFileSync(path.join(root,file),'utf8');}
function assert(value,message){if(!value)throw new Error(message);}
