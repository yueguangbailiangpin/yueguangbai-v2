import { readdirSync } from 'node:fs';
import path from 'node:path';
import { invariant as assert,readRepositoryFile as read,repositoryRoot as root } from './verifier-utils.mjs';

const CURRENT_PRODUCTION_DOCUMENTS=Object.freeze([
  'docs/contracts/PRODUCTION_CLOUDFLARE_WEB_R2_RELEASE.md',
  'docs/runbooks/PRODUCTION_CLOUDFLARE_WEB_R2_RELEASE.md',
  'docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md',
  'docs/acceptance/FINAL_PRODUCTION_GO_LOCAL_PREPARATION.md',
]);

export function resolveProductionSchemaBaseline(repositoryRoot=root){
  const migrations=readdirSync(path.join(repositoryRoot,'migrations')).filter((file)=>/^\d{4}_.+\.sql$/u.test(file)).sort();
  const runtime=read('apps/api/src/operational-readiness/routes.ts',repositoryRoot);
  const runtimeMatch=runtime.match(/const TARGET_SCHEMA=(\d+)/u);
  assert(runtimeMatch,'operational readiness TARGET_SCHEMA baseline is missing');
  const schema=Number(runtimeMatch[1]);
  const latestMigration=migrations.at(-1);
  assert(migrations.length===schema,'migration count must equal operational readiness TARGET_SCHEMA');
  assert(Number(latestMigration?.slice(0,4))===schema,'latest migration number must equal operational readiness TARGET_SCHEMA');
  return{schema,latestMigration};
}

export function verifyProductionSchemaDocuments(repositoryRoot=root){
  const baseline=resolveProductionSchemaBaseline(repositoryRoot);
  const chain=['`0001`',`\`${String(baseline.schema).padStart(4,'0')}\``].join('–');
  for(const file of CURRENT_PRODUCTION_DOCUMENTS){
    const document=read(file,repositoryRoot);
    assert(document.includes(chain),`${file} must declare the current ${chain} migration chain`);
    assert(document.includes(baseline.latestMigration),`${file} must name ${baseline.latestMigration}`);
  }
  return baseline;
}

if(import.meta.main){
  const baseline=verifyProductionSchemaDocuments();
  console.log(JSON.stringify({status:'PASS',check:'production-schema-documents',schema:baseline.schema,latest_migration:baseline.latestMigration,documents:CURRENT_PRODUCTION_DOCUMENTS,external_calls:0},null,2));
}
