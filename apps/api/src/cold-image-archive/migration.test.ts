import { afterEach,describe,expect,it } from 'vitest';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});
describe('Migration 0032 cold archive facts',()=>{
  it('installs guarded state, manifest, recovery and indexes at schema 32',async()=>{
    database=createMigratedTestDatabase();
    expect(await database.prepare('SELECT schema_version FROM app_schema_state WHERE singleton_id=1').first())
      .toEqual({schema_version:32});
    const objects=await database.prepare(`SELECT type,name FROM sqlite_schema WHERE name IN (
      'order_archive_closures','drive_archive_controls','file_drive_archives','file_drive_archive_manifests',
      'file_drive_archive_events','file_drive_rehydrations','idx_file_drive_archives_due',
      'trg_file_drive_archive_transition_guard','trg_drive_archive_controls_update_guard') ORDER BY name`).all();
    expect(objects.results).toHaveLength(9);
    await expect(database.prepare(`UPDATE drive_archive_controls SET copy_enabled=1,version=version+2,
      updated_at=updated_at+1 WHERE singleton_id=1`).run()).rejects.toThrow('drive_archive_controls_invalid_update');
    await expect(database.prepare('DELETE FROM drive_archive_controls WHERE singleton_id=1').run())
      .rejects.toThrow('drive_archive_controls_are_required');
  });
});
