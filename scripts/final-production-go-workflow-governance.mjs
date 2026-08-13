import { parseDocument } from 'yaml';
import { parse as parseShell } from 'shell-quote';
import { invariant as assert } from './verifier-utils.mjs';

const CANONICAL_WORKFLOWS=Object.freeze(['ci.yml','production-health-monitor.yml']);
const MAX_NPM_SCRIPT_DEPTH=12;
const SHELL_DELIMITERS=new Set(['&&','||',';','|']);
const SAFE_REDIRECTION='>>';
const INERT_DYNAMIC_COMMANDS=new Set(['echo','mkdir']);
const REMOTE_WRANGLER_FAMILIES=new Set(['queues','dispatch-namespace','dispatch','vectorize','hyperdrive','containers']);

export function verifyFinalProductionGoWorkflows(workflows,packageManifest,workspaceManifests=[]){
  assertPlainRecord(workflows,'workflow inventory');
  assertPlainRecord(packageManifest,'package manifest');
  assertPlainRecord(packageManifest.scripts,'package manifest scripts');
  assert(Array.isArray(workspaceManifests),'workspace manifests must be an array');
  for(const manifest of workspaceManifests){assertPlainRecord(manifest,'workspace package manifest');assertPlainRecord(manifest.scripts,'workspace package manifest scripts');}
  const names=Object.keys(workflows).sort();
  assert(JSON.stringify(names)===JSON.stringify(CANONICAL_WORKFLOWS),'workflow inventory must exactly equal ci.yml and production-health-monitor.yml');
  const analysis={rootPackageManifest:packageManifest,currentPackageManifest:packageManifest,workspaceManifests,scriptStack:new Set(),scriptDepth:0};
  verifyCiWorkflow(parseWorkflow(workflows['ci.yml'],'ci.yml'),analysis);
  verifyHealthWorkflow(parseWorkflow(workflows['production-health-monitor.yml'],'production-health-monitor.yml'),analysis);
}

function verifyCiWorkflow(workflow,analysis){
  assertExactSet(Object.keys(requireRecord(workflow.on,'ci.yml.on')),['pull_request','push'],'ci.yml triggers');
  const push=requireRecord(workflow.on.push,'ci.yml.on.push');
  assert(Array.isArray(push.branches)&&push.branches.length===1&&push.branches[0]==='main','ci.yml push must be restricted to main');
  assertExactPermissions(workflow.permissions,{contents:'read'},'ci.yml');
  const runSteps=collectRunSteps(workflow,'ci.yml',['actions/checkout','actions/setup-node']);
  assert(runSteps.length>0,'ci.yml must contain audited run steps');
  for(const step of runSteps)analyzeShellProgram(step.run,analysis,`ci.yml job ${step.job} step ${step.index}`);
}

function verifyHealthWorkflow(workflow,analysis){
  assertExactSet(Object.keys(requireRecord(workflow.on,'production-health-monitor.yml.on')),['schedule','workflow_dispatch'],'production-health-monitor.yml triggers');
  assertExactPermissions(workflow.permissions,{contents:'read',issues:'write'},'production-health-monitor.yml');
  const schedule=requireSequence(workflow.on.schedule,'production-health-monitor.yml.on.schedule');
  assert(schedule.length===1&&requireRecord(schedule[0],'production-health-monitor.yml schedule entry').cron==='17 * * * *','production-health-monitor.yml schedule must be hourly at minute 17');
  const runSteps=collectRunSteps(workflow,'production-health-monitor.yml',['actions/checkout']);
  assert(runSteps.length===1,'production-health-monitor.yml may contain exactly one run step');
  assert(runSteps[0].run.trim()==='node scripts/production-health-monitor.mjs','production-health-monitor.yml run step must be the canonical monitor entrypoint');
  analyzeShellProgram(runSteps[0].run,analysis,'production-health-monitor.yml canonical monitor step');
}

