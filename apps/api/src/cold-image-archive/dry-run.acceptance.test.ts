import { describe,expect,it } from 'vitest';
import type { DriveArchiveAdapter,ObjectStorageAdapter,SqlDatabase } from '@ygb/contracts';
import { createMigratedTestDatabase } from '@ygb/testkit';
import { runScheduledOperations } from '../scheduled-operations/runner';

describe('Google Drive archive reproducible runner dry-run acceptance',()=>{
  it('makes no adapter call and writes no archive business fact',async()=>{
    const database=createMigratedTestDatabase();
    const calls={driveUpload:0,driveRead:0,r2Put:0,r2Head:0,r2Read:0,r2Delete:0};
    const drive:DriveArchiveAdapter={upload:async()=>{calls.driveUpload+=1;throw new Error('unexpected_drive_upload');},
      readFile:async()=>{calls.driveRead+=1;throw new Error('unexpected_drive_read');}};
    const storage:ObjectStorageAdapter={putObject:async()=>{calls.r2Put+=1;throw new Error('unexpected_r2_put');},
      headObject:async()=>{calls.r2Head+=1;throw new Error('unexpected_r2_head');},
      readPrefix:async()=>{throw new Error('unexpected_r2_prefix');},readObject:async()=>{calls.r2Read+=1;throw new Error('unexpected_r2_read');},
      deleteObject:async()=>{calls.r2Delete+=1;throw new Error('unexpected_r2_delete');}};
    try{
      const runs=await runScheduledOperations(database,{enabled:true,only:'drive_archive',dryRun:true,storage,driveAdapter:drive,
        driveArchiveEnabled:true,driveArchiveCopyEnabled:true,driveArchiveProxyReadEnabled:true,
        driveArchiveR2DeleteEnabled:true,now:Date.UTC(2027,1,2)});
      expect(runs).toHaveLength(1);expect(runs[0]).toMatchObject({processed_count:0,succeeded_count:0,failed_count:0});
      expect(calls).toEqual({driveUpload:0,driveRead:0,r2Put:0,r2Head:0,r2Read:0,r2Delete:0});
      expect(await facts(database)).toEqual({archives:0,manifests:0,reconciliations:0,events:0,rehydrations:0});
      expect(await database.prepare(`SELECT COUNT(*) AS count FROM scheduled_job_runs`).first()).toEqual({count:1});
    }finally{database.close();}
  });
});
async function facts(database:SqlDatabase){return database.prepare(`SELECT
  (SELECT COUNT(*) FROM file_drive_archives) AS archives,
  (SELECT COUNT(*) FROM file_drive_archive_manifests) AS manifests,
  (SELECT COUNT(*) FROM file_drive_archive_reconciliations) AS reconciliations,
  (SELECT COUNT(*) FROM file_drive_archive_events) AS events,
  (SELECT COUNT(*) FROM file_drive_rehydrations) AS rehydrations`).first();}
