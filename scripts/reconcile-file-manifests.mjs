import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFileAuthorityEvidence, reconcileFileManifests } from '../packages/testkit/src/production-readiness-file-reconciliation.ts';

const args=parseArgs(process.argv.slice(2));
const database=new DatabaseSync(path.resolve(required(args,'database')),{readOnly:true});
try{
  const report=reconcileFileManifests({
    authority:readFileAuthorityEvidence(database),
    r2Manifest:readManifest(required(args,'r2-manifest')),
    driveManifest:readManifest(required(args,'drive-manifest')),
  });
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='PASS')process.exitCode=1;
}finally{database.close();}

function readManifest(file){const parsed=JSON.parse(readFileSync(path.resolve(file),'utf8'));if(!Array.isArray(parsed))throw new Error('manifest_must_be_array');return parsed;}
function parseArgs(values){const result=new Map();for(let index=0;index<values.length;index+=1){const value=values[index];if(!value?.startsWith('--'))throw new Error('invalid_argument');const key=value.slice(2);const next=values[index+1];if(!next||next.startsWith('--'))throw new Error(`missing_value:${key}`);result.set(key,next);index+=1;}return result;}
function required(values,key){const value=values.get(key);if(!value)throw new Error(`missing_argument:${key}`);return value;}
