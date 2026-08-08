import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AppBindings } from '../app';
import worker from '../worker';
import { MockFeishuWorkbenchAdapter } from './mock-adapter';

const FEISHU_ONLY_DISABLED_JOBS = [
  'reservation_expiry',
  'instruction_expiry',
  'outbox_delivery',
  'file_orphan_cleanup',
  'staff_auth_cleanup',
  'drive_archive',
].join(',');

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Feishu-only scheduled activation', () => {
  it.each([
    ['exact false', 'false'],
    ['missing', undefined],
  ] as const)('runs only feishu_sync and never reads the acquisition secret when maintenance is %s', async (_label, acquisitionEnabled) => {
    database = createMigratedTestDatabase();
    let acquisitionSecretReads = 0;
    const env: AppBindings = {
      DB: database,
      SCHEDULED_OPERATIONS_ENABLED: 'true',
      SCHEDULED_OPERATIONS_DISABLED_JOBS: FEISHU_ONLY_DISABLED_JOBS,
      ...(acquisitionEnabled === undefined ? {} : {
        ACQUISITION_MAINTENANCE_ENABLED: acquisitionEnabled,
      }),
      FEISHU_WORKBENCH_SYNC_ENABLED: 'true',
      FEISHU_WORKBENCH_WEB_ORIGIN: 'https://workbench.example.invalid',
      FEISHU_WORKBENCH_TENANT_KEY: 'tenant-anonymous',
      FEISHU_WORKBENCH_ADAPTER: new MockFeishuWorkbenchAdapter(),
      OPERATIONAL_ALERT_MODE: 'disabled',
    };
    Object.defineProperty(env, 'CUSTOMER_SECURITY_TOKEN_SECRET', {
      enumerable: true,
      get() {
        acquisitionSecretReads += 1;
        throw new Error('acquisition_secret_must_not_be_read');
      },
    });
    const completions: Promise<unknown>[] = [];

    await worker.scheduled({ scheduledTime: 1_750_000_000_000 }, env, {
      waitUntil(promise) { completions.push(promise); },
    });
    expect(completions).toHaveLength(1);
    await Promise.all(completions);

    expect(acquisitionSecretReads).toBe(0);
    expect((await database.prepare(`SELECT job_name,outcome FROM scheduled_job_runs
      ORDER BY job_name`).all()).results).toEqual([
      { job_name: 'feishu_sync', outcome: 'SUCCEEDED' },
    ]);
    expect((await database.prepare(`SELECT COUNT(*) AS count
      FROM acquisition_maintenance_runs`).first<{ count: number }>())?.count).toBe(0);
  });
});
