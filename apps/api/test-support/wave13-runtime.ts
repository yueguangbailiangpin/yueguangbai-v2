import type {
  ObjectStorageAdapter,
  SqlAllResult,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
} from '@ygb/contracts';
import type { SqliteDatabase } from '@ygb/testkit';
import app from '../src/index';
import { FakeStaffAuthProvider } from '../src/staff-auth/provider';

export type RuntimeStaff = 'owner' | 'limited' | 'scoped' | 'sellerScoped';

const STAFF = Object.freeze({
  owner: {
    staffId: 'zz-phase3h-test-owner',
    openId: 'wave13-open-owner',
    userId: 'wave13-user-owner',
  },
  limited: {
    staffId: 'wave13-runtime-limited',
    openId: 'wave13-open-limited',
    userId: 'wave13-user-limited',
  },
  scoped: {
    staffId: 'wave13-runtime-scoped',
    openId: 'wave13-open-scoped',
    userId: 'wave13-user-scoped',
  },
  sellerScoped: {
    staffId: 'wave13-runtime-seller-scoped',
    openId: 'wave13-open-seller-scoped',
    userId: 'wave13-user-seller-scoped',
  },
});

export class Wave13RuntimeDatabase implements SqlDatabase {
  constructor(readonly base: SqliteDatabase) {}

  prepare(sql: string): SqlStatement {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    const kind = overlayKind(normalized);
    return kind === null
      ? this.base.prepare(sql)
      : new OverlayStatement(kind, normalized, []);
  }

  batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    return this.base.batch(statements);
  }
}

type OverlayKind =
  | 'REVIEW'
  | 'REVIEW_VERSION'
  | 'REVIEW_FILES'
  | 'ORDER_LIST'
  | 'ORDER_DETAIL'
  | 'ORDER_HISTORY'
  | 'REFUND_LIST'
  | 'REFUND_DETAIL'
  | 'REFUND_PAYMENTS'
  | 'REFUND_REVERSALS'
  | 'REFUND_PROOFS'
  | 'WORK_ITEM';

class OverlayStatement implements SqlStatement {
  constructor(
    private readonly kind: OverlayKind,
    private readonly sql: string,
    private readonly bindings: readonly unknown[],
  ) {}

  bind(...values: unknown[]): SqlStatement {
    return new OverlayStatement(this.kind, this.sql, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.kind === 'REVIEW') return reviewRow() as T;
    if (this.kind === 'ORDER_DETAIL') {
      return (this.sql.includes('0=1') ? null : orderDetailRow()) as T | null;
    }
    if (this.kind === 'REFUND_DETAIL') {
      return (this.sql.includes('0=1') ? null : refundDetailRow()) as T | null;
    }
    if (this.kind === 'WORK_ITEM') {
      const globallyVisible = this.bindings.some((value) => value === 1);
      return (globallyVisible ? workItemRow() : null) as T | null;
    }
    return null;
  }

  async all<T = Record<string, unknown>>(): Promise<SqlAllResult<T>> {
    if (this.kind === 'REVIEW_VERSION') {
      return { results: [reviewVersionRow() as T] };
    }
    if (this.kind === 'ORDER_HISTORY') {
      return { results: [{
        evidence_version_id: 'runtime-evidence-version',
        version_no: 1,
        final_paid_jpy: 1980,
        submitted_at: 10_000,
      } as T] };
    }
    if (this.kind === 'ORDER_LIST') {
      if (this.sql.includes('0=1')) return { results: [] };
      return { results: [
        orderListRow() as T,
        {
          ...orderListRow(),
          submission_id: 'runtime-evidence-no-mismatch',
          price_difference_jpy: 0,
          price_mismatch: 0,
          resubmission_deadline_at: null,
          submitted_at: 11_000,
          updated_at: 11_000,
        } as T,
      ] };
    }
    if (this.kind === 'REFUND_LIST') {
      return { results: filteredRefundListRows(
        this.sql,
        this.bindings,
      ) as T[] };
    }
    if (this.kind === 'REFUND_PAYMENTS') {
      return { results: [refundPaymentRow() as T] };
    }
    if (this.kind === 'REFUND_REVERSALS') {
      return { results: [refundReversalRow() as T] };
    }
    return { results: [] };
  }

  async run(): Promise<SqlRunResult> {
    throw new Error('wave13_runtime_overlay_is_read_only');
  }
}

