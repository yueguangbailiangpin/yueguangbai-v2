import { describe, expect, it } from 'vitest';
import type {
  SqlAllResult,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import { createApp } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  authoritativeAdvanceAmount,
  canViewOrderFinancialAdjustments,
  cleanOperatingPaymentTimestamp,
  registerOperatingIntegrityRoutes,
} from './routes';

describe('order integrity financial projection', () => {
  it('recognizes only owner plus FINANCIAL_VIEW as financial authority', () => {
    expect(canViewOrderFinancialAdjustments(actor('owner', ['FINANCIAL_VIEW']))).toBe(true);
    expect(canViewOrderFinancialAdjustments(actor('owner', []))).toBe(false);
    expect(canViewOrderFinancialAdjustments(actor('pre_sales', []))).toBe(false);
    expect(canViewOrderFinancialAdjustments(actor('seller_ops', []))).toBe(false);
  });

  it('rejects a future advance payment timestamp', () => {
    expect(cleanOperatingPaymentTimestamp(999, 1000)).toBe(999);
    expect(() => cleanOperatingPaymentTimestamp(1001, 1000)).toThrow('VALIDATION_ERROR');
  });

  it('reads the full advance amount only from the immutable order snapshot', async () => {
    await expect(authoritativeAdvanceAmount(new IntegrityDatabase(), 'order-1')).resolves.toBe(
      48840,
    );
  });

  it('rejects a future advance payment before claiming idempotency', async () => {
    const database = new IntegrityDatabase();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      context.set('staffAuthorization', actor('owner', ['BUYER_REFUND_RECORD']));
      await next();
    });
    registerOperatingIntegrityRoutes(app);
    const response = await app.request(
      'https://api.example.test/api/staff/buyer-advance-principal/order-1/payments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://api.example.test' },
        body: JSON.stringify({
          paid_at: Number.MAX_SAFE_INTEGER,
          payment_channel: 'WECHAT',
          note: null,
          proof_files: [{ file_object_id: 'proof-file-1', expected_file_version: 1 }],
        }),
      },
      { DB: database },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(database.sql.some((sql) => sql.includes('command_idempotency_records'))).toBe(false);
    expect(database.batchCalls).toBe(0);
  });

  it('rejects a legacy client-selected advance amount before idempotency', async () => {
    const database = new IntegrityDatabase();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      context.set('staffAuthorization', actor('owner', ['BUYER_REFUND_RECORD']));
      await next();
    });
    registerOperatingIntegrityRoutes(app);
    const response = await app.request(
      'https://api.example.test/api/staff/buyer-advance-principal/order-1/payments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://api.example.test' },
        body: JSON.stringify({
          amount_cny_fen: '48840',
          paid_at: 1,
          payment_channel: 'WECHAT',
          note: null,
          proof_files: [{ file_object_id: 'proof-file-1', expected_file_version: 1 }],
        }),
      },
      { DB: database },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(database.sql.some((sql) => sql.includes('command_idempotency_records'))).toBe(false);
    expect(database.batchCalls).toBe(0);
  });

  it('rejects a legacy client-selected reversal amount before idempotency', async () => {
    const database = new IntegrityDatabase();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      context.set('staffAuthorization', actor('owner', ['BUYER_REFUND_RECORD']));
      await next();
    });
    registerOperatingIntegrityRoutes(app);
    const response = await app.request(
      'https://api.example.test/api/staff/buyer-advance-principal/order-1/payments/advance-payment-1/reversals',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://api.example.test' },
        body: JSON.stringify({ amount_cny_fen: '24420', reason: '旧客户端部分冲正' }),
      },
      { DB: database },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(database.sql.some((sql) => sql.includes('command_idempotency_records'))).toBe(false);
    expect(database.batchCalls).toBe(0);
  });

  it('returns financial adjustments only to an owner with FINANCIAL_VIEW', async () => {
    const visible = await request(actor('owner', ['FINANCIAL_VIEW']));
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({
      data: {
        order_integrity: {
          adjustments: [
            {
              adjustment_id: 'adjustment-1',
              amount_cny_fen: '5000',
            },
          ],
        },
      },
    });

    const denied = await request(actor('owner', []));
    expect(denied.status).toBe(200);
    const deniedBody = (await denied.json()) as {
      data: { order_integrity: { adjustments: unknown[] } };
    };
    expect(deniedBody.data.order_integrity.adjustments).toEqual([]);
    expect(JSON.stringify(deniedBody)).not.toContain('5000');
  });
});