function parseWorkflow(source,name){
  assert(typeof source==='string'&&source.length>0,`${name} must be a non-empty YAML file`);
  const document=parseDocument(source,{prettyErrors:false,strict:true,uniqueKeys:true,maxAliasCount:0});
  assert(document.errors.length===0,`${name} YAML parse failed: ${document.errors.map((error)=>error.message).join('; ')}`);
  let workflow;
  try{workflow=document.toJS({maxAliasCount:0});}catch(error){throw new Error(`${name} YAML conversion failed: ${error instanceof Error?error.message:String(error)}`);}
  assertPlainRecord(workflow,`${name} document`);
  requireRecord(workflow.on,`${name}.on`);
  requireRecord(workflow.permissions,`${name}.permissions`);
  requireRecord(workflow.jobs,`${name}.jobs`);
  return workflow;
}

function collectRunSteps(workflow,name,allowedActions){
  const runSteps=[];
  for(const [jobName,job] of Object.entries(workflow.jobs)){
    assertPlainRecord(job,`${name}.jobs.${jobName}`);
    assert(job.uses===undefined,`${name}.jobs.${jobName} reusable workflow calls are not permitted`);
    const steps=requireSequence(job.steps,`${name}.jobs.${jobName}.steps`);
    for(const [index,step] of steps.entries()){
      assertPlainRecord(step,`${name}.jobs.${jobName}.steps[${index}]`);
      const hasRun=step.run!==undefined,hasUses=step.uses!==undefined;
      assert(hasRun!==hasUses,`${name}.jobs.${jobName}.steps[${index}] must contain exactly one of run or uses`);
      if(hasUses){assertAllowedAction(step.uses,allowedActions,`${name}.jobs.${jobName}.steps[${index}]`);continue;}
      assert(typeof step.run==='string'&&step.run.trim().length>0,`${name}.jobs.${jobName}.steps[${index}].run must be a fixed non-empty string`);
      assert(step.shell===undefined||step.shell==='bash',`${name}.jobs.${jobName}.steps[${index}] must use the default bash shell`);
      runSteps.push({job:jobName,index,run:step.run});
    }
  }
  return runSteps;
}

function assertAllowedAction(value,allowedActions,label){
  assert(typeof value==='string',`${label}.uses must be a fixed action reference`);
  const match=value.match(/^([^@]+)@([0-9a-f]{40})$/u);
  assert(match&&allowedActions.includes(match[1]),`${label}.uses is not an approved SHA-pinned action`);
}

function analyzeShellProgram(program,analysis,label){
  assert(!/\\\r?\n/u.test(program),`${label} shell line continuations are not permitted`);
  for(const [lineNumber,rawLine] of program.split(/\r?\n/u).entries()){
    const line=rawLine.trim();
    if(line.length===0||line.startsWith('#'))continue;
    analyzeShellLine(line,analysis,`${label}:${lineNumber+1}`);
  }
}

function analyzeShellLine(line,analysis,label){
  assert(!line.includes('`')&&!line.includes('$(')&&!line.includes('<(')&&!line.includes('>('),`${label} contains an unparseable shell expansion`);
  let tokens;
  try{tokens=parseShell(line);}catch(error){throw new Error(`${label} shell parse failed: ${error instanceof Error?error.message:String(error)}`);}
  assert(tokens.length>0,`${label} shell command is empty`);
  const commands=splitShellCommands(tokens,label);
  const dynamic=line.includes('$');
  if(dynamic&&commands.some((command)=>!INERT_DYNAMIC_COMMANDS.has(commandName(command)))){
    throw new Error(`${label} contains dynamic shell expansion outside inert directory/environment setup`);
  }
  for(const command of commands)analyzeCommand(command,analysis,label);
}

function splitShellCommands(tokens,label){
  const commands=[];let current=[];
  for(const token of tokens){
    if(typeof token==='string'){current.push(token);continue;}
    assertPlainRecord(token,`${label} shell token`);
    assert(typeof token.op==='string',`${label} shell token is not executable-safe`);
    if(SHELL_DELIMITERS.has(token.op)){
      assert(current.length>0,`${label} has an empty shell command segment`);
      commands.push(current);current=[];continue;
    }
    assert(token.op===SAFE_REDIRECTION,`${label} uses unsupported shell operator ${token.op}`);
    current.push(token);
  }
  assert(current.length>0,`${label} has an empty shell command segment`);
  commands.push(current);
  return commands;
}

