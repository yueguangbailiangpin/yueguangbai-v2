import { describe, expect, it } from 'vitest';
import type {
  SqlDatabase,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import type { SchedulingStaffActor } from './shared';
import { listStaffProducts, readStaffReservationSchedule } from './read-model';

const ACTOR: SchedulingStaffActor = {
  staffId: 'staff-owner',
  displayName: 'Owner',
  roles: ['owner' as StaffRoleCode],
  permissions: new Set<StaffPermissionCode>(['PRODUCT_VIEW']),
  dataScope: {
    type: 'GLOBAL',
    buyerCustomerIds: [],
    sellerOrganizationIds: [],
    teamIds: [],
    marketplaceCodes: [],
  },
} as const;

describe('staff scheduling cursor pagination', () => {
  it('traverses product pages without gaps and preserves the descending tie-breaker', async () => {
    const productRows: Record<string, unknown>[] = [
      productRow('product-3', 3000),
      productRow('product-2', 3000),
      productRow('product-1', 2000),
    ];
    const database = fakeDatabase({
      all: [[productRows[0]!, productRows[1]!, productRows[2]!], [productRows[2]!]],
    });

    const first = await listStaffProducts(database, ACTOR, { limit: 2 });
    expect(first.items.map((item) => item.product_id)).toEqual(['product-3', 'product-2']);
    expect(first.next_cursor).toEqual(expect.any(String));

    const second = await listStaffProducts(database, ACTOR, {
      limit: 2,
      cursor: first.next_cursor!,
    });
    expect(second.items.map((item) => item.product_id)).toEqual(['product-1']);
    expect(second.next_cursor).toBeNull();
    expect(database.calls[1]?.bindings).toEqual([3000, 3000, 'product-2', 3]);
    expect(database.calls[0]?.sql).toContain('ORDER BY product.updated_at DESC, product.id DESC');
  });

  it('traverses reservation pages without gaps and preserves the ascending tie-breaker', async () => {
    const reservationRows: Record<string, unknown>[] = [
      reservationRow('reservation-2', 1000),
      reservationRow('reservation-3', 1000),
      reservationRow('reservation-1', 2000),
    ];
    const database = fakeDatabase({
      first: [demandHeader(), demandHeader()],
      all: [[reservationRows[0]!, reservationRows[1]!, reservationRows[2]!], [reservationRows[2]!]],
    });

    const first = await readStaffReservationSchedule(database, ACTOR, 'demand-1', { limit: 2 });
    expect(first.items.map((item) => item.reservation_id)).toEqual([
      'reservation-2',
      'reservation-3',
    ]);
    expect(first.next_cursor).toEqual(expect.any(String));

    const second = await readStaffReservationSchedule(database, ACTOR, 'demand-1', {
      limit: 2,
      cursor: first.next_cursor!,
    });
    expect(second.items.map((item) => item.reservation_id)).toEqual(['reservation-1']);
    expect(second.next_cursor).toBeNull();
    expect(database.calls[3]?.bindings).toEqual(['demand-1', 1000, 1000, 'reservation-3', 3]);
    expect(database.calls[3]?.sql).toContain('ORDER BY submitted_at ASC, reservation_id ASC');
  });
});

function productRow(id: string, updatedAt: number): Record<string, unknown> {
  return {
    product_id: id,
    seller_organization_id: 'seller-org-1',
    store_id: 'store-1',
    store_name: '测试店铺',
    marketplace_code: 'AMAZON_JP',
    asin: `B0${id.replaceAll('-', '')}`,
    status: 'ACTIVE',
    aggregate_version: 1,
    current_version_no: 1,
    product_name: id,
    order_interval_days: null,
    orders_per_run: null,
    updated_at: updatedAt,
    primary_contact_member_id: null,
    primary_contact_member_name: null,
  };
}

function demandHeader(): Record<string, unknown> {
  return {
    demand_batch_id: 'demand-1',
    seller_organization_id: 'seller-org-1',
    store_id: 'store-1',
    marketplace_code: 'AMAZON_JP',
    product_id: 'product-1',
    source_product_version_id: 'version-1',
    status: 'OPEN',
    product_name: '测试产品',
    target_quantity: 3,
    order_deadline: 4000,
    demand_version: 1,
    schedule_version_id: null,
    schedule_version: null,
    schedule_demand_version: null,
    first_order_date: null,
    order_interval_days: null,
    orders_per_run: null,
    theoretical_last_order_date: null,
    affected_reservation_count: null,
    preview_hash: null,
    change_reason: null,
    changed_by_staff_id: null,
    schedule_created_at: null,
    effective_reservation_count: 3,
  };
}

function reservationRow(id: string, submittedAt: number): Record<string, unknown> {
  return {
    reservation_id: id,
    buyer_customer_id: 'buyer-1',
    buyer_customer_no: 'B000001',
    buyer_display_name: '买家一',
    status: 'APPROVED',
    submitted_at: submittedAt,
    queue_rank: 1,
    decision_source: 'STAFF',
    reservation_version: 1,
    evidence_status: null,
    formal_order_status: null,
    evidence_order_date: null,
    formal_order_date: null,
  };
}

function fakeDatabase(options: {
  all: Record<string, unknown>[][];
  first?: Record<string, unknown>[];
}): SqlDatabase & {
  calls: { sql: string; bindings: readonly unknown[] }[];
} {
  const allQueue = [...options.all];
  const firstQueue = [...(options.first ?? [])];
  const calls: { sql: string; bindings: readonly unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          calls.push({ sql, bindings });
          return {
            async all() {
              return { results: allQueue.shift() ?? [] };
            },
            async first() {
              return firstQueue.shift() ?? null;
            },
          };
        },
      } as never;
    },
  } as unknown as SqlDatabase & {
    calls: { sql: string; bindings: readonly unknown[] }[];
  };
}
