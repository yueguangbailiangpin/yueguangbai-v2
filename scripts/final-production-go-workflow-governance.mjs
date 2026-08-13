import { invariant as assert } from './verifier-utils.mjs';

const CANONICAL_WORKFLOWS=Object.freeze(['ci.yml','production-health-monitor.yml']);

export function verifyFinalProductionGoWorkflows(workflows){
  const names=Object.keys(workflows).sort();
  assert(JSON.stringify(names)===JSON.stringify(CANONICAL_WORKFLOWS),'workflow inventory must exactly equal ci.yml and production-health-monitor.yml');
  verifyCiWorkflow(workflows['ci.yml']);
  verifyHealthWorkflow(workflows['production-health-monitor.yml']);
}

function verifyCiWorkflow(source){
  const document=parseWorkflow(source,'ci.yml');
  assertExactSet(document.triggers,['pull_request','push'],'ci.yml triggers');
  assert(document.pushBranches.length===1&&document.pushBranches[0]==='main','ci.yml push must be restricted to main');
  assertExactPermissions(document.permissions,{contents:'read'},'ci.yml');
  assertNoDangerousWorkflowCapabilities(document,'ci.yml');
}

function verifyHealthWorkflow(source){
  const document=parseWorkflow(source,'production-health-monitor.yml');
  assertExactSet(document.triggers,['schedule','workflow_dispatch'],'production-health-monitor.yml triggers');
  assert(document.crons.length===1&&document.crons[0]==='17 * * * *','production-health-monitor.yml schedule must be hourly at minute 17');
  assertExactPermissions(document.permissions,{contents:'read',issues:'write'},'production-health-monitor.yml');
  assertNoDangerousWorkflowCapabilities(document,'production-health-monitor.yml');
  assert(document.runBlocks.some((run)=>run.trim()==='node scripts/production-health-monitor.mjs'),'production-health-monitor.yml must run only the canonical monitor entrypoint');
}

function parseWorkflow(source,name){
  assert(typeof source==='string'&&source.length>0,`${name} must be a non-empty YAML file`);
  const lines=source.split(/\r?\n/u).map((raw,index)=>parseLine(raw,index+1,name));
  const mappings=lines.filter((line)=>line.mapping);
  const on=findTopLevelMapping(mappings,'on',name);
  const permissions=findTopLevelMapping(mappings,'permissions',name);
  const triggers=directChildMappings(mappings,on).map((line)=>line.key);
  const push=directChildMappings(mappings,on).find((line)=>line.key==='push');
  const pushBranches=push?listUnder(lines,findDirectChild(mappings,push,'branches',name),name):[];
  const schedule=directChildMappings(mappings,on).find((line)=>line.key==='schedule');
  const crons=schedule?listKeyValuesUnder(lines,schedule,'cron',name):[];
  const permissionEntries=directChildMappings(mappings,permissions);
  const permissionValues=Object.fromEntries(permissionEntries.map((line)=>[line.key,unquote(line.value)]));
  const runBlocks=extractRunBlocks(lines);
  return{lines,mappings,triggers,pushBranches,crons,permissions:permissionValues,runBlocks};
}

function parseLine(raw,lineNumber,name){
  assert(!raw.includes('\t'),`${name}:${lineNumber} tabs are not permitted in audited YAML`);
  const content=stripComment(raw).trimEnd();
  const indent=content.length-content.trimStart().length;
  const trimmed=content.trimStart();
  const mapping=trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/u);
  return{raw,content,indent,trimmed,lineNumber,mapping:Boolean(mapping),key:mapping?.[1],value:mapping?.[2]??''};
}

function stripComment(raw){
  let quote='';
  for(let index=0;index<raw.length;index+=1){
    const character=raw[index];
    if((character==='"'||character==="'")&&raw[index-1]!=="\\")quote=quote===character?'':(quote||character);
    if(character==='#'&&!quote)return raw.slice(0,index);
  }
  return raw;
}

function findTopLevelMapping(mappings,key,name){
  const matches=mappings.filter((line)=>line.indent===0&&line.key===key);
  assert(matches.length===1,`${name} must declare exactly one top-level ${key}`);
  return matches[0];
}

function directChildMappings(mappings,parent){
  return mappings.filter((line)=>line.indent===parent.indent+2&&line.lineNumber>parent.lineNumber&&isBeforeNextPeer(mappings,line,parent));
}

function findDirectChild(mappings,parent,key,name){
  const matches=directChildMappings(mappings,parent).filter((line)=>line.key===key);
  assert(matches.length===1,`${name}:${parent.lineNumber} must declare exactly one ${key}`);
  return matches[0];
}

