import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { discoverCanonicalWorkspacePackages,verifyFinalProductionGoWorkflows } from './final-production-go-workflow-governance.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(file)=>readFileSync(path.join(root,file),'utf8');
const canonicalCi=read('.github/workflows/ci.yml');
const canonicalHealth=read('.github/workflows/production-health-monitor.yml');
const rootManifest=JSON.parse(read('package.json'));
const canonicalWorkspacePackages=discoverCanonicalWorkspacePackages(root,rootManifest);

function verify({ci=canonicalCi,health=canonicalHealth,scripts={},rootOverrides={},workspacePackages=canonicalWorkspacePackages}={}){
  const manifest={...rootManifest,...rootOverrides,scripts:{...rootManifest.scripts,...scripts,...rootOverrides.scripts}};
  verifyFinalProductionGoWorkflows({'ci.yml':ci,'production-health-monitor.yml':health},manifest,workspacePackages);
}

function withCiRun(run){
  const rendered=run.includes('\n')?`run: |\n${run.split('\n').map((line)=>`          ${line}`).join('\n')}`:`run: ${run}`;
  return canonicalCi.replace('run: npm ci',rendered);
}

function createTopologyFixture(t){
  const fixtureRoot=mkdtempSync(path.join(tmpdir(),'ygb-final-go-topology-'));
  t.after(()=>rmSync(fixtureRoot,{recursive:true,force:true}));
  for(const directory of ['apps','packages','tools'])mkdirSync(path.join(fixtureRoot,directory));
  const fixtureManifest={name:'topology-root',version:'1.0.0',private:true,engines:{node:'>=24 <25'},workspaces:['apps/*','packages/*','tools/*'],scripts:{}};
  const workspaceManifest={name:'@fixture/app',version:'1.0.0',private:true,scripts:{typecheck:'tsc -p tsconfig.json --noEmit'}};
  mkdirSync(path.join(fixtureRoot,'apps','app'));
  writeJson(path.join(fixtureRoot,'package.json'),fixtureManifest);
  writeJson(path.join(fixtureRoot,'apps','app','package.json'),workspaceManifest);
  writeLockfile(fixtureRoot,['apps/app']);
  return {fixtureRoot,fixtureManifest,workspaceManifest};
}

function writeLockfile(fixtureRoot,workspacePaths){
  writeJson(path.join(fixtureRoot,'package-lock.json'),{name:'topology-root',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'topology-root',version:'1.0.0',workspaces:['apps/*','packages/*','tools/*']},...Object.fromEntries(workspacePaths.map((workspacePath)=>[workspacePath,{}]))}});
}

function writeJson(file,value){writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);}

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

test('accepts the canonical filesystem-driven workspace topology',()=>{
  assert.deepEqual(canonicalWorkspacePackages.map(({relativePath})=>relativePath),['apps/api','apps/web','packages/contracts','packages/domain','packages/testkit','tools/imports']);
  assert.doesNotThrow(()=>verify());
});

test('rejects root npm ci lifecycle hooks with unchanged workflows',()=>{
  assert.throws(()=>verify({scripts:{preinstall:'npx wrangler deploy'}}),/preinstall.*npm ci/u);
  assert.throws(()=>verify({scripts:{prepare:'node scripts/production-deploy.mjs'}}),/prepare.*npm ci/u);
});

test('rejects root workspace glob expansion with unchanged workflows',()=>{
  assert.throws(()=>verify({rootOverrides:{workspaces:['apps/*','packages/*','tools/*','unreviewed/*']}}),/workspaces must exactly/u);
  assert.throws(()=>verify({rootOverrides:{workspaces:['apps/*','packages/*','../outside/*']}}),/workspaces must exactly/u);
});

test('rejects workspace npm ci lifecycle and npm run pre/post hooks',()=>{
  const [first,...rest]=canonicalWorkspacePackages;
  const lifecycleWorkspace={...first,manifest:{...first.manifest,scripts:{...first.manifest.scripts,postinstall:'npx wrangler deploy'}}};
  assert.throws(()=>verify({workspacePackages:[lifecycleWorkspace,...rest]}),/postinstall.*npm ci/u);
  const hookedWorkspace={...first,manifest:{...first.manifest,scripts:{...first.manifest.scripts,prebuild:'npx wrangler deploy'}}};
  assert.throws(()=>verify({workspacePackages:[hookedWorkspace,...rest]}),/dry-run/u);
  assert.throws(()=>verify({scripts:{'precheck:ci:static':'npx wrangler deploy'}}),/dry-run/u);
});

test('rejects package manager, config, and binary manifest execution branches',()=>{
  assert.throws(()=>verify({rootOverrides:{packageManager:'npm@11.17.0'}}),/packageManager/u);
  assert.throws(()=>verify({rootOverrides:{config:{node_options:'--require ./evil.cjs'}}}),/config/u);
  assert.throws(()=>verify({rootOverrides:{bin:{tsc:'./evil.cjs'}}}),/bin/u);
  assert.throws(()=>verify({rootOverrides:{engines:{node:'>=24 <25',npm:'>=11'}}}),/engines/u);
});