function overlayKind(sql: string): OverlayKind | null {
  if (sql.includes('FROM review_cases') && sql.includes('WHERE id=?')) {
    return 'REVIEW';
  }
  if (sql.includes('FROM review_evidence_versions evidence')) {
    return 'REVIEW_VERSION';
  }
  if (sql.includes('FROM review_evidence_version_files')) {
    return 'REVIEW_FILES';
  }
  if (sql.includes('FROM order_evidence_submissions submission')
    && sql.includes('ORDER BY submission.submitted_at')) return 'ORDER_LIST';
  if (sql.includes('AS screenshot_file_object_id')) return 'ORDER_DETAIL';
  if (sql.includes('FROM order_evidence_versions')
    && sql.includes('created_at AS submitted_at')) return 'ORDER_HISTORY';
  if (sql.includes('FROM buyer_refund_ledger_balances ledger')
    && sql.includes('WHERE ledger.obligation_id=?')) return 'REFUND_DETAIL';
  if (sql.includes('FROM buyer_refund_ledger_balances ledger')
    && sql.includes('ORDER BY ledger.created_at')) return 'REFUND_LIST';
  if (sql.includes("entry_type='PAYMENT'")) return 'REFUND_PAYMENTS';
  if (sql.includes("entry_type='REVERSAL'")) return 'REFUND_REVERSALS';
  if (sql.includes('FROM buyer_refund_payment_entry_files')) {
    return 'REFUND_PROOFS';
  }
  if (sql.includes('FROM staff_work_items') && sql.includes('WHERE id=?')) {
    return 'WORK_ITEM';
  }
  return null;
}

function reviewRow() {
  return {
    review_case_id: 'runtime-review',
    formal_order_id: 'runtime-formal-order',
    buyer_customer_id: 'runtime-buyer',
    seller_organization_id: 'runtime-org',
    review_type: 'TEXT',
    status: 'PENDING_REVIEW',
    version: 1,
    current_evidence_version_no: 1,
    public_change_reason: null,
    internal_review_note: null,
    submitted_at: 10_000,
    updated_at: 10_000,
    decided_at: null,
  };
}

function reviewVersionRow() {
  return {
    evidence_version_id: 'runtime-review-version',
    version_no: 1,
    review_type: 'TEXT',
    review_url: 'https://example.test/review/runtime',
    buyer_note: null,
    submitted_by_buyer_id: 'runtime-buyer',
    submitted_at: 10_000,
  };
}

function orderDetailRow() {
  return {
    submission_id: 'runtime-evidence',
    reservation_id: 'runtime-reservation',
    buyer_customer_id: 'runtime-buyer',
    buyer_customer_no: 'P202608020001',
    marketplace_code: 'JP',
    status: 'PENDING_VERIFICATION',
    aggregate_version: 1,
    current_version_no: 1,
    evidence_version_id: 'runtime-evidence-version',
    amazon_order_number_raw: '123-1234567-1234567',
    amazon_order_number_normalized: '123-1234567-1234567',
    final_paid_jpy: 1980,
    buyer_note: null,
    public_change_reason: null,
    internal_review_note: null,
    submitted_at: 10_000,
    updated_at: 10_000,
    verified_at: null,
    withdrawn_at: null,
    verified_by_staff_id: null,
    reference_order_amount_jpy: 1980,
    price_difference_jpy: 0,
    price_mismatch: 0,
    instruction_id: 'runtime-instruction',
    instruction_version_id: 'runtime-instruction-version',
    buyer_self_pay_bps: 0,
    buyer_self_pay_jpy: 0,
    buyer_refundable_principal_jpy: 1980,
    reservation_status: 'APPROVED',
    reservation_version: 2,
    screenshot_file_object_id: 'runtime-screenshot',
    screenshot_file_version: 3,
    screenshot_purpose: 'ORDER_EVIDENCE',
    screenshot_visibility: 'BUYER_VISIBLE',
    screenshot_file_status: 'VERIFIED',
    screenshot_intent_status: 'VERIFIED',
    screenshot_owner_actor_type: 'BUYER_CUSTOMER',
    screenshot_owner_actor_id: 'runtime-buyer',
    screenshot_association_count: 1,
    associated_file_object_id: 'runtime-screenshot',
    eligible_screenshot_association_count: 1,
    duplicate_signal_count: 0,
    work_item_id: 'runtime-work-item',
    assigned_staff_id: 'zz-phase3h-test-owner',
    fixed_assignment_id: 'runtime-assignment',
  };
}

