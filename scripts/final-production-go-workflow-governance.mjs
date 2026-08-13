import { existsSync,lstatSync,readFileSync,readdirSync,realpathSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { parse as parseShell } from 'shell-quote';
import { invariant as assert } from './verifier-utils.mjs';

const CANONICAL_WORKFLOWS=Object.freeze(['ci.yml','production-health-monitor.yml']);
const CANONICAL_WORKSPACE_GLOBS=Object.freeze(['apps/*','packages/*','tools/*']);
const NPM_CI_LIFECYCLE_SCRIPTS=Object.freeze(['preinstall','install','postinstall','prepublish','preprepare','prepare','postprepare']);
const MAX_NPM_SCRIPT_DEPTH=12;
const CI_JOB_POLICY=Object.freeze({
  'static-governance':20,
  'tests-and-build':25,
});
const CI_FINAL_STEPS=Object.freeze({
  'static-governance':Object.freeze({name:'Run static and local-only release gates',run:'npm run check:ci:static'}),
  'tests-and-build':Object.freeze({name:'Run repository tests and builds once',run:'npm run check:ci:test-build'}),
});
const CI_ROOT_KEYS=['name','on','permissions','concurrency','jobs'];
const HEALTH_ROOT_KEYS=['name','on','permissions','concurrency','jobs'];
const CI_NODE_COMMANDS=new Set([
  'scripts/verify-dependency-lifecycle.mjs',
  'scripts/scan-secrets.mjs',
  'scripts/verify-dependency-risk-baseline.mjs',
  'scripts/verify-migrations.mjs',
  'scripts/verify-migration-version-guards.mjs',
  'scripts/preflight-cloudflare-release.mjs',
  'scripts/verify-final-production-go-local-preparation.mjs',
  'scripts/verify-customer-multipersona-security.mjs',
  'scripts/verify-multi-marketplace-multicurrency.mjs',
  'scripts/verify-rakuten-tiktok-jp-adapter-preparation.mjs',
  'scripts/preflight-rakuten-tiktok-jp-adapters.mjs',
  'scripts/verify-phase3i-review-metadata.mjs',
  'scripts/verify-phase3j-seller-payables.mjs',
  'scripts/verify-phase3k-seller-payments.mjs',
  'scripts/verify-seller-finance-security.mjs',
  'scripts/verify-wave11-dto-isolation.mjs',
  'scripts/verify-phase3l-financial-reporting.mjs',
  'scripts/verify-phase3m-financial-exports.mjs',
  'scripts/verify-wave12-migrations.mjs',
  'scripts/verify-wave12-financial-formulas.mjs',
  'scripts/verify-wave12-financial-security.mjs',
  'scripts/verify-wave12-dto-isolation.mjs',
  'scripts/verify-wave13-migration.mjs',
  'scripts/verify-wave13-staff-auth-routes.mjs',
  'scripts/verify-wave13-secret-dto.mjs',
  'scripts/verify-wave13-file-architecture.mjs',
  'scripts/verify-wave13-price-mismatch.mjs',
  'scripts/verify-wave13-buyer-refund-isolation.mjs',
  'scripts/verify-web-source-boundaries.mjs',
  'scripts/verify-module1-buyer-security.mjs',
  'scripts/verify-module1-migration-0028.mjs',
  'scripts/verify-web-static-build.mjs',
]);
const CI_NODE_TEST_COMMANDS=new Set([
  'scripts/verify-dependency-lifecycle.node-test.mjs',
  'scripts/google-drive-oauth-pkce.node-test.mjs',
  'scripts/export-d1-redacted.node-test.mjs',
  'scripts/verify-final-production-go-local-preparation.node-test.mjs',
]);
const NPM_GLOBAL_FLAGS=new Set(['--silent','-s','--if-present','--workspaces','-ws']);
const SHELL_EXECUTORS=new Set(['sh','bash','zsh','/bin/sh','/bin/bash','/bin/zsh']);
const FORBIDDEN_SHELL_EXECUTORS=new Set(['eval','.','source','env','command','xargs','sudo','python','python3','ruby','perl']);
const SAFE_ENV_LINES=new Set([
  'echo "WRANGLER_LOG_PATH=$RUNNER_TEMP/ygb-wrangler.log" >> "$GITHUB_ENV"',
  'echo "XDG_CONFIG_HOME=$RUNNER_TEMP/ygb-xdg-config" >> "$GITHUB_ENV"',
  'echo "XDG_CACHE_HOME=$RUNNER_TEMP/ygb-xdg-cache" >> "$GITHUB_ENV"',
]);
const SAFE_MKDIR_LINE='mkdir -p "$RUNNER_TEMP/ygb-xdg-config" "$RUNNER_TEMP/ygb-xdg-cache"';

export function verifyFinalProductionGoWorkflows(workflows,packageManifest,workspacePackages=[]){
  assertPlainRecord(workflows,'workflow inventory');
  assertRootManifestExecutionMetadata(packageManifest);
  const workspaceManifests=verifyWorkspacePackageDescriptors(workspacePackages);
  assertExactSet(Object.keys(workflows),CANONICAL_WORKFLOWS,'workflow inventory');
  const analysis={rootPackageManifest:packageManifest,currentPackageManifest:packageManifest,workspaceManifests,scriptStack:new Set(),scriptDepth:0};
  verifyCiWorkflow(parseWorkflow(workflows['ci.yml'],'ci.yml'),analysis);
  verifyHealthWorkflow(parseWorkflow(workflows['production-health-monitor.yml'],'production-health-monitor.yml'),analysis);
}

export function discoverCanonicalWorkspacePackages(repositoryRoot,packageManifest){
  assertRootManifestExecutionMetadata(packageManifest);
  assert(typeof repositoryRoot==='string'&&path.isAbsolute(repositoryRoot),'repository root must be an absolute path');
  const rootPath=path.resolve(repositoryRoot);
  const rootStat=lstatSync(rootPath);
  assert(rootStat.isDirectory()&&!rootStat.isSymbolicLink(),'repository root must be a real directory');
  const rootRealPath=realpathSync(rootPath);
  assert(!existsSync(path.join(rootPath,'.npmrc')),'repository .npmrc is not permitted in the canonical npm execution surface');
  assert(!existsSync(path.join(rootPath,'binding.gyp')),'root binding.gyp would create an implicit npm install lifecycle');
  const workspacePackages=[];
  const seenRealPaths=new Set();
  const seenNames=new Set();
  for(const workspaceGlob of CANONICAL_WORKSPACE_GLOBS){
    const workspaceRootName=workspaceGlob.slice(0,-2);
    const workspaceRoot=path.join(rootPath,workspaceRootName);
    const workspaceRootStat=lstatSync(workspaceRoot);
    assert(workspaceRootStat.isDirectory()&&!workspaceRootStat.isSymbolicLink(),`${workspaceGlob} root must be a real directory`);
    const workspaceRootRealPath=realpathSync(workspaceRoot);
    assert(isWithin(rootRealPath,workspaceRootRealPath),`${workspaceGlob} root resolves outside the repository`);
    for(const entry of readdirSync(workspaceRoot,{withFileTypes:true}).sort((left,right)=>left.name.localeCompare(right.name))){
      const entryPath=path.join(workspaceRoot,entry.name);
      assert(!entry.isSymbolicLink(),`${workspaceGlob} contains symlink ${entry.name}`);
      if(!entry.isDirectory())continue;
      const manifestPath=path.join(entryPath,'package.json');
      if(!existsSync(manifestPath))continue;
      const manifestStat=lstatSync(manifestPath);
      assert(manifestStat.isFile()&&!manifestStat.isSymbolicLink(),`${workspaceGlob}/${entry.name}/package.json must be a real file`);
      const realPath=realpathSync(entryPath);
      assert(path.dirname(realPath)===workspaceRootRealPath&&isWithin(rootRealPath,realPath),`${workspaceGlob}/${entry.name} is nested or resolves outside the repository`);
      assert(!seenRealPaths.has(realPath),`duplicate workspace real path ${realPath}`);
      seenRealPaths.add(realPath);
      assert(!existsSync(path.join(entryPath,'.npmrc')),`${workspaceGlob}/${entry.name}/.npmrc may not alter canonical npm execution`);
      assert(!existsSync(path.join(entryPath,'binding.gyp')),`${workspaceGlob}/${entry.name} binding.gyp would create an implicit npm install lifecycle`);
      let manifest;
      try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch(error){throw new Error(`${workspaceGlob}/${entry.name}/package.json parse failed: ${error instanceof Error?error.message:String(error)}`);}
      assertWorkspaceManifestExecutionMetadata(manifest,`${workspaceRootName}/${entry.name}`);
      assert(!seenNames.has(manifest.name),`duplicate workspace package name ${manifest.name}`);
      seenNames.add(manifest.name);
      workspacePackages.push({relativePath:`${workspaceRootName}/${entry.name}`,manifest});
    }
  }
  verifyLockfileWorkspaceTopology(rootPath,workspacePackages);
  return workspacePackages;
}

function verifyCiWorkflow(workflow,analysis){
  assertExactSet(Object.keys(workflow),CI_ROOT_KEYS,'ci.yml root keys');
  assert(workflow.name==='CI','ci.yml name must be CI');
  assertExactSet(Object.keys(requireRecord(workflow.on,'ci.yml.on')),['pull_request','push'],'ci.yml triggers');
  assert(workflow.on.pull_request===null||(assertPlainRecord(workflow.on.pull_request,'ci.yml.on.pull_request'),Object.keys(workflow.on.pull_request).length===0),'ci.yml pull_request may not change execution semantics');
  const push=requireRecord(workflow.on.push,'ci.yml.on.push');
  assertExactSet(Object.keys(push),['branches'],'ci.yml push keys');
  assert(Array.isArray(push.branches)&&push.branches.length===1&&push.branches[0]==='main','ci.yml push must be restricted to main');
  assertExactPermissions(workflow.permissions,{contents:'read'},'ci.yml');
  assertExactConcurrency(workflow.concurrency,'ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',true,'ci.yml');
  assertExactSet(Object.keys(requireRecord(workflow.jobs,'ci.yml.jobs')),Object.keys(CI_JOB_POLICY),'ci.yml jobs');
  for(const [jobName,timeout] of Object.entries(CI_JOB_POLICY)){
    const runSteps=collectCiJob(requireRecord(workflow.jobs[jobName],`ci.yml.jobs.${jobName}`),jobName,timeout);
    for(const step of runSteps)analyzeShellProgram(step.run,analysis,`ci.yml job ${jobName} step ${step.index}`,'ci');
  }
}

function verifyHealthWorkflow(workflow,analysis){
  assertExactSet(Object.keys(workflow),HEALTH_ROOT_KEYS,'production-health-monitor.yml root keys');
  assert(workflow.name==='生产健康监控','production-health-monitor.yml name is not canonical');
  assertExactSet(Object.keys(requireRecord(workflow.on,'production-health-monitor.yml.on')),['schedule','workflow_dispatch'],'production-health-monitor.yml triggers');
  const schedule=requireSequence(workflow.on.schedule,'production-health-monitor.yml.on.schedule');
  assert(schedule.length===1&&requireRecord(schedule[0],'production-health-monitor.yml schedule entry').cron==='17 * * * *','production-health-monitor.yml schedule must be hourly at minute 17');
  assertExactWorkflowDispatch(workflow.on.workflow_dispatch);
  assertExactPermissions(workflow.permissions,{contents:'read',issues:'write'},'production-health-monitor.yml');
  assertExactConcurrency(workflow.concurrency,'production-health-monitor',false,'production-health-monitor.yml');
  const jobs=requireRecord(workflow.jobs,'production-health-monitor.yml.jobs');
  assertExactSet(Object.keys(jobs),['health'],'production-health-monitor.yml jobs');
  const job=requireRecord(jobs.health,'production-health-monitor.yml.jobs.health');
  assertExactSet(Object.keys(job),['runs-on','timeout-minutes','steps'],'production-health-monitor.yml health job keys');
  assert(job['runs-on']==='ubuntu-latest','production-health-monitor.yml health must use ubuntu-latest');
  assert(job['timeout-minutes']===2,'production-health-monitor.yml health timeout must be 2 minutes');
  const steps=requireSequence(job.steps,'production-health-monitor.yml.jobs.health.steps');
  assert(steps.length===2,'production-health-monitor.yml health must have exactly checkout and monitor steps');
  assertCanonicalCheckout(steps[0],'production-health-monitor.yml health checkout','actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
  assertExactSet(Object.keys(requireRecord(steps[1],'production-health-monitor.yml monitor step')),['name','env','run'],'production-health-monitor.yml monitor step keys');
  assert(steps[1].name==='检查生产 Readiness 并维护告警问题','production-health-monitor.yml monitor step name is not canonical');
  assertExactHealthEnvironment(steps[1].env);
  assert(steps[1].run==='node scripts/production-health-monitor.mjs','production-health-monitor.yml run step must be the canonical monitor entrypoint');
  analyzeShellProgram(steps[1].run,analysis,'production-health-monitor.yml canonical monitor step','health');
}

function parseWorkflow(source,name){
  assert(typeof source==='string'&&source.length>0,`${name} must be a non-empty YAML file`);
  const document=parseDocument(source,{prettyErrors:false,strict:true,uniqueKeys:true,maxAliasCount:0});
  assert(document.errors.length===0,`${name} YAML parse failed: ${document.errors.map((error)=>error.message).join('; ')}`);
  let workflow;
  try{workflow=document.toJS({maxAliasCount:0});}catch(error){throw new Error(`${name} YAML conversion failed: ${error instanceof Error?error.message:String(error)}`);}
  assertPlainRecord(workflow,`${name} document`);
  return workflow;
}

function collectCiJob(job,jobName,timeout){
  assertExactSet(Object.keys(job),['name','runs-on','timeout-minutes','steps'],`ci.yml ${jobName} job keys`);
  assert(job.name===jobName,`ci.yml ${jobName} job name is not canonical`);
  assert(job['runs-on']==='ubuntu-latest',`ci.yml ${jobName} must use ubuntu-latest`);
  assert(job['timeout-minutes']===timeout,`ci.yml ${jobName} timeout is not canonical`);
  const steps=requireSequence(job.steps,`ci.yml.jobs.${jobName}.steps`);
  assert(steps.length===6,`ci.yml ${jobName} must keep the six canonical execution steps`);
  assertCiAction(steps[0],`ci.yml.jobs.${jobName}.steps[0]`);
  assert(steps[0].name==='Checkout',`ci.yml ${jobName} checkout step name is not canonical`);
  const configure=assertCiRunStep(steps[1],jobName,1,'Configure local tool directories');
  assertExactShellLines(configure,[SAFE_MKDIR_LINE,...SAFE_ENV_LINES],`ci.yml ${jobName} runner setup`);
  assertCiAction(steps[2],`ci.yml.jobs.${jobName}.steps[2]`);
  assert(steps[2].name==='Set up Node',`ci.yml ${jobName} setup-node step name is not canonical`);
  const lifecycle=assertCiRunStep(steps[3],jobName,3,'Verify locked lifecycle provenance before install');
  assertExactShellLines(lifecycle,['node scripts/verify-dependency-lifecycle.mjs','node --test scripts/verify-dependency-lifecycle.node-test.mjs'],`ci.yml ${jobName} dependency lifecycle proof`);
  const install=assertCiRunStep(steps[4],jobName,4,'Install locked dependencies');
  const finalStep=CI_FINAL_STEPS[jobName];
  const finalRun=assertCiRunStep(steps[5],jobName,5,finalStep.name);
  assert(finalRun===finalStep.run,`ci.yml ${jobName} final command is not canonical`);
  return [{index:1,run:configure},{index:3,run:lifecycle},{index:4,run:install},{index:5,run:finalRun}];
}

function assertCiRunStep(step,jobName,index,expectedName){
  assertPlainRecord(step,`ci.yml.jobs.${jobName}.steps[${index}]`);
  assertExactSet(Object.keys(step),['name','run'],`ci.yml.jobs.${jobName}.steps[${index}] run keys`);
  assert(step.name===expectedName,`ci.yml ${jobName} step ${index} name is not canonical`);
  assert(typeof step.run==='string'&&step.run.trim().length>0,`ci.yml.jobs.${jobName}.steps[${index}].run must be a fixed non-empty string`);
  return step.run;
}

function assertExactShellLines(source,expected,label){
  const lines=source.split(/\r?\n/u).map((line)=>line.trim()).filter(Boolean);
  assert(JSON.stringify(lines)===JSON.stringify(expected),`${label} commands are not canonical or are out of order`);
}

function assertCiAction(step,label){
  assertExactSet(Object.keys(step),['name','uses','with'],`${label} action keys`);
  if(step.uses==='actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09')return assertCanonicalCheckout(step,label,'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09');
  assert(step.uses==='actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',`${label}.uses is not an approved SHA-pinned action`);
  assertExactSet(Object.keys(requireRecord(step.with,`${label}.with`)),['node-version','cache','cache-dependency-path'],`${label}.with keys`);
  assert(step.with['node-version']==='24.19.0'&&step.with.cache==='npm'&&step.with['cache-dependency-path']==='package-lock.json',`${label} setup-node configuration is not canonical`);
}

function assertCanonicalCheckout(step,label,expectedUses){
  assertPlainRecord(step,label);
  assertExactSet(Object.keys(step),['name','uses','with'],`${label} checkout keys`);
  assert(step.uses===expectedUses,`${label}.uses is not the canonical checkout action`);
  assertExactSet(Object.keys(requireRecord(step.with,`${label}.with`)),['fetch-depth','persist-credentials'],`${label}.with keys`);
  assert(step.with['fetch-depth']===1&&step.with['persist-credentials']===false,`${label} checkout configuration is not canonical`);
}

function assertExactWorkflowDispatch(value){
  const dispatch=requireRecord(value,'production-health-monitor.yml.workflow_dispatch');
  assertExactSet(Object.keys(dispatch),['inputs'],'production-health-monitor.yml workflow_dispatch keys');
  const inputs=requireRecord(dispatch.inputs,'production-health-monitor.yml workflow_dispatch inputs');
  assertExactSet(Object.keys(inputs),['simulation'],'production-health-monitor.yml workflow_dispatch input names');
  const simulation=requireRecord(inputs.simulation,'production-health-monitor.yml workflow_dispatch simulation');
  assertExactSet(Object.keys(simulation),['description','required','default','type','options'],'production-health-monitor.yml workflow_dispatch simulation keys');
  assert(simulation.description==='验收模式'&&simulation.required===true&&simulation.default==='probe'&&simulation.type==='choice','production-health-monitor.yml workflow_dispatch simulation is not canonical');
  assert(Array.isArray(simulation.options)&&JSON.stringify(simulation.options)===JSON.stringify(['probe','failure','recovery']),'production-health-monitor.yml workflow_dispatch options are not canonical');
}

function assertExactHealthEnvironment(value){
  const env=requireRecord(value,'production-health-monitor.yml monitor env');
  assertExactSet(Object.keys(env),['GH_TOKEN','GITHUB_REPOSITORY','YGB_HEALTH_SIMULATION','YGB_PRODUCTION_HEALTH_URL'],'production-health-monitor.yml monitor env keys');
  assert(env.GH_TOKEN==='${{ github.token }}'&&env.GITHUB_REPOSITORY==='${{ github.repository }}'&&env.YGB_HEALTH_SIMULATION==="${{ inputs.simulation || 'probe' }}"&&env.YGB_PRODUCTION_HEALTH_URL==='https://app.yueguangbai.net/ready','production-health-monitor.yml monitor env is not canonical');
}

function assertExactConcurrency(value,group,cancel,label){
  const concurrency=requireRecord(value,`${label} concurrency`);
  assertExactSet(Object.keys(concurrency),['group','cancel-in-progress'],`${label} concurrency keys`);
  assert(concurrency.group===group&&concurrency['cancel-in-progress']===cancel,`${label} concurrency is not canonical`);
}

function analyzeShellProgram(program,analysis,label,mode){
  assert(!/\\\r?\n/u.test(program),`${label} shell line continuations are not permitted`);
  for(const [lineNumber,rawLine] of program.split(/\r?\n/u).entries()){
    const line=rawLine.trim();
    if(line.length===0||line.startsWith('#'))continue;
    analyzeShellLine(line,analysis,`${label}:${lineNumber+1}`,mode);
  }
}

function analyzeShellLine(line,analysis,label,mode){
  assert(!line.includes('`')&&!line.includes('$(')&&!line.includes('<(')&&!line.includes('>('),`${label} contains an unparseable shell expansion`);
  if(line.includes('$'))assert(SAFE_ENV_LINES.has(line)||line===SAFE_MKDIR_LINE,`${label} contains dynamic shell expansion outside canonical runner setup`);
  let tokens;
  try{tokens=parseShell(line);}catch(error){throw new Error(`${label} shell parse failed: ${error instanceof Error?error.message:String(error)}`);}
  assert(tokens.length>0,`${label} shell command is empty`);
  const commands=splitShellCommands(tokens,label);
  for(const command of commands)analyzeCommand(command,analysis,label,mode,line);
}

function splitShellCommands(tokens,label){
  const commands=[];let current=[];
  for(const token of tokens){
    if(typeof token==='string'){current.push(token);continue;}
    assertPlainRecord(token,`${label} shell token`);
    assert(typeof token.op==='string',`${label} shell token is not executable-safe`);
    if(token.op==='&&'){
      assert(current.length>0,`${label} has an empty shell command segment`);
      commands.push(current);current=[];continue;
    }
    assert(token.op==='>>',`${label} uses unsupported shell operator ${token.op}`);
    current.push(token);
  }
  assert(current.length>0,`${label} has an empty shell command segment`);
  commands.push(current);
  return commands;
}

function analyzeCommand(tokens,analysis,label,mode,rawLine){
  const words=[];
  for(const token of tokens){
    if(typeof token==='string'){words.push(token);continue;}
    assert(token.op==='>>'&&SAFE_ENV_LINES.has(rawLine),`${label} may redirect only a canonical environment declaration`);
  }
  const command=words[0];
  assert(typeof command==='string'&&command.length>0,`${label} command name is dynamic or missing`);
  assert(!/^[A-Za-z_][A-Za-z0-9_]*=/u.test(command),`${label} shell variable command prefixes are not permitted`);
  assert(!FORBIDDEN_SHELL_EXECUTORS.has(command),`${label} uses an indirect or non-canonical shell executor`);
  if(SHELL_EXECUTORS.has(command))return analyzeShellExecutor(words,analysis,label,mode);
  if(command==='mkdir')return assert(rawLine===SAFE_MKDIR_LINE,`${label} mkdir is not canonical runner setup`);
  if(command==='echo')return assert(SAFE_ENV_LINES.has(rawLine),`${label} echo is not canonical runner setup`);
  if(command==='node')return analyzeNode(words,label,mode);
  if(command==='npm')return analyzeNpm(words,analysis,label,mode);
  if(command==='npx')return analyzeNpx(words,label);
  if(command==='wrangler')return analyzeWrangler(words.slice(1),label);
  if(command==='openspec')return assert(JSON.stringify(words)===JSON.stringify(['openspec','validate','--all','--strict']),`${label} openspec command is not canonical`);
  if(command==='tsc')return analyzeTsc(words,label);
  if(command==='vitest')return analyzeVitest(words,label);
  if(command==='vite')return assert(JSON.stringify(words)===JSON.stringify(['vite','build']),`${label} vite command is not canonical`);
  throw new Error(`${label} command ${command} is not in the canonical workflow allowlist`);
}

function analyzeShellExecutor(words,analysis,label,mode){
  assert(words.length===3&&words[1]==='-c'&&words[2].length>0,`${label} shell executor must use one fixed -c argument`);
  assert(!words[2].includes('$')&&!words[2].includes('`'),`${label} shell executor argument must be static`);
  analyzeShellProgram(words[2],analysis,`${label} shell -c`,mode);
}

function analyzeNode(words,label,mode){
  assert(!words.includes('-e')&&!words.includes('--eval')&&!words.includes('--require')&&!words.includes('-r'),`${label} Node evaluators and preload hooks are not permitted`);
  const testIndex=words.indexOf('--test');
  const argumentsAfterNode=words.slice(1).filter((word)=>word!=='--test');
  assert(argumentsAfterNode.length>0,`${label} node command is missing an approved script`);
  if(mode==='health')return assert(testIndex===-1&&argumentsAfterNode.length===1&&argumentsAfterNode[0]==='scripts/production-health-monitor.mjs',`${label} health monitor entrypoint is not canonical`);
  if(testIndex>=0){
    assert(argumentsAfterNode.every((script)=>CI_NODE_TEST_COMMANDS.has(script)),`${label} node test script is not in the CI allowlist`);
    return;
  }
  const [script,...scriptArguments]=argumentsAfterNode;
  assert(CI_NODE_COMMANDS.has(script),`${label} node script ${script} is not in the CI allowlist`);
  if(script==='scripts/preflight-cloudflare-release.mjs'){
    assert(JSON.stringify(scriptArguments)===JSON.stringify(['--environment','staging'])||JSON.stringify(scriptArguments)===JSON.stringify(['--environment','production']),`${label} preflight environment is not canonical`);
  }else if(script==='scripts/preflight-rakuten-tiktok-jp-adapters.mjs'){
    assert(JSON.stringify(scriptArguments)===JSON.stringify(['--inspect']),`${label} marketplace preflight arguments are not canonical`);
  }else assert(scriptArguments.length===0,`${label} node arguments are not canonical`);
}

function analyzeTsc(words,label){
  assert(words.length===4&&words[1]==='-p'&&['tsconfig.json','tsconfig.test.json'].includes(words[2])&&words[3]==='--noEmit',`${label} tsc command is not canonical`);
}

function analyzeVitest(words,label){
  assert(words.length>=2&&words[1]==='run'&&words.slice(2).every((value)=>typeof value==='string'&&!value.startsWith('-')&&!value.includes('$')),`${label} vitest command is not canonical`);
}

function analyzeNpm(words,analysis,label,mode){
  let index=1;let allWorkspaces=false;
  while(NPM_GLOBAL_FLAGS.has(words[index])){if(words[index]==='--workspaces'||words[index]==='-ws')allWorkspaces=true;index+=1;}
  const subcommand=words[index];
  if(subcommand==='ci'){
    assert(index===1&&words.length===2,`${label} npm ci is not canonical and may not branch with --ignore-scripts or workspace selectors`);
    assertNpmCiExecutionSurface(analysis,label);
    return;
  }
  if(subcommand==='test'){
    assert(!allWorkspaces&&words.length===index+1,`${label} npm test arguments are not canonical`);
    return analyzeNpmScript('test',analysis,`${label} npm test`,mode);
  }
  if(subcommand==='run'||subcommand==='run-script'){
    const scriptName=words[index+1];
    for(const value of words.slice(index+2)){
      assert(NPM_GLOBAL_FLAGS.has(value),`${label} npm run script is missing, dynamic, or has unapproved arguments`);
      if(value==='--workspaces'||value==='-ws')allWorkspaces=true;
    }
    assert(typeof scriptName==='string'&&!scriptName.startsWith('-'),`${label} npm run script is missing or dynamic`);
    return allWorkspaces?analyzeWorkspaceScripts(scriptName,analysis,`${label} npm run ${scriptName}`,mode):analyzeNpmScript(scriptName,analysis,`${label} npm run ${scriptName}`,mode);
  }
  if(subcommand==='exec')return analyzeNpmExec(words.slice(index+1),label);
  throw new Error(`${label} npm subcommand ${String(subcommand)} is not in the canonical workflow allowlist`);
}

function analyzeNpmExec(args,label){
  const executable=unwrapNpmExec(args,label);
  if(executable[0]==='wrangler')return analyzeWrangler(executable.slice(1),label);
  if(executable[0]==='vitest')return analyzeVitest(executable,label);
  throw new Error(`${label} npm exec may invoke only canonical vitest or wrangler`);
}

function unwrapNpmExec(args,label){
  let values=[...args];
  const delimiter=values.indexOf('--');
  if(delimiter>=0){
    const before=values.slice(0,delimiter);const after=values.slice(delimiter+1);
    assert(before.length<=1,`${label} npm exec options are not permitted`);
    values=before.length===1?[before[0],...after]:after;
  }
  assert(values.length>0&&typeof values[0]==='string'&&!values[0].startsWith('-'),`${label} npm exec executable is missing`);
  return values;
}

function analyzeNpx(words,label){
  let index=1;
  while(['--yes','-y','--no-install'].includes(words[index]))index+=1;
  assert(words[index]==='wrangler',`${label} npx may invoke only wrangler`);
  analyzeWrangler(words.slice(index+1),label);
}

function analyzeWorkspaceScripts(scriptName,analysis,label,mode){
  const matches=analysis.workspaceManifests.filter((manifest)=>typeof manifest.scripts[scriptName]==='string');
  assert(matches.length>0,`${label} workspace script is missing from every workspace`);
  for(const manifest of matches)analyzeNpmScript(scriptName,analysis,`${label} workspace ${packageName(manifest)}`,mode,manifest);
}

function analyzeNpmScript(scriptName,analysis,label,mode,packageManifest=analysis.currentPackageManifest){
  assert(analysis.scriptDepth<MAX_NPM_SCRIPT_DEPTH,`${label} npm script recursion exceeds ${MAX_NPM_SCRIPT_DEPTH}`);
  const identity=`${packageName(packageManifest)}:${scriptName}`;
  assert(!analysis.scriptStack.has(identity),`${label} npm script cycle detected: ${[...analysis.scriptStack,identity].join(' -> ')}`);
  const source=packageManifest.scripts[scriptName];
  assert(typeof source==='string'&&source.trim().length>0,`${label} npm script is missing or not a fixed string`);
  const next={...analysis,currentPackageManifest:packageManifest,scriptStack:new Set([...analysis.scriptStack,identity]),scriptDepth:analysis.scriptDepth+1};
  for(const hookName of [`pre${scriptName}`,scriptName,`post${scriptName}`]){
    const hookSource=packageManifest.scripts[hookName];
    if(hookName!==scriptName&&hookSource===undefined)continue;
    assert(typeof hookSource==='string'&&hookSource.trim().length>0,`${label} npm hook ${hookName} is not a fixed non-empty string`);
    analyzeShellProgram(hookSource,next,`${packageName(packageManifest)} package.json scripts.${hookName}`,mode);
  }
}

function analyzeWrangler(args,label){
  assert(args.length>0&&args.every((value)=>typeof value==='string'&&!value.includes('$')),`${label} wrangler arguments must be fixed`);
  const [family,...rest]=args;
  if(family==='deploy'){
    assert(rest.includes('--dry-run')&&!rest.includes('--local')&&!rest.includes('--remote'),`${label} Wrangler deploy is allowed only with explicit --dry-run`);
    assertAllowedWranglerDeployArguments(rest,label);
    return;
  }
  if(family==='d1'){
    assert(rest[0]==='migrations'&&rest[1]==='apply'&&typeof rest[2]==='string'&&!rest[2].startsWith('-')&&rest.length===4&&rest[3]==='--local',`${label} only local D1 migrations apply is allowed`);
    return;
  }
  if(family==='types')return assert(rest.length===0,`${label} Wrangler types arguments are not canonical`);
  throw new Error(`${label} Wrangler command family ${family} is not in the local-only allowlist`);
}

function assertAllowedWranglerDeployArguments(args,label){
  for(let index=0;index<args.length;index+=1){
    const value=args[index];
    if(value==='--dry-run')continue;
    if(value==='--config'){assert(args[index+1]==='wrangler.local.jsonc',`${label} Wrangler deploy config is not local canonical config`);index+=1;continue;}
    if(value==='--outdir'){assert(args[index+1]==='dist',`${label} Wrangler deploy outdir is not canonical`);index+=1;continue;}
    throw new Error(`${label} Wrangler deploy argument ${value} is not in the dry-run allowlist`);
  }
}

function assertRootManifestExecutionMetadata(manifest){
  assertPlainRecord(manifest,'root package manifest');
  assertPlainRecord(manifest.scripts,'root package manifest scripts');
  assert(typeof manifest.name==='string'&&manifest.name.length>0,'root package manifest name must be fixed');
  assert(JSON.stringify(manifest.workspaces)===JSON.stringify(CANONICAL_WORKSPACE_GLOBS),'root package manifest workspaces must exactly equal apps/*, packages/*, tools/*');
  assertPlainRecord(manifest.engines,'root package manifest engines');
  assertExactSet(Object.keys(manifest.engines),['node'],'root package manifest engines');
  assert(manifest.engines.node==='>=24 <25','root package manifest Node engine must remain >=24 <25');
  assertManifestExecutionMetadata(manifest,'root package manifest');
}

function assertWorkspaceManifestExecutionMetadata(manifest,relativePath){
  assertPlainRecord(manifest,`${relativePath} package manifest`);
  assertPlainRecord(manifest.scripts,`${relativePath} package manifest scripts`);
  assert(typeof manifest.name==='string'&&manifest.name.length>0,`${relativePath} package name must be fixed`);
  assert(manifest.workspaces===undefined,`${relativePath} may not define nested workspaces`);
  assertManifestExecutionMetadata(manifest,`${relativePath} package manifest`);
}

function assertManifestExecutionMetadata(manifest,label){
  for(const lifecycle of NPM_CI_LIFECYCLE_SCRIPTS){
    assert(manifest.scripts[lifecycle]===undefined,`${label} scripts.${lifecycle} would execute implicitly during npm ci`);
  }
  assert(manifest.packageManager===undefined,`${label} packageManager must remain absent for the canonical npm runner`);
  assert(manifest.devEngines===undefined,`${label} devEngines must remain absent for the canonical npm runner`);
  assert(manifest.config===undefined,`${label} config must remain absent from the CI execution environment`);
  assert(manifest.installConfig===undefined,`${label} installConfig must remain absent from the CI install graph`);
  assert(manifest.bin===undefined,`${label} bin must remain absent so workspace packages cannot shadow approved tools`);
  assert(manifest.directories===undefined||manifest.directories.bin===undefined,`${label} directories.bin must remain absent so workspace packages cannot shadow approved tools`);
  assert(manifest.engines===undefined||manifest.engines.npm===undefined,`${label} engines.npm must remain absent; setup-node supplies the canonical npm`);
}

function verifyWorkspacePackageDescriptors(workspacePackages){
  assert(Array.isArray(workspacePackages),'workspace packages must be a topology-verified array');
  const manifests=[];const paths=new Set();const names=new Set();
  for(const workspacePackage of workspacePackages){
    assertPlainRecord(workspacePackage,'workspace package descriptor');
    assertExactSet(Object.keys(workspacePackage),['relativePath','manifest'],'workspace package descriptor keys');
    const {relativePath,manifest}=workspacePackage;
    assert(typeof relativePath==='string'&&isCanonicalWorkspaceRelativePath(relativePath),`workspace path ${String(relativePath)} is outside the canonical one-level globs`);
    assert(!paths.has(relativePath),`duplicate workspace path ${relativePath}`);paths.add(relativePath);
    assertWorkspaceManifestExecutionMetadata(manifest,relativePath);
    assert(!names.has(manifest.name),`duplicate workspace package name ${manifest.name}`);names.add(manifest.name);
    manifests.push(manifest);
  }
  return manifests;
}

function assertNpmCiExecutionSurface(analysis,label){
  assertRootManifestExecutionMetadata(analysis.rootPackageManifest);
  for(const manifest of analysis.workspaceManifests)assertWorkspaceManifestExecutionMetadata(manifest,`workspace ${packageName(manifest)}`);
  assert(analysis.workspaceManifests.length>0,`${label} npm ci requires a verified non-empty canonical workspace topology`);
}

function verifyLockfileWorkspaceTopology(rootPath,workspacePackages){
  const lockfilePath=path.join(rootPath,'package-lock.json');
  assert(existsSync(lockfilePath),'canonical npm ci requires package-lock.json');
  const lockfileStat=lstatSync(lockfilePath);
  assert(lockfileStat.isFile()&&!lockfileStat.isSymbolicLink(),'package-lock.json must be a real file');
  let lockfile;
  try{lockfile=JSON.parse(readFileSync(lockfilePath,'utf8'));}catch(error){throw new Error(`package-lock.json parse failed: ${error instanceof Error?error.message:String(error)}`);}
  assert(lockfile.lockfileVersion===3,'package-lock.json lockfileVersion must remain 3 for canonical npm ci semantics');
  const lockRoot=requireRecord(requireRecord(lockfile.packages,'package-lock.json packages')[''],'package-lock.json root package');
  assert(JSON.stringify(lockRoot.workspaces)===JSON.stringify(CANONICAL_WORKSPACE_GLOBS),'package-lock.json root workspaces must match the canonical globs');
  const discoveredPaths=workspacePackages.map(({relativePath})=>relativePath).sort();
  const lockedPaths=Object.keys(lockfile.packages).filter(isCanonicalWorkspaceRelativePath).sort();
  assert(JSON.stringify(lockedPaths)===JSON.stringify(discoveredPaths),'package-lock.json workspace package paths must exactly match filesystem discovery');
}

function isCanonicalWorkspaceRelativePath(value){
  return typeof value==='string'&&/^(apps|packages|tools)\/[^/]+$/u.test(value)&&!value.includes('..')&&!path.isAbsolute(value);
}

function isWithin(rootPath,candidatePath){
  const relative=path.relative(rootPath,candidatePath);
  return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));
}

function packageName(manifest){return typeof manifest.name==='string'&&manifest.name.length>0?manifest.name:'root';}
function assertExactPermissions(actual,expected,name){
  assertPlainRecord(actual,`${name} permissions`);
  assertExactSet(Object.keys(actual),Object.keys(expected),`${name} permissions`);
  for(const [key,value] of Object.entries(expected))assert(actual[key]===value,`${name} permission ${key} must be ${value}`);
}
function assertExactSet(actual,expected,label){assert(JSON.stringify([...actual].sort())===JSON.stringify([...expected].sort()),`${label} must exactly equal ${expected.join(', ')}`);}
function requireRecord(value,label){assertPlainRecord(value,label);return value;}
function requireSequence(value,label){assert(Array.isArray(value),`${label} must be a YAML sequence`);return value;}
function assertPlainRecord(value,label){assert(value!==null&&typeof value==='object'&&!Array.isArray(value),`${label} must be a YAML mapping`);}
