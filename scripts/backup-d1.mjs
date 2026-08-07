import path from 'node:path';
import { createEncryptedD1Backup, readBackupKey } from '../packages/testkit/src/production-readiness-backup.ts';

const args=parseArgs(process.argv.slice(2));
const database=required(args,'database');
const outputDirectory=required(args,'output-dir');
const keyPath=required(args,'key-file');
const result=await createEncryptedD1Backup({
  databasePath:path.resolve(database),
  outputDirectory:path.resolve(outputDirectory),
  key:readBackupKey(path.resolve(keyPath)),
  releaseCommitSha:required(args,'release-commit-sha'),
  expectedSchemaVersion:numberArg(args,'expected-schema',34),
  anonymousFixture:args.has('anonymous-fixture'),
});
console.log(JSON.stringify({
  status:'BACKUP_CREATED_NOT_YET_RESTORED',
  schema_version:result.manifest.schema_version,
  release_commit_sha:result.manifest.release_commit_sha,
  bundle:path.basename(result.bundlePath),
  attestation:path.basename(result.attestationPath),
  encrypted_bundle_sha256:result.attestation.encrypted_bundle_sha256,
  manifest_sha256:result.attestation.manifest_sha256,
  restore_required:true,
},null,2));

function parseArgs(values){const result=new Map();for(let index=0;index<values.length;index+=1){const value=values[index];if(!value?.startsWith('--'))throw new Error('invalid_argument');const key=value.slice(2);if(key==='anonymous-fixture'){result.set(key,'true');continue;}const next=values[index+1];if(!next||next.startsWith('--'))throw new Error(`missing_value:${key}`);result.set(key,next);index+=1;}return result;}
function required(values,key){const value=values.get(key);if(!value)throw new Error(`missing_argument:${key}`);return value;}
function numberArg(values,key,fallback){const raw=values.get(key);const value=raw===undefined?fallback:Number(raw);if(!Number.isSafeInteger(value)||value<1)throw new Error(`invalid_argument:${key}`);return value;}