function orderListRow() {
  return {
    submission_id: 'runtime-evidence',
    reservation_id: 'runtime-reservation',
    buyer_customer_id: 'runtime-buyer',
    buyer_customer_no: 'P202608020001',
    marketplace_code: 'JP',
    status: 'PENDING_VERIFICATION',
    version: 1,
    current_version_no: 1,
    instruction_id: 'runtime-instruction',
    instruction_version_id: 'runtime-instruction-version',
    amazon_order_number_raw: '123-1234567-1234567',
    amazon_order_number_normalized: '123-1234567-1234567',
    reference_order_amount_jpy: 1980,
    final_paid_jpy: 2080,
    price_difference_jpy: 100,
    price_mismatch: 1,
    resubmission_deadline_at: 18_000,
    screenshot_file_object_id: 'runtime-screenshot',
    screenshot_file_version: 3,
    screenshot_purpose: 'ORDER_EVIDENCE',
    screenshot_visibility: 'BUYER_VISIBLE',
    work_item_id: 'runtime-work-item',
    assigned_staff_id: 'zz-phase3h-test-owner',
    fixed_assignment_id: 'runtime-assignment',
    submitted_at: 10_000,
    updated_at: 12_000,
  };
}

function refundDetailRow() {
  return {
    obligation_id: 'runtime-refund',
    source_review_event_id: 'runtime-refund-event',
    review_case_id: 'runtime-review',
    formal_order_id: 'runtime-formal-order',
    buyer_customer_id: 'runtime-buyer',
    due_amount_cny_fen: 1000,
    gross_paid_cny_fen: 1000,
    reversed_cny_fen: 200,
    net_paid_cny_fen: 800,
    status: 'PARTIALLY_PAID',
    version: 3,
    created_at: 10_000,
    updated_at: 12_000,
    buyer_customer_no: 'P202608020001',
    marketplace_code: 'JP',
    amazon_order_number_normalized: '123-1234567-1234567',
    product_id: 'runtime-product',
    asin_normalized: 'B0RT000001',
    work_item_id: 'runtime-refund-work-item',
    assigned_staff_id: 'zz-phase3h-test-owner',
    fixed_assignment_id: 'runtime-refund-assignment',
  };
}

function refundPaymentRow() {
  return {
    id: 'runtime-refund-payment',
    amount_cny_fen: 1000,
    paid_at: 11_000,
    china_business_date: '1970-01-01',
    payment_channel: 'WECHAT',
    public_note: 'Buyer-visible payment note',
    internal_note: 'Staff-only payment note',
  };
}

function refundReversalRow() {
  return {
    id: 'runtime-refund-reversal',
    original_payment_entry_id: 'runtime-refund-payment',
    amount_cny_fen: 200,
    reversed_at: 12_000,
    china_business_date: '1970-01-01',
    payment_channel: 'WECHAT',
    public_note: 'Buyer-visible reversal note',
    internal_note: 'Staff-only reversal note',
  };
}

function filteredRefundListRows(
  sql: string,
  bindings: readonly unknown[],
) {
  if (sql.includes('0=1')) return [];
  const start = Date.parse('2026-07-31T16:00:00.000Z');
  const rows = [
    refundListRow('runtime-refund-before', start - 1, 'DUE'),
    refundListRow('runtime-refund-start', start, 'DUE'),
    refundListRow('runtime-refund-end', start + 86_400_000 - 1, 'DUE'),
    refundListRow('runtime-refund-next', start + 86_400_000, 'PAID'),
  ];
  let index = 0;
  let filtered = rows;
  if (sql.includes('ledger.status=?')) {
    const status = bindings[index++];
    filtered = filtered.filter((row) => row.status === status);
  }
  if (sql.includes('ledger.created_at>=?')) {
    const from = Number(bindings[index++]);
    filtered = filtered.filter((row) => row.created_at >= from);
  }
  if (sql.includes('ledger.created_at<?')) {
    const to = Number(bindings[index++]);
    filtered = filtered.filter((row) => row.created_at < to);
  }
  if (sql.includes('(ledger.created_at>? OR')) {
    const createdAt = Number(bindings[index++]);
    index += 1;
    const id = String(bindings[index++]);
    filtered = filtered.filter((row) => row.created_at > createdAt
      || (row.created_at === createdAt && row.obligation_id > id));
  }
  const limit = Number(bindings.at(-1));
  return filtered.slice(0, limit);
}

