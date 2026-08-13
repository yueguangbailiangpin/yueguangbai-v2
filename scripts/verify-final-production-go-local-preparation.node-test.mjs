import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyFinalProductionGoWorkflows } from './final-production-go-workflow-governance.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(file)=>readFileSync(path.join(root,file),'utf8');
const canonicalCi=read('.github/workflows/ci.yml');
const canonicalHealth=read('.github/workflows/production-health-monitor.yml');
const rootManifest=JSON.parse(read('package.json'));
const workspaceManifests=['apps','packages','tools'].flatMap((directory)=>readdirSync(path.join(root,directory),{withFileTypes:true})
  .filter((entry)=>entry.isDirectory()&&existsSync(path.join(root,directory,entry.name,'package.json')))
  .map((entry)=>JSON.parse(read(`${directory}/${entry.name}/package.json`))));

function verify({ci=canonicalCi,health=canonicalHealth,scripts={}}={}){
  verifyFinalProductionGoWorkflows({'ci.yml':ci,'production-health-monitor.yml':health},{...rootManifest,scripts:{...rootManifest.scripts,...scripts}},workspaceManifests);
}

function withCiRun(run){
  const rendered=run.includes('\n')?`run: |\n${run.split('\n').map((line)=>`          ${line}`).join('\n')}`:`run: ${run}`;
  return canonicalCi.replace('run: npm ci',rendered);
}

test('the committed final-go verifier accepts the canonical repository',()=>{
  const result=spawnSync(process.execPath,['scripts/verify-final-production-go-local-preparation.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/"status": "PASS"/u);
});

test('accepts the narrowly approved CI command forms',()=>{
  assert.doesNotThrow(()=>verify({ci:withCiRun('npx wrangler deploy --dry-run')}));
  assert.doesNotThrow(()=>verify({ci:withCiRun('npm exec -- wrangler d1 migrations apply yueguangbai-v2-local --local')}));
  assert.doesNotThrow(()=>verify({ci:withCiRun('npm --silent run harmless'),scripts:{harmless:'node scripts/scan-secrets.mjs'}}));
});

test('rejects job-level elevated permissions',()=>{
  assert.throws(()=>verify({ci:canonicalCi.replace('  static-governance:\n','  static-governance:\n    permissions:\n      contents: write\n')}),/job keys|permissions/u);
});

test('rejects top-level execution environment preload',()=>{
  assert.throws(()=>verify({ci:canonicalCi.replace('concurrency:\n','env:\n  NODE_OPTIONS: --require ./evil.cjs\nconcurrency:\n')}),/root keys|env/u);
});

test('rejects non-bash defaults and Python run payloads',()=>{
  const ci=withCiRun('import deploy_payload').replace('concurrency:\n','defaults:\n  run:\n    shell: python\nconcurrency:\n');
  assert.throws(()=>verify({ci}),/root keys|defaults/u);
});

test('rejects self-hosted and dynamic runners',()=>{
  assert.throws(()=>verify({ci:canonicalCi.replace('runs-on: ubuntu-latest','runs-on: self-hosted')}),/ubuntu-latest/u);
  assert.throws(()=>verify({ci:canonicalCi.replace('runs-on: ubuntu-latest','runs-on: ${{ matrix.runner }}')}),/ubuntu-latest/u);
});

test('rejects production environments',()=>{
  assert.throws(()=>verify({ci:canonicalCi.replace('    timeout-minutes: 20\n','    environment: production\n    timeout-minutes: 20\n')}),/job keys|environment/u);
});

test('rejects remote D1 migrations even through npx',()=>{
  assert.throws(()=>verify({ci:withCiRun('npx wrangler d1 migrations apply production --remote')}),/only local|allowlist/u);
});

test('normalizes npm global flags before resolving the actual script',()=>{
  assert.throws(()=>verify({ci:withCiRun('npm --silent run deploy-hidden'),scripts:{'deploy-hidden':'wrangler deploy'}}),/dry-run|allowlist/u);
});

test('rejects repository Node scripts outside the explicit allowlist',()=>{
  assert.throws(()=>verify({ci:withCiRun('node scripts/production-deploy.mjs')}),/node script/u);
});

test('rejects unapproved Wrangler command families such as Pages',()=>{
  assert.throws(()=>verify({ci:withCiRun('npx wrangler pages project create production-site')}),/Wrangler command family/u);
});

test('rejects unknown workflows, dangerous triggers, shell indirection, and unresolved scripts',()=>{
  const missing={'ci.yml':canonicalCi};
  assert.throws(()=>verifyFinalProductionGoWorkflows(missing,rootManifest,workspaceManifests),/workflow inventory/u);
  assert.throws(()=>verify({ci:canonicalCi.replace('pull_request:','pull_request_target:')}),/triggers/u);
  assert.throws(()=>verify({ci:withCiRun('sh -c "$COMMAND"')}),/dynamic/u);
  assert.throws(()=>verify({ci:withCiRun('sh -c "npx wrangler deploy"')}),/dry-run/u);
  assert.throws(()=>verify({ci:withCiRun('npm run absent')}),/missing/u);
  assert.throws(()=>verify({ci:withCiRun('npm run alpha'),scripts:{alpha:'npm run beta',beta:'npm run alpha'}}),/cycle/u);
});

test('rejects a health workflow context or command drift',()=>{
  assert.throws(()=>verify({health:canonicalHealth.replace('    timeout-minutes: 2\n','    environment: production\n    timeout-minutes: 2\n')}),/health job keys|environment/u);
  assert.throws(()=>verify({health:canonicalHealth.replace('run: node scripts/production-health-monitor.mjs','run: node scripts/production-deploy.mjs')}),/canonical monitor|health monitor/u);
});
