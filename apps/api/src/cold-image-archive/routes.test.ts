import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { registerColdImageArchiveRoutes } from './routes';
import type { AppEnv } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { seedConfirmedColdArchiveOrder } from '../../test-support/cold-archive-fixture';
import { Hono } from 'hono';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

function ownerActor(overrides: Partial<AssignmentStaffAuthorization> = {}): AssignmentStaffAuthorization {
  return {
    staffId: 'routes-owner',
    displayName: '路由测试负责人',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(['owner']),
    permissions: new Set(['SCHEDULED_OPERATIONS_RUN']),
    memberTeamIds: [],
    leaderTeamIds: [],
    ...overrides,
  };
}

function app(actor: AssignmentStaffAuthorization | null): Hono<AppEnv> {
  const instance = new Hono<AppEnv>();
  instance.use('*', async (context, next) => {
    context.set('requestId', 'test-request');
    context.set('errorLogged', false);
    if (actor) context.set('staffAuthorization', actor);
    await next();
  });
  registerColdImageArchiveRoutes(instance);
  return instance;
}

let bundleCounter = 0;

/** Seeds one ORDER bundle in its initial ONLINE state (the insert guard only
 *  ever accepts ONLINE — ARCHIVED is reachable solely through the pipeline). */
async function seedBundle(db: SqliteDatabase): Promise<string> {
  bundleCounter += 1;
  const order = await seedConfirmedColdArchiveOrder(db, `routes-${bundleCounter}`);
  const id = `archive-bundle-${crypto.randomUUID()}`;
  await db.prepare(
    `INSERT INTO archive_bundles(id,bundle_type,ref_id,formal_order_id,bundle_version,is_current,state,
     eligibility_at,created_at,updated_at)
     VALUES(?,'ORDER',?,?,1,1,'ONLINE',1000,1000,1000)`,
  ).bind(id, order.formalOrderId, order.formalOrderId).run();
  return id;
}

describe('stage 5 archive routes permission gates', () => {
  it('requires an owner session with SCHEDULED_OPERATIONS_RUN for every archive route', async () => {
    database = createMigratedTestDatabase();
    const bundleId = await seedBundle(database);
    const cases: { actor: AssignmentStaffAuthorization | null; expected: number }[] = [
      { actor: null, expected: 403 },
      { actor: { ...ownerActor(), staffStatus: 'DISABLED' } as never, expected: 403 },
      { actor: ownerActor({ roles: new Set(['buyer_refund' as const]) }), expected: 403 },
      { actor: ownerActor({ permissions: new Set(['ORDER_VIEW' as const]) }), expected: 403 },
    ];
    for (const testCase of cases) {
      const response = await app(testCase.actor).request(
        `/api/staff/operations/archive/bundles/${bundleId}/restore`,
        { method: 'POST', headers: { 'Idempotency-Key': 'routes-key-0001' } },
        { DB: database },
      );
      expect(response.status, `actor=${JSON.stringify(testCase.actor?.staffId)}`).toBe(testCase.expected);
    }
  });

  it('rejects restore for a bundle that is not in an archived-family state', async () => {
    database = createMigratedTestDatabase();
    const bundleId = await seedBundle(database);
    const response = await app(ownerActor()).request(
      `/api/staff/operations/archive/bundles/${bundleId}/restore`,
      { method: 'POST', headers: { 'Idempotency-Key': 'routes-key-0002' } },
      { DB: database },
    );
    expect(response.status).toBe(409);
  });

  it('keeps buyer and seller domains away from archive operations entirely', async () => {
    database = createMigratedTestDatabase();
    const bundleId = await seedBundle(database);
    // No staff session at all — the staff middleware owns these paths; the
    // buyer/seller route trees never register anything under
    // /api/staff/operations/archive.
    for (const [method, path] of [
      ['POST', `/api/buyer-portal/operations/archive/bundles/${bundleId}/restore`],
      ['POST', `/api/seller-portal/operations/archive/bundles/${bundleId}/restore`],
    ] as const) {
      const response = await app(null).request(path, { method }, { DB: database });
      expect(response.status).toBe(404);
    }
  });

  it('lists bundles with cursor pagination for the owner and exposes metrics', async () => {
    database = createMigratedTestDatabase();
    await seedBundle(database);
    await seedBundle(database);
    const list = await app(ownerActor()).request('/api/staff/operations/archive/bundles?limit=1', undefined, { DB: database });
    expect(list.status).toBe(200);
    const body = await list.json() as { data?: { bundles?: unknown[]; next_cursor?: string | null } };
    expect(body.data!.bundles).toHaveLength(1);
    expect(typeof body.data!.next_cursor).toBe('string');
    const metrics = await app(ownerActor()).request('/api/staff/operations/archive/metrics', undefined, { DB: database });
    expect(metrics.status).toBe(200);
    const metricsBody = await metrics.json() as { data?: { metrics?: Record<string, unknown> } };
    expect(metricsBody.data!.metrics).toMatchObject({
      eligible_backlog_bundles: expect.any(Number),
      jobs_dead_lettered: expect.any(Number),
    });
  });
});