function refundListRow(
  obligationId: string,
  createdAt: number,
  status: 'DUE' | 'PAID',
) {
  const paid = status === 'PAID' ? 1000 : 0;
  return {
    obligation_id: obligationId,
    buyer_customer_id: 'runtime-buyer',
    formal_order_id: 'runtime-formal-order',
    due_amount_cny_fen: 1000,
    gross_paid_cny_fen: paid,
    reversed_cny_fen: 0,
    net_paid_cny_fen: paid,
    status,
    version: status === 'PAID' ? 2 : 1,
    created_at: createdAt,
    updated_at: createdAt + 100,
    buyer_customer_no: 'P202608020001',
    marketplace_code: 'JP',
    amazon_order_number_normalized: '123-1234567-1234567',
    product_id: 'runtime-product',
    asin_normalized: 'B0RT000001',
    work_item_id: 'runtime-refund-work-item',
    assigned_staff_id: 'zz-phase3h-test-owner',
    fixed_assignment_id: 'runtime-refund-assignment',
  };
}

function workItemRow() {
  return {
    work_item_id: 'runtime-work-item',
    work_type: 'ORDER_EVIDENCE_REVIEW',
    source_entity_type: 'ORDER_EVIDENCE',
    source_entity_id: 'runtime-evidence',
    buyer_customer_id: 'runtime-buyer',
    seller_organization_id: 'runtime-org',
    store_id: 'runtime-store',
    duty_code: 'BUYER_PRE_SALES_OWNER',
    fixed_assignment_id: 'runtime-assignment',
    assigned_staff_id: 'zz-phase3h-test-owner',
    status: 'OPEN',
    version: 1,
    created_at: 10_000,
    updated_at: 10_000,
    completed_at: null,
    cancelled_at: null,
  };
}

