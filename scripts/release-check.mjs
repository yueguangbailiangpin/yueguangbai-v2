import { execFileSync,spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { invariant,repositoryRoot as root } from './verifier-utils.mjs';

export const RELEASE_COMMANDS=Object.freeze([
  'verify:openspec:strict',
  'audit:dependencies',
  'check',
  'check:production-readiness',
  'check:drive-archive',
  'check:staff-mcp-production',
  'verify:cloudflare-release',
  'dry-run:cloudflare-release',
  'verify:final-production-go:local',
  'test:wave14a:browser',
]);

export function candidateProvenance(git=runGit){
  const status=git(['status','--porcelain=v1','--untracked-files=all']);invariant(status==='','release candidate worktree must be clean');
  const commit=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
  invariant(/^[0-9a-f]{40}$/u.test(commit),'release candidate commit is invalid');invariant(/^[0-9a-f]{40}$/u.test(tree),'release candidate tree is invalid');return{commit,tree};
}
export function runReleaseCommands(commands=RELEASE_COMMANDS,runner=runNpmScript){for(const command of commands){const result=runner(command);invariant(result.status===0&&!result.error,`release sub-gate failed: npm run ${command}`);}}
export function commandEnvironment(command,environment=process.env){if(command!=='test:wave14a:browser')return environment;return{...environment,PLAYWRIGHT_PORT:environment['RELEASE_BROWSER_PORT']??'4188'};}
export function runReleaseCheck(){
  const candidate=candidateProvenance();
  console.log(JSON.stringify({status:'RUNNING',candidate,commands:RELEASE_COMMANDS,production_network_policy:'NO_MOONWHITE_PRODUCTION_READINESS_PROBE'},null,2));
  runReleaseCommands();
  console.log(JSON.stringify({status:'PASS',candidate,local_release_evidence:'COMPLETE',external_evidence:'UNVERIFIED',production_go:'NO_GO',moonwhite_production_readiness_probe_calls:0,note:'dependency/security tooling may contact its public package/advisory providers; this gate does not read Moonwhite production /ready',next_production_gate:'node scripts/probe-production-readiness.mjs'},null,2));
}
function runGit(args){return execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();}
function runNpmScript(command){return spawnSync('npm',['run',command],{cwd:root,stdio:'inherit',env:commandEnvironment(command)});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runReleaseCheck();
