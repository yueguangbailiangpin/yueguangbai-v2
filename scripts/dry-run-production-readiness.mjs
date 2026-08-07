import { runAnonymousCapacityDryRun } from '../packages/testkit/src/production-readiness-file-reconciliation.ts';

const report=runAnonymousCapacityDryRun();
console.log(JSON.stringify({
  mode:'LOCAL_ANONYMOUS_NO_NETWORK',
  ...report,
  real_credentials:0,
  production_resources_touched:0,
  r2_deletes:0,
  production_go:'BLOCKED_PENDING_OWNER_ACTIONS',
},null,2));
if(report.status!=='PASS')process.exitCode=1;