export function seedWave13RuntimeAuthority(database: SqliteDatabase): void {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('wave13-runtime-limited','Wave 13 Limited','ACTIVE',1,1,2,2,NULL),
      ('wave13-runtime-scoped','Wave 13 Scoped','ACTIVE',1,1,2,2,NULL),
      ('wave13-runtime-seller-scoped','Wave 13 Seller Scoped',
       'ACTIVE',1,1,2,2,NULL);
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES
      ('wave13-runtime-limited','pre_sales','ACTIVE',
       'zz-phase3h-test-owner',2,NULL,2,2),
      ('wave13-runtime-scoped','buyer_refund','ACTIVE',
       'zz-phase3h-test-owner',2,NULL,2,2),
      ('wave13-runtime-seller-scoped','seller_ops','ACTIVE',
       'zz-phase3h-test-owner',2,NULL,2,2);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES
      ('wave13-runtime-limited','phase3h-test-team','ACTIVE',2,NULL,2,2),
      ('wave13-runtime-scoped','phase3h-test-team','ACTIVE',2,NULL,2,2),
      ('wave13-runtime-seller-scoped','phase3h-test-team',
       'ACTIVE',2,NULL,2,2);
    INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES
      ('wave13-runtime-limited','ORDER_VIEW','DENY','ACTIVE',
       'runtime deny','zz-phase3h-test-owner',2,NULL,2,2),
      ('wave13-runtime-limited','REVIEW_VIEW','DENY','ACTIVE',
       'runtime deny','zz-phase3h-test-owner',2,NULL,2,2),
      ('wave13-runtime-limited','BUYER_REFUND_VIEW','DENY','ACTIVE',
       'runtime deny','zz-phase3h-test-owner',2,NULL,2,2),
      ('wave13-runtime-scoped','ORDER_CONFIRM','GRANT','ACTIVE',
       'runtime scoped order review','zz-phase3h-test-owner',2,NULL,2,2),
      ('wave13-runtime-scoped','PRODUCT_VIEW','GRANT','ACTIVE',
       'runtime scoped catalog read','zz-phase3h-test-owner',2,NULL,2,2);
    INSERT INTO feishu_staff_identities (
      id, staff_id, tenant_key, open_id, user_id, status,
      verified_at, created_at, updated_at, revoked_at
    ) VALUES
      ('wave13-feishu-owner','zz-phase3h-test-owner','wave13-runtime-tenant',
       'wave13-open-owner','wave13-user-owner','ACTIVE',2,2,2,NULL),
      ('wave13-feishu-limited','wave13-runtime-limited','wave13-runtime-tenant',
       'wave13-open-limited','wave13-user-limited','ACTIVE',2,2,2,NULL),
      ('wave13-feishu-scoped','wave13-runtime-scoped','wave13-runtime-tenant',
       'wave13-open-scoped','wave13-user-scoped','ACTIVE',2,2,2,NULL),
      ('wave13-feishu-seller-scoped','wave13-runtime-seller-scoped',
       'wave13-runtime-tenant','wave13-open-seller-scoped',
       'wave13-user-seller-scoped','ACTIVE',2,2,2,NULL);
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id, seller_sequence,
      organization_name, status, version,
      created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES (
      'runtime-org','JP','ido-mango-runtime-1',
      'seller-channel-ido-mango','seller-channel-ido-mango',9101,
      'Runtime Organization','ACTIVE',1,2,2,2,NULL,2
    );
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'runtime-store','runtime-org','JP','Runtime Store','runtime store',
      'ACTIVE',1,2,2,NULL
    );
  `);
}

export function runtimeBindings(
  database: SqlDatabase,
  staff: RuntimeStaff,
  storage?: ObjectStorageAdapter,
): Record<string, unknown> {
  const identity = STAFF[staff];
  return {
    DB: database,
    FILE_OBJECT_STORAGE: storage,
    STAFF_AUTH_PROVIDER: 'FEISHU',
    STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/authorize',
    STAFF_AUTH_FEISHU_TOKEN_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
    STAFF_AUTH_FEISHU_APP_ID: 'cli_wave13_runtime',
    STAFF_AUTH_FEISHU_APP_SECRET: 'test-only-runtime-secret',
    STAFF_AUTH_FEISHU_SCOPE: 'contact:user.base:readonly',
    STAFF_AUTH_FEISHU_TENANT_KEY: 'wave13-runtime-tenant',
    STAFF_AUTH_FEISHU_REDIRECT_URI:
      'https://api.example.test/api/staff-auth/feishu/callback',
    STAFF_AUTH_ALLOWED_ORIGINS: 'https://staff.example.test',
    STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
    STAFF_AUTH_HASH_SECRET:
      'wave13-runtime-hash-secret-at-least-thirty-two-characters',
    STAFF_AUTH_PROVIDER_ADAPTER: new FakeStaffAuthProvider({
      provider: 'FEISHU',
      tenantKey: 'wave13-runtime-tenant',
      openId: identity.openId,
      userId: identity.userId,
    }),
  };
}

export async function loginThroughDefaultApp(
  database: SqlDatabase,
  staff: RuntimeStaff,
  storage?: ObjectStorageAdapter,
): Promise<{ cookie: string; env: Record<string, unknown> }> {
  const env = runtimeBindings(database, staff, storage);
  const start = await app.request(
    'https://api.example.test/api/staff-auth/login/start',
    {
      method: 'POST',
      headers: {
        Origin: 'https://staff.example.test',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    env,
  );
  if (start.status !== 200) throw new Error(`login_start_${start.status}`);
  const startBody = await start.json() as {
    data: { authorization_url: string };
  };
  const state = new URL(startBody.data.authorization_url)
    .searchParams.get('state');
  if (!state) throw new Error('login_state_missing');
  const callback = await app.request(
    `https://api.example.test/api/staff-auth/feishu/callback?code=runtime&state=${state}`,
    { method: 'GET', redirect: 'manual' },
    env,
  );
  if (callback.status !== 303) {
    throw new Error(`login_callback_${callback.status}`);
  }
  const cookie = callback.headers.getSetCookie()
    .map((header) => header.split(';')[0] ?? '')
    .find((candidate) => candidate.startsWith(
      '__Host-ygb_staff_session=',
    ) && candidate !== '__Host-ygb_staff_session=') ?? '';
  if (!cookie.includes('__Host-ygb_staff_session=')) {
    throw new Error('staff_cookie_missing');
  }
  return { cookie, env };
}

export function onePixelPng(): Uint8Array<ArrayBuffer> {
  const source = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64',
  );
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}
