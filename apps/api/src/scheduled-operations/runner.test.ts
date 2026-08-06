import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { runScheduledOperations } from './runner';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe('scheduled operations', () => {
  it('records a bounded successful cleanup run and keeps extension jobs disabled', async () => {
    database = createMigratedTestDatabase();
    const runs = await runScheduledOperations(database, { now: 2_000_000_000, only: 'staff_auth_cleanup' });
    expect(runs[0]).toMatchObject({ job_name: 'staff_auth_cleanup', outcome: 'SUCCEEDED', processed_count: 0 });
    const extension = await runScheduledOperations(database, { now: 2_000_000_100, only: 'feishu_sync' });
    expect(extension[0]?.outcome).toBe('DISABLED');
  });

  it('uses an expiring lease so duplicate scheduler delivery is skipped then recoverable', async () => {
    database = createMigratedTestDatabase();
    database.exec("INSERT INTO scheduled_job_states (job_name,lease_token,lease_expires_at,updated_at) VALUES ('staff_auth_cleanup','other',2000,1)");
    const blocked = await runScheduledOperations(database, { now: 1_999, only: 'staff_auth_cleanup' });
    expect(blocked[0]?.outcome).toBe('SKIPPED');
    const recovered = await runScheduledOperations(database, { now: 2_000, only: 'staff_auth_cleanup' });
    expect(recovered[0]?.outcome).toBe('SUCCEEDED');
  });

  it('uses bounded exponential outbox retry without exposing payload in run facts', async () => {
    database = createMigratedTestDatabase();
    database.exec("INSERT INTO integration_outbox (id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES ('outbox-scheduled-1','scheduled:outbox:1','TEST','TEST','1','{\"secret\":\"never-log\"}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','PENDING',1,NULL,NULL,0,NULL,1,1,NULL)");
    const run = await runScheduledOperations(database, { now: 2_000, only: 'outbox_delivery' });
    expect(run[0]).toMatchObject({ outcome: 'SUCCEEDED', failed_count: 1, backlog_count: 1 });
    const state = await database.prepare("SELECT last_failure_category FROM scheduled_job_states WHERE job_name='outbox_delivery'").first<{last_failure_category:string}>();
    expect(state?.last_failure_category).toBeNull();
    const row = await database.prepare("SELECT status,last_error,available_at FROM integration_outbox WHERE id='outbox-scheduled-1'").first<{status:string;last_error:string;available_at:number}>();
    expect(row).toEqual({ status: 'FAILED', last_error: 'adapter_unavailable', available_at: 62_000 });
  });
});
