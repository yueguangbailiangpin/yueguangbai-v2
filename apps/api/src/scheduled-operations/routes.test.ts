import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AppBindings, AppEnv } from '../app';
import { registerScheduledOperationRoutes } from './routes';
import { ingestScheduledOperationalSignal } from './signals';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('scheduled operation Staff HTTP contract', () => {
  it('returns only Staff-safe capability scopes and enforces AUDIT_VIEW', async () => {
    database = createMigratedTestDatabase();
    await ingestScheduledOperationalSignal(database, {
      observation_id: 'a'.repeat(64),
      signal_type: 'login_anomaly',
      summary_code: 'LOGIN_ANOMALY_DETECTED',
      job_name: null,
      observation_state: 'BREACH',
      observed_at: 1000,
      count_value: 5,
    });
    const app = createTestApp();
    const bindings: AppBindings = { DB: database };
    const denied = await app.request('http://local/api/staff/operations/health', {}, bindings);
    expect(denied.status).toBe(403);
    expect(
      (
        await app.request(
          'http://local/api/staff/operations/health',
          { headers: { 'X-Test-Permission': 'deny' } },
          bindings,
        )
      ).status,
    ).toBe(403);
    const response = await app.request(
      'http://local/api/staff/operations/health',
      { headers: { 'X-Test-Permission': 'audit' } },
      bindings,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        jobs: Array<Record<string, unknown>>;
        alerts: Array<Record<string, unknown>>;
        time_basis: string;
        display_timezone: string;
      };
    };
    expect(body.data.jobs).toHaveLength(4);
    expect(
      Object.fromEntries(body.data.jobs.map((j) => [j['job_name'], j['capability_scope']])),
    ).toEqual({
      reservation_expiry: 'ALL_ENABLED_MARKETPLACES',
      instruction_expiry: 'LEGACY_JP_ONLY',
      file_orphan_cleanup: 'ALL_ENABLED_MARKETPLACES',
      drive_archive: 'HARD_DISABLED',
    });
    expect(
      body.data.jobs
        .filter((job) => job['capability_scope'] === 'HARD_DISABLED')
        .every((job) => job['enabled'] === false),
    ).toBe(true);
    const enabledResponse = await app.request(
      'http://local/api/staff/operations/health',
      { headers: { 'X-Test-Permission': 'audit' } },
      bindings,
    );
    const enabledBody = (await enabledResponse.json()) as {
      data: { jobs: Array<Record<string, unknown>> };
    };
    expect(
      enabledBody.data.jobs.find((job) => job['job_name'] === 'reservation_expiry'),
    ).toMatchObject({ enabled: true, capability_scope: 'ALL_ENABLED_MARKETPLACES' });
    expect(body.data.alerts).toEqual([
      expect.objectContaining({
        signal_type: 'login_anomaly',
        category: 'auth',
        severity: 'CRITICAL',
        summary_code: 'LOGIN_ANOMALY_DETECTED',
        status: 'OPEN',
        time_basis: 'UTC_MS',
        display_timezone: 'Asia/Shanghai',
      }),
    ]);
    expect([body.data.time_basis, body.data.display_timezone]).toEqual(['UTC_MS', 'Asia/Shanghai']);
    expect(JSON.stringify(body)).not.toMatch(/object_key|payload_json|token|wechat|last_error/u);
  });

  it('protects alert ACK with the run permission and HTTP idempotency contract', async () => {
    database = createMigratedTestDatabase();
    await ingestScheduledOperationalSignal(database, {
      observation_id: 'b'.repeat(64),
      signal_type: 'login_anomaly',
      summary_code: 'LOGIN_ANOMALY_DETECTED',
      job_name: null,
      observation_state: 'BREACH',
      observed_at: 1000,
      count_value: 5,
    });
    const app = createTestApp();
    const bindings: AppBindings = { DB: database };
    const command = {
      signal_type: 'login_anomaly',
      summary_code: 'LOGIN_ANOMALY_DETECTED',
      job_name: null,
      incident_version: 1,
    };
    const base = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'http-alert-ack-key' },
      body: JSON.stringify(command),
    };
    expect(
      (
        await app.request(
          'http://local/api/staff/operations/alerts/ack',
          { ...base, headers: { ...base.headers, 'X-Test-Permission': 'audit' } },
          bindings,
        )
      ).status,
    ).toBe(403);
    const authorized = { ...base, headers: { ...base.headers, 'X-Test-Permission': 'run' } };
    const first = await app.request(
      'http://local/api/staff/operations/alerts/ack',
      authorized,
      bindings,
    );
    const replay = await app.request(
      'http://local/api/staff/operations/alerts/ack',
      authorized,
      bindings,
    );
    expect([first.status, replay.status]).toEqual([200, 200]);
    expect(await first.json()).toEqual(await replay.json());
    const conflict = await app.request(
      'http://local/api/staff/operations/alerts/ack',
      { ...authorized, body: JSON.stringify({ ...command, incident_version: 2 }) },
      bindings,
    );
    expect(conflict.status).toBe(409);
    const already = await app.request(
      'http://local/api/staff/operations/alerts/ack',
      {
        ...authorized,
        headers: { ...authorized.headers, 'Idempotency-Key': 'http-alert-state-key' },
      },
      bindings,
    );
    expect(already.status).toBe(409);
    const unknown = await app.request(
      'http://local/api/staff/operations/alerts/ack',
      {
        ...authorized,
        headers: { ...authorized.headers, 'Idempotency-Key': 'http-alert-unknown-key' },
        body: JSON.stringify({ ...command, payload_json: 'secret' }),
      },
      bindings,
    );
    expect(unknown.status).toBe(400);
    expect(
      JSON.stringify(
        (
          await database
            .prepare(
              "SELECT next_state_json,metadata_json FROM audit_events WHERE event_type='SCHEDULED_OPERATION_ALERT_ACKNOWLEDGED'",
            )
            .all()
        ).results,
      ),
    ).not.toMatch(/secret|payload|token|wechat|object_key|error/u);
  });

  it('enforces permission and strict idempotent manual-run HTTP commands', async () => {
    database = createMigratedTestDatabase();
    seedExpirableReservation(database, 'http-manual');
    const bindings: AppBindings = {
      DB: database,
      SCHEDULED_OPERATIONS_ENABLED: 'true',
    };
    const app = createTestApp();
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'http-manual-key' },
      body: JSON.stringify({ reason_code: 'OPERATOR_RETRY' }),
    };
    expect(
      (
        await app.request(
          'http://local/api/staff/operations/jobs/reservation_expiry/retry',
          request,
          bindings,
        )
      ).status,
    ).toBe(403);
    const authorized = { ...request, headers: { ...request.headers, 'X-Test-Permission': 'run' } };
    expect(
      (
        await app.request(
          'http://local/api/staff/operations/jobs/reservation_expiry/retry',
          {
            ...authorized,
            headers: { 'Content-Type': 'application/json', 'X-Test-Permission': 'run' },
          },
          bindings,
        )
      ).status,
    ).toBe(400);
    const first = await app.request(
      'http://local/api/staff/operations/jobs/reservation_expiry/retry',
      authorized,
      bindings,
    );
    const replay = await app.request(
      'http://local/api/staff/operations/jobs/reservation_expiry/retry',
      authorized,
      bindings,
    );
    expect([first.status, replay.status]).toEqual([200, 200]);
    expect(await first.json()).toEqual(await replay.json());
    const conflict = await app.request(
      'http://local/api/staff/operations/jobs/reservation_expiry/retry',
      { ...authorized, body: JSON.stringify({ reason_code: 'BACKLOG_RECOVERY' }) },
      bindings,
    );
    expect(conflict.status).toBe(409);
    const unknown = await app.request(
      'http://local/api/staff/operations/jobs/reservation_expiry/retry',
      {
        ...authorized,
        headers: { ...authorized.headers, 'Idempotency-Key': 'http-unknown-key' },
        body: JSON.stringify({ reason_code: 'OPERATOR_RETRY', payload_json: 'secret' }),
      },
      bindings,
    );
    expect(unknown.status).toBe(400);
    expect(
      (
        await app.request(
          'http://local/api/staff/operations/jobs/not-a-job/retry',
          {
            ...authorized,
            headers: { ...authorized.headers, 'Idempotency-Key': 'http-invalid-job' },
          },
          bindings,
        )
      ).status,
    ).toBe(400);
  });

  it('keeps Staff-triggered drive archive inert while hard disabled', async () => {
    database = createMigratedTestDatabase();
    const bindings: AppBindings = {
      DB: database,
      SCHEDULED_OPERATIONS_ENABLED: 'true',
    };
    const app = createTestApp();
    const response = await app.request(
      'http://local/api/staff/operations/jobs/drive_archive/retry',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'http-drive-disabled',
          'X-Test-Permission': 'run',
        },
        body: JSON.stringify({ reason_code: 'OPERATOR_RETRY' }),
      },
      bindings,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { command: { outcome: 'DISABLED' } },
    });
  });

  it('returns a real 404 for the retired dead-letter replay route', async () => {
    database = createMigratedTestDatabase();
    const bindings: AppBindings = {
      DB: database,
      SCHEDULED_OPERATIONS_ENABLED: 'true',
    };
    const app = createTestApp();
    const response = await app.request(
      'http://local/api/staff/operations/dead-letters/anything/replay',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'http-replay-retired',
          'X-Test-Permission': 'run',
        },
        body: JSON.stringify({ event_id: 'x', reason_code: 'POISON_RECOVERY' }),
      },
      bindings,
    );
    expect(response.status).toBe(404);
  });
});

function createTestApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (context, next) => {
    context.set('requestId', 'request-scheduled-http');
    const permission = context.req.header('X-Test-Permission');
    if (permission)
      context.set('staffAuthorization', {
        staffId: 'zz-phase3h-test-owner',
        displayName: 'Owner',
        staffStatus: 'ACTIVE',
        authorizationVersion: 1,
        roles: new Set(['owner']),
        permissions: new Set(
          permission === 'run'
            ? ['SCHEDULED_OPERATIONS_RUN']
            : permission === 'audit'
              ? ['AUDIT_VIEW']
              : [],
        ),
        memberTeamIds: [],
        leaderTeamIds: [],
      });
    await next();
  });
  registerScheduledOperationRoutes(app);
  return app;
}
function seedExpirableReservation(db: SqliteDatabase, suffix = 'so'): void {
  db.exec(`
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
      VALUES ('${suffix}-subject','BUYER_CUSTOMER',1000);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, display_name, access_status,
      identity_review_status, version, created_at, updated_at, activated_at, disabled_at
    ) VALUES ('${suffix}-buyer','${suffix}-subject','AMAZON_JP','buyer-channel-wechat-b',
      '20260801B9901',9901,'命令测试买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
    INSERT INTO seller_channels (
      id, code, prefix, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('${suffix}-channel','socmd','socmd-','命令渠道','ACTIVE',1,1000,1000,NULL);
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status, version,
      created_at, updated_at, activated_at, next_member_number
    ) VALUES ('${suffix}-org','AMAZON_JP','${suffix}-org-1','${suffix}-channel','${suffix}-channel',
      9801,'命令测试组织','ACTIVE',1,1000,1000,1000,2);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
      VALUES ('${suffix}-member-subject','SELLER_ORG_MEMBER',1000);
    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number, username_fallback,
      display_name, role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES ('${suffix}-member','${suffix}-member-subject','${suffix}-org',1,
      '${suffix}-member-1','命令成员','OWNER',1,'ACTIVE',1,1000,1000,1000,NULL);
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name, normalized_name,
      status, version, created_at, updated_at, disabled_at
    ) VALUES ('${suffix}-store','${suffix}-org','AMAZON_JP','命令店铺','命令店铺',
      'ACTIVE',1,1000,1000,NULL);
    INSERT INTO products (
      id, organization_id, store_id, marketplace_code, asin_display, asin_normalized,
      status, current_version_no, version, created_at, updated_at, disabled_at
    ) VALUES ('${suffix}-product','${suffix}-org','${suffix}-store','AMAZON_JP',
      'B0SOCMD001','B0SOCMD001','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO product_versions (
      id, product_id, version_no, product_name, search_keywords_json, product_url,
      buyer_visible_notes, internal_notes, created_by_staff_id, created_at,
      ordering_guide_expected_amount_jpy, color_spec_mode
    ) VALUES ('${suffix}-product-v1','${suffix}-product',1,'命令产品','[]',NULL,
      NULL,NULL,'zz-phase3h-test-owner',1000,1980,'MAIN_IMAGE_VARIANT');
    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code, product_id, product_version_no,
      submitted_by_member_id, task_type, target_quantity, buyer_visible_notes,
      seller_notes, open_at, reservation_deadline, order_deadline, status,
      reviewed_by_staff_id, version,
      submitted_at, updated_at, reviewed_at, published_at, withdrawn_at, closed_at,
      held_reservation_count, approved_reservation_count
    ) VALUES ('${suffix}-demand','${suffix}-org','${suffix}-store','AMAZON_JP',
      '${suffix}-product',1,'${suffix}-member','TEXT',1,NULL,NULL,500,900,2000,'PUBLISHED',
      'zz-phase3h-test-owner',2,
      1000,3000,3000,3000,NULL,NULL,1,0);
    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id, organization_id, store_id, product_id,
      product_version_no, marketplace_code, status, precheck_snapshot_json,
      hold_expires_at, order_deadline_snapshot, version, submitted_at, updated_at,
      decided_by_staff_id, decision_reason, decided_at, cancelled_at, expired_at,
      reopened_count, buyer_self_pay_bps_snapshot, reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot, estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at, buyer_self_pay_accepted_demand_version
    ) VALUES ('${suffix}-reservation','${suffix}-demand','${suffix}-buyer',
      '${suffix}-org','${suffix}-store','${suffix}-product',1,'AMAZON_JP',
      'PENDING_REVIEW','{}',1000,2000,1,1000,1000,NULL,NULL,NULL,NULL,NULL,0,
      0,1980,0,1980,1000,2);
  `);
}