test('rejects npm configuration files and lockfile topology drift',t=>{
  const npmrc=createTopologyFixture(t);
  writeFileSync(path.join(npmrc.fixtureRoot,'.npmrc'),'ignore-scripts=true\n');
  assert.throws(()=>discoverCanonicalWorkspacePackages(npmrc.fixtureRoot,npmrc.fixtureManifest),/\.npmrc/u);

  const workspaceNpmrc=createTopologyFixture(t);
  writeFileSync(path.join(workspaceNpmrc.fixtureRoot,'apps','app','.npmrc'),'node-options=--require ./evil.cjs\n');
  assert.throws(()=>discoverCanonicalWorkspacePackages(workspaceNpmrc.fixtureRoot,workspaceNpmrc.fixtureManifest),/\.npmrc/u);

  const lockDrift=createTopologyFixture(t);
  writeLockfile(lockDrift.fixtureRoot,[]);
  assert.throws(()=>discoverCanonicalWorkspacePackages(lockDrift.fixtureRoot,lockDrift.fixtureManifest),/package-lock.*exactly match/u);
});

test('rejects npm ci semantic flags instead of hiding lifecycle execution',()=>{
  assert.throws(()=>verify({ci:withCiRun('npm ci --ignore-scripts')}),/npm ci.*ignore-scripts/u);
  assert.throws(()=>verify({ci:withCiRun('npm --workspace @ygb/api ci')}),/npm subcommand|allowlist/u);
});

test('requires dependency lifecycle provenance before the install execution edge',()=>{
  const lifecycleStep=`      - name: Verify locked lifecycle provenance before install
        run: |
          node scripts/verify-dependency-lifecycle.mjs
          node --test scripts/verify-dependency-lifecycle.node-test.mjs
`;
  assert.throws(()=>verify({ci:canonicalCi.replace(lifecycleStep,'')}),/six canonical execution steps/u);
  const reordered=canonicalCi.replace(`${lifecycleStep}      - name: Install locked dependencies
        run: npm ci
`,`      - name: Install locked dependencies
        run: npm ci
${lifecycleStep}`);
  assert.throws(()=>verify({ci:reordered}),/step 3 name|canonical/u);
});

test('rejects symlink and out-of-root workspace topology',t=>{
  const {fixtureRoot,fixtureManifest}=createTopologyFixture(t);
  const outsideRoot=mkdtempSync(path.join(tmpdir(),'ygb-final-go-outside-'));
  t.after(()=>rmSync(outsideRoot,{recursive:true,force:true}));
  writeJson(path.join(outsideRoot,'package.json'),{name:'@fixture/outside',version:'1.0.0',private:true,scripts:{}});
  symlinkSync(outsideRoot,path.join(fixtureRoot,'apps','linked'),'dir');
  assert.throws(()=>discoverCanonicalWorkspacePackages(fixtureRoot,fixtureManifest),/symlink/u);
});

test('rejects filesystem workspace lifecycle, nested workspaces, duplicates, and implicit binding.gyp',t=>{
  const lifecycle=createTopologyFixture(t);
  writeJson(path.join(lifecycle.fixtureRoot,'apps','app','package.json'),{...lifecycle.workspaceManifest,scripts:{...lifecycle.workspaceManifest.scripts,install:'npx wrangler deploy'}});
  assert.throws(()=>discoverCanonicalWorkspacePackages(lifecycle.fixtureRoot,lifecycle.fixtureManifest),/install.*npm ci/u);

  const nested=createTopologyFixture(t);
  writeJson(path.join(nested.fixtureRoot,'apps','app','package.json'),{...nested.workspaceManifest,workspaces:['nested/*']});
  assert.throws(()=>discoverCanonicalWorkspacePackages(nested.fixtureRoot,nested.fixtureManifest),/nested workspaces/u);

  const duplicate=createTopologyFixture(t);
  mkdirSync(path.join(duplicate.fixtureRoot,'packages','copy'));
  writeJson(path.join(duplicate.fixtureRoot,'packages','copy','package.json'),duplicate.workspaceManifest);
  writeLockfile(duplicate.fixtureRoot,['apps/app','packages/copy']);
  assert.throws(()=>discoverCanonicalWorkspacePackages(duplicate.fixtureRoot,duplicate.fixtureManifest),/duplicate workspace package name/u);

  const binding=createTopologyFixture(t);
  writeFileSync(path.join(binding.fixtureRoot,'apps','app','binding.gyp'),'{}\n');
  assert.throws(()=>discoverCanonicalWorkspacePackages(binding.fixtureRoot,binding.fixtureManifest),/implicit npm install lifecycle/u);
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
  assert.throws(()=>verifyFinalProductionGoWorkflows(missing,rootManifest,canonicalWorkspacePackages),/workflow inventory/u);
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