function analyzeCommand(tokens,analysis,label){
  const words=[];
  for(const token of tokens){
    if(typeof token==='string'){words.push(token);continue;}
    assert(token.op===SAFE_REDIRECTION&&commandName(tokens)==='echo',`${label} may redirect only a static echo command to GITHUB_ENV`);
  }
  const command=commandName(words);
  assert(command.length>0,`${label} command name is dynamic or missing`);
  assert(!/^[A-Za-z_][A-Za-z0-9_]*=/u.test(command),`${label} shell variable command prefixes are not permitted`);
  if(['eval','.','source','env','command','xargs','sudo'].includes(command))throw new Error(`${label} uses an indirect shell executor`);
  if(['sh','bash','zsh','/bin/sh','/bin/bash'].includes(command))return analyzeShellExecutor(words,analysis,label);
  if(command==='node')assert(!words.includes('-e')&&!words.includes('--eval'),`${label} Node inline evaluators are not permitted`);
  if(command==='npm')return analyzeNpm(words,analysis,label);
  if(command==='npx')return analyzeNpx(words,analysis,label);
  if(command==='wrangler')return analyzeWrangler(words.slice(1),label);
  if(['curl','wget','gh'].includes(command))throw new Error(`${label} uses an unapproved remote command executor`);
}

function analyzeShellExecutor(words,analysis,label){
  assert(words.length===3&&words[1]==='-c'&&words[2].length>0,`${label} shell executor must use one fixed -c argument`);
  assert(!words[2].includes('$')&&!words[2].includes('`'),`${label} shell executor argument must be static`);
  analyzeShellProgram(words[2],analysis,`${label} shell -c`);
}

function analyzeNpm(words,analysis,label){
  const subcommand=words[1];
  if(subcommand==='run'||subcommand==='run-script'){
    let index=2;
    while(['--if-present','--silent','-s'].includes(words[index]))index+=1;
    const scriptName=words[index];
    assert(typeof scriptName==='string'&&!scriptName.startsWith('-'),`${label} npm run script is missing or dynamic`);
    const scriptArguments=words.slice(index+1);
    if(scriptArguments.includes('--workspaces')||scriptArguments.includes('-ws'))return analyzeWorkspaceScripts(scriptName,analysis,`${label} npm run ${scriptName}`);
    assert(!scriptArguments.includes('--workspace')&&!scriptArguments.includes('-w'),`${label} targeted npm workspace execution is not supported by governance`);
    return analyzeNpmScript(scriptName,analysis,`${label} npm run ${scriptName}`);
  }
  if(['test','start'].includes(subcommand))return analyzeNpmScript(subcommand,analysis,`${label} npm ${subcommand}`);
  if(subcommand==='exec')return analyzeNpmExec(words.slice(2),analysis,label);
  assert(!['publish','version'].includes(subcommand),`${label} npm ${subcommand} is not permitted`);
}

