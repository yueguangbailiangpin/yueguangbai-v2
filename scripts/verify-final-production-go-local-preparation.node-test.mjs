import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyFinalProductionGoWorkflows } from './final-production-go-workflow-governance.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=(scripts={})=>({name:'workflow-fixture',scripts});
const runBlock=(run)=>run.includes('\n')?`run: |\n${run.split('\n').map((line)=>`          ${line}`).join('\n')}`:`run: ${run}`;
const ci=(run='npx wrangler deploy --dry-run',extraJobs='')=>`name: CI
on:
  pull_request:
  push:
    branches:
      - main
permissions:
  contents: read
jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - name: audited command
        ${runBlock(run)}
${extraJobs}`;
const health=(run='node scripts/production-health-monitor.mjs')=>`name: Health
on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:
permissions:
  contents: read
  issues: write
jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - name: probe
        ${runBlock(run)}
`;
const workflows=(run,options={})=>({'ci.yml':ci(run,options.extraJobs),'production-health-monitor.yml':health(options.healthRun)});
const verify=(run,options={})=>verifyFinalProductionGoWorkflows(workflows(run,options),manifest(options.scripts),options.workspaceManifests??[]);

test('the committed final-go verifier accepts the canonical repository',()=>{
  const result=spawnSync(process.execPath,['scripts/verify-final-production-go-local-preparation.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/"status": "PASS"/u);
});

test('accepts a SHA-pinned YAML workflow with explicit Wrangler deploy dry-run',()=>{
  assert.doesNotThrow(()=>verify('npx wrangler deploy --dry-run'));
});

test('accepts a supported local D1 migration apply',()=>{
  assert.doesNotThrow(()=>verify('npm exec -- wrangler d1 migrations apply yueguangbai-v2-local --local'));
  assert.doesNotThrow(()=>verify('npm exec wrangler -- d1 migrations apply yueguangbai-v2-local --local'));
});

test('rejects an unknown workflow fixture',()=>{
  const fixture=workflows('node scripts/check.mjs');fixture['release.yml']='name: release\non:\n  workflow_dispatch:\n';
  assert.throws(()=>verifyFinalProductionGoWorkflows(fixture,manifest()),/workflow inventory/u);
});

test('rejects a missing canonical workflow fixture',()=>{
  const fixture=workflows('node scripts/check.mjs');delete fixture['production-health-monitor.yml'];
  assert.throws(()=>verifyFinalProductionGoWorkflows(fixture,manifest()),/workflow inventory/u);
});

test('rejects dangerous triggers and every job run step',()=>{
  assert.throws(()=>verify('node scripts/check.mjs',{extraJobs:`  hidden:
    runs-on: ubuntu-latest
    steps:
      - name: bypass
        run: npx wrangler deploy
`}),/deploy/u);
  const fixture=workflows('node scripts/check.mjs');fixture['ci.yml']=fixture['ci.yml'].replace('  pull_request:\n','  pull_request_target:\n');
  assert.throws(()=>verifyFinalProductionGoWorkflows(fixture,manifest()),/triggers/u);
});

test('rejects actual remote Wrangler mutation commands, including the previous bypass input',()=>{
  for(const command of [
    'npx wrangler d1 migrations apply production --remote',
    'npx wrangler d1 migrations apply production',
    'npx wrangler d1 execute production --command "DELETE FROM audit_events"',
    'npx wrangler d1 migrations apply local --local --dry-run',
    'npx wrangler r2 bucket create production-files',
    'npx wrangler r2 object put production-files/key --file fixture',
    'npx wrangler kv namespace create production-cache',
    'npx wrangler kv key put key value --binding CACHE',
    'npx wrangler secret put SESSION_SECRET',
    'npx wrangler queues create production-queue',
    'npx wrangler dispatch-namespace create production-dispatch',
    'npx wrangler d1 migrations apply production --remote # BYPASS_ACCEPTED',
  ])assert.throws(()=>verify(command),/remote|mutation|capability|requires/u,command);
});

test('resolves npm run scripts rather than trusting their names',()=>{
  assert.throws(()=>verify('npm run release-production',{scripts:{'release-production':'npx wrangler deploy'}}),/deploy/u);
  assert.throws(()=>verify('npm run release-production',{scripts:{'release-production':'npm run deploy','deploy':'npx wrangler deploy'}}),/deploy/u);
  assert.throws(()=>verify('npm run release-production --workspaces',{workspaceManifests:[manifest({'release-production':'npx wrangler secret put SESSION_SECRET'})]}),/Secret/u);
});

test('rejects multiline shell, fixed shell indirection, and dynamic shell indirection',()=>{
  assert.throws(()=>verify('node scripts/check.mjs\nnpx wrangler d1 migrations apply production --remote'),/remote|mutation|requires/u);
  assert.throws(()=>verify('sh -c "npx wrangler deploy"'),/deploy/u);
  assert.throws(()=>verify('sh -c "$COMMAND"'),/dynamic/u);
  assert.throws(()=>verify('node -e "require(\'node:child_process\').execSync(\'wrangler deploy\')"'),/inline evaluators/u);
});

test('detects npm script cycles and missing scripts closed',()=>{
  assert.throws(()=>verify('npm run alpha',{scripts:{alpha:'npm run beta',beta:'npm run alpha'}}),/cycle/u);
  assert.throws(()=>verify('npm run absent'),/missing/u);
});

test('rejects additional health commands even when the canonical monitor remains present',()=>{
  assert.throws(()=>verify('node scripts/check.mjs',{healthRun:'node scripts/production-health-monitor.mjs\necho extra'}),/canonical monitor entrypoint/u);
});
