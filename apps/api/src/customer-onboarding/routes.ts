import { apiFailure, apiSuccess, type SqlDatabase } from '@ygb/contracts';
import { normalizeWechatId } from '@ygb/domain';
import { hashNormalizedWechat } from './wechat-identity-crypto';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { listHistoricalSellerDirectory } from './historical-seller-directory';
import { listOrderCommunicationScreenshots } from '../order-communication-screenshots';

interface BuyerRow {
  subject_id: string;
  display_name: string;
  buyer_customer_no: string | null;
  marketplace_code: string | null;
  account_id: string | null;
  formal_order_count: number;
}
interface SellerRow {
  subject_id: string;
  display_name: string;
  marketplace_code: string;
  account_id: string | null;
  formal_order_count: number;
}
type CustomerMatch = {
  customer_type: 'BUYER' | 'SELLER';
  subject_id: string;
  display_name: string;
  customer_number: string | null;
  marketplace_code: string;
  has_portal_account: boolean;
  historical_order_count: number;
  orders: readonly {
    formal_order_id: string;
    product_name: string;
    platform_order_identifier: string | null;
    confirmed_at: number;
    communication_screenshots: readonly {
      file_object_id: string;
      file_version: number;
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT';
      visibility: 'SELLER_VISIBLE';
    }[];
  }[];
  source_status: 'HISTORICAL_UNKNOWN';
};