function analyzeNpmExec(args,analysis,label){
  const executable=unwrapNpmExec(args,label);
  if(executable[0]==='wrangler')return analyzeWrangler(executable.slice(1),label);
  assert(executable[0]==='vitest',`${label} npm exec may invoke only vitest or wrangler`);
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

function analyzeNpx(words,analysis,label){
  let index=1;
  while(['--yes','-y','--no-install'].includes(words[index]))index+=1;
  assert(words[index]==='wrangler',`${label} npx may invoke only wrangler`);
  analyzeWrangler(words.slice(index+1),label);
}

function analyzeWorkspaceScripts(scriptName,analysis,label){
  const matches=analysis.workspaceManifests.filter((manifest)=>typeof manifest.scripts[scriptName]==='string');
  assert(matches.length>0,`${label} workspace script is missing from every workspace`);
  for(const manifest of matches)analyzeNpmScript(scriptName,analysis,`${label} workspace ${packageName(manifest)}`,manifest);
}

function analyzeNpmScript(scriptName,analysis,label,packageManifest=analysis.currentPackageManifest){
  assert(analysis.scriptDepth<MAX_NPM_SCRIPT_DEPTH,`${label} npm script recursion exceeds ${MAX_NPM_SCRIPT_DEPTH}`);
  const identity=`${packageName(packageManifest)}:${scriptName}`;
  assert(!analysis.scriptStack.has(identity),`${label} npm script cycle detected: ${[...analysis.scriptStack,identity].join(' -> ')}`);
  const source=packageManifest.scripts[scriptName];
  assert(typeof source==='string'&&source.trim().length>0,`${label} npm script is missing or not a fixed string`);
  const next={...analysis,currentPackageManifest:packageManifest,scriptStack:new Set([...analysis.scriptStack,identity]),scriptDepth:analysis.scriptDepth+1};
  analyzeShellProgram(source,next,`${packageName(packageManifest)} package.json scripts.${scriptName}`);
}

function analyzeWrangler(args,label){
  assert(args.length>0,`${label} wrangler subcommand is missing`);
  assert(!args.some((value)=>value.includes('$')),`${label} wrangler arguments must be static`);
  assert(!args.includes('--remote'),`${label} contains explicit remote Wrangler capability`);
  const [family,operation,detail]=args;
  if(family==='deploy'){
    assert(args.includes('--dry-run')&&!args.includes('--local'),`${label} Wrangler deploy is allowed only with supported --dry-run`);
    return;
  }
  if(family==='d1')return analyzeWranglerD1(operation,detail,args,label);
  if(family==='r2')return rejectWranglerMutation(operation,detail,['bucket','object','notification'],label,'R2');
  if(family==='kv')return rejectWranglerMutation(operation,detail,['namespace','key','bulk'],label,'KV');
  if(family==='secret')return rejectWranglerMutation(operation,detail,['put','delete','bulk'],label,'Secret');
  if(REMOTE_WRANGLER_FAMILIES.has(family))throw new Error(`${label} contains remote Wrangler ${family} capability`);
  assert(!args.includes('deploy'),`${label} contains a non-canonical Wrangler deploy capability`);
}

function analyzeWranglerD1(operation,detail,args,label){
  const mutation=(operation==='migrations'&&['apply','create'].includes(detail))||['execute','create','delete'].includes(operation);
  if(!mutation)return;
  assert(args.includes('--local'),`${label} D1 mutation defaults to remote and requires supported --local`);
  assert(!args.includes('--dry-run'),`${label} D1 mutation cannot use unsupported --dry-run as a safety bypass`);
  assert(operation==='migrations'&&detail==='apply'||operation==='execute',`${label} D1 mutation is not supported by local governance`);
}

function rejectWranglerMutation(operation,detail,mutatingFamilies,label,service){
  if(mutatingFamilies.includes(operation)||mutatingFamilies.includes(detail)||['create','delete','put','bulk','update','insert'].includes(operation)||['create','delete','put','bulk','update','insert'].includes(detail)){
    throw new Error(`${label} contains remote Wrangler ${service} mutation capability`);
  }
}

function commandName(tokens){return tokens.find((token)=>typeof token==='string'&&token.length>0)||'';}
function packageName(manifest){return typeof manifest.name==='string'&&manifest.name.length>0?manifest.name:'root';}

function assertExactPermissions(actual,expected,name){
  assertPlainRecord(actual,`${name} permissions`);
  assert(JSON.stringify(Object.keys(actual).sort())===JSON.stringify(Object.keys(expected).sort()),`${name} permissions must be minimal`);
  for(const [key,value] of Object.entries(expected))assert(actual[key]===value,`${name} permission ${key} must be ${value}`);
}

function assertExactSet(actual,expected,label){assert(JSON.stringify([...actual].sort())===JSON.stringify([...expected].sort()),`${label} must exactly equal ${expected.join(', ')}`);}
function requireRecord(value,label){assertPlainRecord(value,label);return value;}
function requireSequence(value,label){assert(Array.isArray(value),`${label} must be a YAML sequence`);return value;}
function assertPlainRecord(value,label){assert(value!==null&&typeof value==='object'&&!Array.isArray(value),`${label} must be a YAML mapping`);}
