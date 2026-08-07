import path from 'node:path';
import { readBackupKey, restoreEncryptedD1Backup } from '../packages/testkit/src/production-readiness-backup.ts';

const args=parseArgs(process.argv.slice(2));
const result=restoreEncryptedD1Backup({
  bundlePath:path.resolve(required(args,'bundle')),
  restorePath:path.resolve(required(args,'restore-database')),
  key:readBackupKey(path.resolve(required(args,'key-file'))),
  expectedSchemaVersion:numberArg(args,'expected-schema',34),
});
console.log(JSON.stringify(result.report,null,2));
if(result.report.status!=='PASS')process.exitCode=1;

function parseArgs(values){const result=new Map();for(let index=0;index<values.length;index+=1){const value=values[index];if(!value?.startsWith('--'))throw new Error('invalid_argument');const key=value.slice(2);const next=values[index+1];if(!next||next.startsWith('--'))throw new Error(`missing_value:${key}`);result.set(key,next);index+=1;}return result;}
function required(values,key){const value=values.get(key);if(!value)throw new Error(`missing_argument:${key}`);return value;}
function numberArg(values,key,fallback){const raw=values.get(key);const value=raw===undefined?fallback:Number(raw);if(!Number.isSafeInteger(value)||value<1)throw new Error(`invalid_argument:${key}`);return value;}