export function registerCustomerOnboardingRoutes(app: Hono<any>): void {
  app.get('/api/staff/customer-onboarding/seller-directory', async (context) => {
    const requestId = requestIdFromContext(context);
    try {
      const actor = requireActor(context);
      const url = new URL(context.req.url);
      if ([...url.searchParams.keys()].length > 0) throw new Error('VALIDATION');
      const items = await listHistoricalSellerDirectory(
        context.env.DB,
        actor,
      );
      context.header('Cache-Control', 'no-store');
      return context.json(apiSuccess({ items }, requestId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'FORBIDDEN')
        return context.json(apiFailure('FORBIDDEN', '当前岗位不能查看卖家客户', requestId), 403);
      if (message === 'VALIDATION')
        return context.json(apiFailure('VALIDATION_ERROR', '请求参数不正确', requestId), 400);
      return context.json(
        apiFailure('DEPENDENCY_UNAVAILABLE', '卖家客户目录暂时不可用', requestId),
        503,
      );
    }
  });
  app.get('/api/staff/customer-onboarding/lookup', async (context) => {
    const requestId = requestIdFromContext(context);
    try {
      const actor = requireActor(context);
      const url = new URL(context.req.url);
      if ([...url.searchParams.keys()].some((key) => !['customer_type', 'wechat_id'].includes(key)))
        throw new Error('VALIDATION');
      const type = url.searchParams.get('customer_type');
      const raw = url.searchParams.get('wechat_id');
      if ((type !== 'BUYER' && type !== 'SELLER') || !raw) throw new Error('VALIDATION');
      if (type === 'BUYER' && !actor.roles.has('owner') && !actor.roles.has('pre_sales'))
        throw new Error('FORBIDDEN');
      if (type === 'SELLER' && !actor.roles.has('owner') && !actor.roles.has('seller_ops'))
        throw new Error('FORBIDDEN');
      const wechat = normalizeWechatId(raw);
      const markets = actor.roles.has('owner')
        ? null
        : await resolveStaffMarketplaceCodes(context.env.DB, actor);
      const direct =
        type === 'BUYER'
          ? await buyerMatches(context.env.DB, wechat.normalized, markets)
          : await sellerMatches(context.env.DB, wechat.normalized, markets);
      const manual = await manualMatches(
        context.env.DB,
        type,
        wechat.normalized,
        markets,
        securitySecret(context),
      );
      const merged = mergeMatches(direct, manual);
      const resolutionRequired = hasAmbiguousMarketplace(merged);
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiSuccess(
          {
            matches: merged,
            resolution_required: resolutionRequired,
            manual_resolution_applied: manual.length > 0,
          },
          requestId,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'FORBIDDEN')
        return context.json(apiFailure('FORBIDDEN', '当前岗位不能查询该类客户', requestId), 403);
      if (message === 'VALIDATION')
        return context.json(apiFailure('VALIDATION_ERROR', '请输入正确的微信号', requestId), 400);
      return context.json(
        apiFailure('DEPENDENCY_UNAVAILABLE', '历史客户查询暂时不可用', requestId),
        503,
      );
    }
  });
}

async function buyerMatches(
  database: SqlDatabase,
  wechat: string,
  markets: readonly string[] | null,
): Promise<CustomerMatch[]> {
  const rows = await database
    .prepare(
      `SELECT buyer.id AS subject_id,buyer.display_name,buyer.buyer_customer_no,
      assignment.marketplace_code,account.id AS account_id,
      (SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.buyer_customer_id=buyer.id) AS formal_order_count
    FROM wechat_identity_claims claim
    JOIN buyer_customers buyer ON buyer.identity_subject_id=claim.identity_subject_id
    LEFT JOIN buyer_marketplace_assignments assignment ON assignment.buyer_customer_id=buyer.id
    LEFT JOIN customer_login_accounts account ON account.identity_subject_id=buyer.identity_subject_id AND account.status='ACTIVE'
    WHERE claim.normalized_wechat=? AND claim.status='ACTIVE' AND buyer.access_status='ACTIVE'
    ORDER BY buyer.activated_at,buyer.id`,
    )
    .bind(wechat)
    .all<BuyerRow>();
  const orderRows = await Promise.all(rows.results.map((row) => database
    .prepare(`
      SELECT id AS formal_order_id, product_name_snapshot AS product_name,
        amazon_order_number_normalized AS platform_order_identifier,
        confirmed_at
      FROM formal_orders
      WHERE buyer_customer_id=?
      ORDER BY confirmed_at DESC, id
      LIMIT 10
    `).bind(row.subject_id)
    .all<{
      formal_order_id: string;
      product_name: string;
      platform_order_identifier: string | null;
      confirmed_at: number;
    }>()));
  const visibleRows = rows.results
    .filter((row) => markets === null || markets.includes(row.marketplace_code ?? 'AMAZON_JP'));
  const orderIds = visibleRows.flatMap(
    (_, index) => orderRows[index]?.results.map((order) => order.formal_order_id) ?? [],
  );
  const chatScreenshots = await listOrderCommunicationScreenshots(database, orderIds);
  return visibleRows
    .map((row, index) => ({
      customer_type: 'BUYER' as const,
      subject_id: row.subject_id,
      display_name: row.display_name,
      customer_number: row.buyer_customer_no ?? null,
      marketplace_code: row.marketplace_code ?? 'AMAZON_JP',
      has_portal_account: row.account_id !== null,
      historical_order_count: Number(row.formal_order_count),
      orders: Object.freeze(orderRows[index]?.results.map((order) => ({
        formal_order_id: order.formal_order_id,
        product_name: order.product_name,
        platform_order_identifier: order.platform_order_identifier,
        confirmed_at: Number(order.confirmed_at),
        communication_screenshots: Object.freeze(
          chatScreenshots.get(order.formal_order_id) ?? [],
        ),
      })) ?? []),
      source_status: 'HISTORICAL_UNKNOWN' as const,
    }));
}

async function sellerMatches(
  database: SqlDatabase,
  wechat: string,
  markets: readonly string[] | null,
): Promise<CustomerMatch[]> {
  const accountSql = `(SELECT account.id FROM seller_organization_members portal_member
      JOIN customer_account_personas persona ON persona.seller_member_id=portal_member.id AND persona.persona_type='SELLER_MEMBER'
      JOIN customer_login_accounts account ON account.id=persona.account_id
      WHERE portal_member.organization_id=organization.id AND portal_member.status='ACTIVE' AND account.status='ACTIVE'
      ORDER BY portal_member.primary_owner DESC,portal_member.member_number,portal_member.id LIMIT 1)`;
  const identityRows = await database
    .prepare(
      `SELECT organization.id AS subject_id,organization.organization_name AS display_name,
      organization.marketplace_code,${accountSql} AS account_id,
      (SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.seller_organization_id=organization.id) AS formal_order_count
    FROM wechat_identity_claims claim
    JOIN seller_organization_members member ON member.identity_subject_id=claim.identity_subject_id
    JOIN seller_organizations organization ON organization.id=member.organization_id
    WHERE claim.normalized_wechat=? AND claim.status='ACTIVE' AND member.status='ACTIVE' AND organization.status='ACTIVE'
    ORDER BY member.primary_owner DESC,organization.activated_at,organization.id`,
    )
    .bind(wechat)
    .all<SellerRow>();
  const dedup = new Map<string, SellerRow>();
  for (const row of identityRows.results) dedup.set(row.subject_id, row);
  return [...dedup.values()]
    .filter((row) => {
      const canonical = row.marketplace_code === 'AMAZON_JP' ? 'AMAZON_JP' : row.marketplace_code;
      return markets === null || markets.includes(canonical);
    })
    .map((row) => ({
      customer_type: 'SELLER',
      subject_id: row.subject_id,
      display_name: row.display_name,
      customer_number: null,
      marketplace_code: row.marketplace_code === 'AMAZON_JP' ? 'AMAZON_JP' : row.marketplace_code,
      has_portal_account: row.account_id !== null,
      historical_order_count: Number(row.formal_order_count),
      orders: [],
      source_status: 'HISTORICAL_UNKNOWN',
    }));
}

async function manualMatches(
  database: SqlDatabase,
  type: 'BUYER' | 'SELLER',
  wechat: string,
  markets: readonly string[] | null,
  secret: string,
): Promise<CustomerMatch[]> {
  const hash = await hashNormalizedWechat(wechat, secret);
  const where =
    markets && markets.length
      ? `AND binding.marketplace_code IN (${markets.map(() => '?').join(',')})`
      : '';
  const rows = await database
    .prepare(
      `SELECT binding.subject_id,binding.marketplace_code FROM customer_identity_manual_bindings binding
    WHERE binding.identity_hash=? AND binding.customer_type=? AND binding.status='ACTIVE' ${where}`,
    )
    .bind(hash, type, ...(markets ?? []))
    .all<{ subject_id: string; marketplace_code: string }>();
  const result: CustomerMatch[] = [];
  for (const row of rows.results) {
    const match =
      type === 'BUYER'
        ? await buyerBySubject(database, row.subject_id, row.marketplace_code)
        : await sellerBySubject(database, row.subject_id, row.marketplace_code);
    if (match) result.push(match);
  }
  return result;
}
async function buyerBySubject(
  database: SqlDatabase,
  id: string,
  market: string,
): Promise<CustomerMatch | null> {
  const row = await database
    .prepare(
      `SELECT buyer.id AS subject_id,buyer.display_name,buyer.buyer_customer_no,
      account.id AS account_id,(SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.buyer_customer_id=buyer.id) AS formal_order_count
    FROM buyer_customers buyer LEFT JOIN customer_account_personas persona ON persona.buyer_customer_id=buyer.id AND persona.persona_type='BUYER'
    LEFT JOIN customer_login_accounts account ON account.id=persona.account_id AND account.status='ACTIVE'
    WHERE buyer.id=? AND buyer.access_status='ACTIVE'`,
    )
    .bind(id)
    .first<any>();
  return row
    ? {
        customer_type: 'BUYER',
        subject_id: String(row.subject_id),
        display_name: String(row.display_name),
        customer_number: (row as { buyer_customer_no?: string | null }).buyer_customer_no ?? null,
        marketplace_code: market,
        has_portal_account: row.account_id !== null,
        historical_order_count: Number(row.formal_order_count),
        orders: [],
        source_status: 'HISTORICAL_UNKNOWN',
      }
    : null;
}
async function sellerBySubject(
  database: SqlDatabase,
  id: string,
  market: string,
): Promise<CustomerMatch | null> {
  const row = await database
    .prepare(
      `SELECT organization.id AS subject_id,organization.organization_name AS display_name,
      (SELECT account.id FROM seller_organization_members member JOIN customer_account_personas persona ON persona.seller_member_id=member.id AND persona.persona_type='SELLER_MEMBER'
        JOIN customer_login_accounts account ON account.id=persona.account_id AND account.status='ACTIVE'
        WHERE member.organization_id=organization.id AND member.status='ACTIVE' LIMIT 1) AS account_id,
      (SELECT COUNT(*) FROM formal_orders formal_order WHERE formal_order.seller_organization_id=organization.id) AS formal_order_count
    FROM seller_organizations organization WHERE organization.id=? AND organization.status='ACTIVE'`,
    )
    .bind(id)
    .first<any>();
  return row
    ? {
        customer_type: 'SELLER',
        subject_id: String(row.subject_id),
        display_name: String(row.display_name),
        customer_number: null,
        marketplace_code: market,
        has_portal_account: row.account_id !== null,
        historical_order_count: Number(row.formal_order_count),
        orders: [],
        source_status: 'HISTORICAL_UNKNOWN',
      }
    : null;
}
function mergeMatches(...groups: readonly CustomerMatch[][]): CustomerMatch[] {
  const map = new Map<string, CustomerMatch>();
  for (const group of groups)
    for (const item of group)
      map.set(`${item.customer_type}:${item.marketplace_code}:${item.subject_id}`, item);
  return [...map.values()].sort(
    (a, b) =>
      a.marketplace_code.localeCompare(b.marketplace_code) ||
      a.display_name.localeCompare(b.display_name, 'zh-CN'),
  );
}
function hasAmbiguousMarketplace(matches: readonly CustomerMatch[]): boolean {
  const counts = new Map<string, Set<string>>();
  for (const item of matches) {
    const key = `${item.customer_type}:${item.marketplace_code}`;
    const set = counts.get(key) ?? new Set<string>();
    set.add(item.subject_id);
    counts.set(key, set);
  }
  return [...counts.values()].some((set) => set.size > 1);
}
function requireActor(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (!actor || actor.staffStatus !== 'ACTIVE') throw new Error('FORBIDDEN');
  return actor;
}
function securitySecret(context: Context<any>): string {
  const value = String(context.env.CUSTOMER_SECURITY_TOKEN_SECRET ?? '');
  if (new TextEncoder().encode(value).byteLength < 32) throw new Error('DEPENDENCY');
  return value;
}