function isBeforeNextPeer(mappings,line,parent){
  return !mappings.some((candidate)=>candidate.lineNumber>parent.lineNumber&&candidate.lineNumber<line.lineNumber&&candidate.indent===parent.indent);
}

function listUnder(lines,parent,name){
  assert(parent,`${name} required list is missing`);
  return lines.filter((line)=>line.lineNumber>parent.lineNumber&&line.indent===parent.indent+2&&/^-[ ]+[^\s]+$/u.test(line.trimmed)&&isBeforeSibling(lines,line,parent))
    .map((line)=>line.trimmed.replace(/^-[ ]+/u,''));
}

function listKeyValuesUnder(lines,parent,key,name){
  assert(parent,`${name} required list is missing`);
  return lines.filter((line)=>line.lineNumber>parent.lineNumber&&line.indent===parent.indent+2&&new RegExp(`^-[ ]+${key}:\\s*(.+)$`,'u').test(line.trimmed)&&isBeforeSibling(lines,line,parent))
    .map((line)=>unquote(line.trimmed.match(new RegExp(`^-[ ]+${key}:\\s*(.+)$`,'u'))[1]));
}

function isBeforeSibling(lines,line,parent){
  return !lines.some((candidate)=>candidate.lineNumber>parent.lineNumber&&candidate.lineNumber<line.lineNumber&&candidate.indent===parent.indent&&candidate.trimmed.length>0&&!candidate.trimmed.startsWith('-'));
}

function extractRunBlocks(lines){
  const runs=[];
  for(const line of lines.filter((candidate)=>candidate.mapping&&candidate.key==='run')){
    if(line.value==='|'||line.value==='|-'){
      runs.push(lines.filter((candidate)=>candidate.lineNumber>line.lineNumber&&candidate.indent>line.indent&&isWithinIndentedBlock(lines,candidate,line)).map((candidate)=>candidate.trimmed).join('\n'));
    }else runs.push(unquote(line.value));
  }
  return runs;
}

function isWithinIndentedBlock(lines,line,parent){
  return !lines.some((candidate)=>candidate.lineNumber>parent.lineNumber&&candidate.lineNumber<line.lineNumber&&candidate.indent<=parent.indent&&candidate.trimmed.length>0);
}

function assertExactSet(actual,expected,label){
  assert(JSON.stringify([...actual].sort())===JSON.stringify([...expected].sort()),`${label} must exactly equal ${expected.join(', ')}`);
}

function assertExactPermissions(actual,expected,name){
  assert(JSON.stringify(Object.keys(actual).sort())===JSON.stringify(Object.keys(expected).sort()),`${name} permissions must be minimal`);
  for(const [key,value] of Object.entries(expected))assert(actual[key]===value,`${name} permission ${key} must be ${value}`);
}

function assertNoDangerousWorkflowCapabilities(document,name){
  const dangerousTriggers=new Set(['pull_request_target','deployment','deployment_status','repository_dispatch','workflow_call']);
  for(const line of document.mappings)assert(!dangerousTriggers.has(line.key),`${name}:${line.lineNumber} has forbidden trigger ${line.key}`);
  for(const run of document.runBlocks)assertSafeRunBlock(run,name);
}

function assertSafeRunBlock(run,name){
  for(const command of run.split(/&&|;|\|/u).map((value)=>value.trim()).filter(Boolean)){
    const tokens=command.toLowerCase().match(/[a-z0-9_./:@=-]+/gu)??[];
    const wrangler=tokens.indexOf('wrangler');
    if(wrangler>=0){
      const subcommand=tokens[wrangler+1];
      const dryRun=tokens.includes('--dry-run');
      assert(!(subcommand==='deploy'&&!dryRun),`${name} contains a deploy command without --dry-run`);
      assert(!tokens.includes('--remote'),`${name} contains a remote Wrangler mutation capability`);
      assert(!(['secret','r2','kv','queues','vectorize','d1'].includes(subcommand)&&['put','delete','create','apply','execute'].includes(tokens[wrangler+2])),`${name} contains a Wrangler mutation command`);
    }
    const npm=tokens.indexOf('npm');
    assert(!(npm>=0&&tokens[npm+1]==='run'&&/^deploy(?::|$)/u.test(tokens[npm+2]??'')),`${name} contains an npm deploy command`);
  }
}

function unquote(value){return value.replace(/^['"]|['"]$/gu,'');}