async function request(actorValue: AssignmentStaffAuthorization): Promise<Response> {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', actorValue);
    await next();
  });
  registerOperatingIntegrityRoutes(app);
  return app.request(
    'https://api.example.test/api/staff/order-integrity/order-1',
    {},
    { DB: new IntegrityDatabase() },
  );
}

function actor(
  role: StaffRoleCode,
  permissions: readonly StaffPermissionCode[],
): AssignmentStaffAuthorization {
  return {
    staffId: 'integrity-owner',
    displayName: 'Owner',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set([role]),
    permissions: new Set(permissions),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

class IntegrityDatabase implements SqlDatabase {
  readonly sql: string[] = [];
  batchCalls = 0;
  prepare(sql: string): SqlStatement {
    this.sql.push(sql);
    return new IntegrityStatement(sql);
  }
  batch(_statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    this.batchCalls += 1;
    throw new Error('unexpected_batch');
  }
  exec(): Promise<void> {
    throw new Error('unexpected_exec');
  }
}

class IntegrityStatement implements SqlStatement {
  constructor(private readonly sql: string) {}
  bind(): SqlStatement {
    return this;
  }
  first<T>(): Promise<T | null> {
    if (this.sql.includes('LEFT JOIN formal_order_effective_operational_state'))
      return Promise.resolve({ id: 'order-1', operational_state: 'NORMAL' } as T);
    if (this.sql.includes('FROM formal_orders'))
      return Promise.resolve({
        id: 'order-1',
        buyer_customer_id: 'buyer-1',
        market: 'AMAZON_JP',
      } as T);
    if (
      this.sql.includes(
        "FROM buyer_advance_principal_entries WHERE id=? AND formal_order_id=? AND entry_type='PAYMENT'",
      )
    )
      return Promise.resolve({
        id: 'advance-payment-1',
        amount_cny_fen: 48840,
        payment_channel: 'WECHAT',
      } as T);
    if (this.sql.includes('FROM buyer_advance_principal_settlements')) return Promise.resolve(null);
    if (this.sql.includes('FROM buyer_refund_obligations')) return Promise.resolve(null);
    if (this.sql.includes('FROM formal_order_financial_snapshots'))
      return Promise.resolve({ amount: 48840 } as T);
    if (this.sql.includes('formal_order_effective_operational_state'))
      return Promise.resolve({ operational_state: 'NORMAL' } as T);
    throw new Error(`unexpected_first:${this.sql}`);
  }
  all<T>(): Promise<SqlAllResult<T>> {
    if (this.sql.includes('formal_order_operational_events'))
      return Promise.resolve({ results: [] } as SqlAllResult<T>);
    if (this.sql.includes('FROM file_entity_links'))
      return Promise.resolve({ results: [] } as SqlAllResult<T>);
    if (this.sql.includes('formal_order_financial_adjustments'))
      return Promise.resolve({
        results: [
          {
            adjustment_id: 'adjustment-1',
            formal_order_id: 'order-1',
            source_operational_event_id: null,
            adjustment_scope: 'PROJECTED_GROSS_PROFIT',
            amount_cny_fen: '5000',
            reason: '修正',
            actor_staff_id: 'integrity-owner',
            created_at: 1,
          },
        ],
      } as SqlAllResult<T>);
    throw new Error(`unexpected_all:${this.sql}`);
  }
  run(): Promise<SqlRunResult> {
    throw new Error('unexpected_run');
  }
}
