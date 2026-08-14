import { afterEach,describe,expect,it } from 'vitest';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});
describe('Migration 0032 cold archive facts',()=>{
  it('preserves guarded schema 32 archive facts beneath current schema 70',async()=>{
    database=createMigratedTestDatabase();
    expect(await database.prepare('SELECT schema_version FROM app_schema_state WHERE singleton_id=1').first())
      .toEqual({schema_version:70});
    const objects=await database.prepare(`SELECT type,name FROM sqlite_schema WHERE name IN (
      'order_archive_closures','drive_archive_controls','file_drive_archives','file_drive_archive_manifests',
      'file_drive_archive_events','file_drive_rehydrations','idx_file_drive_archives_due',
      'trg_file_drive_archive_transition_guard','trg_drive_archive_controls_update_guard',
      'trg_order_archive_closure_reclose_source_guard','trg_file_drive_rehydration_insert_guard') ORDER BY name`).all();
    expect(objects.results).toHaveLength(11);
    const closureColumns=await database.prepare(`PRAGMA table_info(order_archive_closures)`).all<{name:string}>();
    expect(closureColumns.results.map((column)=>column.name)).toEqual(expect.arrayContaining([
      'closed_by_staff_id','close_reason','close_idempotency_key','reopened_by_staff_id','reopen_reason','reopen_idempotency_key']));
    const recoveryColumns=await database.prepare(`PRAGMA table_info(file_drive_rehydrations)`).all<{name:string}>();
    expect(recoveryColumns.results.map((column)=>column.name)).toEqual(expect.arrayContaining([
      'expected_archive_version','request_hash','attempt_count','version','updated_at']));
    await expect(database.prepare(`UPDATE drive_archive_controls SET copy_enabled=1,version=version+2,
      updated_at=updated_at+1 WHERE singleton_id=1`).run()).rejects.toThrow('drive_archive_controls_invalid_update');
    await expect(database.prepare('DELETE FROM drive_archive_controls WHERE singleton_id=1').run())
      .rejects.toThrow('drive_archive_controls_are_required');
  });
});
