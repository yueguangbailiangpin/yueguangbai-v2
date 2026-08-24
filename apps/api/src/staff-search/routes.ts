import { apiFailure, apiSuccess, type StaffDataScope } from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

/**
 * 顶栏全局搜索（P9）：客户编码/微信号/买家名/ASIN/产品名/订单号/需求名的
 * 分组聚合查询（买家/产品/订单/需求各取前 5）。权限按 data scope 过滤
 * （非 GLOBAL 时按站点码收窄；空站点返回空结果，不放大可见性）；
 * scope 由 staff-auth 中间件预解析（与全部 staff 路由同源）。
 */
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 64;
const RESULT_LIMIT = 5;
const LIKE_ESCAPE = '\\';

export interface StaffSearchResultsDto {
  query: string;
  buyers: readonly {
    buyer_customer_id: string;
    buyer_customer_no: string | null;
    display_name: string;
    marketplace_code: string;
  }[];
  products: readonly {
    product_id: string;
    product_name: string;
    asin_display: string;
    marketplace_code: string;
    status: string;
  }[];
  orders: readonly {
    formal_order_id: string;
    amazon_order_number_normalized: string;
    asin_display: string;
    marketplace_code: string;
  }[];
  demands: readonly {
    demand_batch_id: string;
    product_name: string;
    status: string;
    marketplace_code: string;
  }[];
}

export function registerStaffSearchRoutes(app: Hono<AppEnv>): void {
  app.get('/api/staff/search', search);
}

async function search(context: Context<AppEnv>): Promise<Response> {
  const requestId = requestIdFromContext(context);
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | undefined;
  const scope = context.get('staffDataScope') as StaffDataScope | undefined;
  if (!actor || !scope || actor.staffStatus !== 'ACTIVE') {
    return context.json(apiFailure('FORBIDDEN', '当前岗位不能使用搜索', requestId), 403);
  }
  const url = new URL(context.req.url);
  if ([...url.searchParams.keys()].some((key) => key !== 'q')) {
    return context.json(apiFailure('VALIDATION_ERROR', '查询参数不正确', requestId), 400);
  }
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return context.json(
      apiFailure('VALIDATION_ERROR', `关键词需 ${MIN_QUERY_LENGTH}-${MAX_QUERY_LENGTH} 个字符`, requestId),
      400,
    );
  }
  const scoped = scope.type !== 'GLOBAL' && scope.marketplaceCodes.length === 0;
  const [buyers, products, orders, demands] = await Promise.all([
    searchBuyers(context, query, scope),
    searchProducts(context, query, scope),
    searchOrders(context, query, scope),
    searchDemands(context, query, scope),
  ]);
  const emptyGroups = scoped;
  return context.json(
    apiSuccess(
      {
        query,
        buyers: emptyGroups ? [] : buyers,
        products: emptyGroups ? [] : products,
        orders: emptyGroups ? [] : orders,
        demands: emptyGroups ? [] : demands,
      } satisfies StaffSearchResultsDto,
      requestId,
    ),
    200,
  );

}

function marketFilter(scope: StaffDataScope, column: string): {
  sql: string;
  args: string[];
} {
  if (scope.type === 'GLOBAL') return { sql: '', args: [] };
  return {
    sql: ` AND ${column} IN (SELECT value FROM json_each(?))`,
    args: [JSON.stringify(scope.marketplaceCodes)],
  };
}

function likePattern(query: string): string {
  return `%${query.replaceAll(/[%_\\]/gu, (match) => `${LIKE_ESCAPE}${match}`)}%`;
}

function likeSql(columns: readonly string[]): string {
  return `(${columns
    .map((column) => `${column} LIKE ? ESCAPE '${LIKE_ESCAPE}'`)
    .join(' OR ')})`;
}

async function searchBuyers(
  context: Context<AppEnv>,
  query: string,
  scope: StaffDataScope,
): Promise<StaffSearchResultsDto['buyers']> {
  const market = marketFilter(scope, 'buyer.marketplace_code');
  const rows = await context.env.DB.prepare(`
    SELECT buyer.id AS buyer_customer_id, buyer.buyer_customer_no,
      buyer.display_name, buyer.marketplace_code
    FROM buyer_customers buyer
    LEFT JOIN wechat_identity_claims claim
      ON claim.identity_subject_id=buyer.identity_subject_id
      AND claim.status='ACTIVE'
    WHERE ${likeSql([
      'buyer.buyer_customer_no',
      'buyer.display_name',
      'claim.display_wechat',
      'claim.normalized_wechat',
    ])}${market.sql}
    ORDER BY buyer.created_at DESC, buyer.id
    LIMIT ${RESULT_LIMIT}
  `)
    .bind(likePattern(query), likePattern(query), likePattern(query), likePattern(query), ...market.args)
    .all<StaffSearchResultsDto['buyers'][number]>();
  return rows.results;
}

async function searchProducts(
  context: Context<AppEnv>,
  query: string,
  scope: StaffDataScope,
): Promise<StaffSearchResultsDto['products']> {
  const market = marketFilter(scope, 'product.marketplace_code');
  const rows = await context.env.DB.prepare(`
    SELECT product.id AS product_id, version.product_name,
      product.asin_display, product.marketplace_code, product.status
    FROM products product
    JOIN product_versions version
      ON version.product_id=product.id
      AND version.version_no=product.current_version_no
    WHERE ${likeSql([
      'product.asin_normalized',
      'product.asin_display',
      'version.product_name',
    ])}${market.sql}
    ORDER BY product.updated_at DESC, product.id
    LIMIT ${RESULT_LIMIT}
  `)
    .bind(likePattern(query), likePattern(query), likePattern(query), ...market.args)
    .all<StaffSearchResultsDto['products'][number]>();
  return rows.results;
}

async function searchOrders(
  context: Context<AppEnv>,
  query: string,
  scope: StaffDataScope,
): Promise<StaffSearchResultsDto['orders']> {
  const market = marketFilter(scope, 'formal_order.canonical_marketplace_code');
  const rows = await context.env.DB.prepare(`
    SELECT formal_order.id AS formal_order_id,
      formal_order.amazon_order_number_normalized,
      formal_order.asin_display, formal_order.canonical_marketplace_code AS marketplace_code
    FROM formal_orders formal_order
    WHERE ${likeSql(['formal_order.amazon_order_number_normalized'])}${market.sql}
    ORDER BY formal_order.created_at DESC, formal_order.id
    LIMIT ${RESULT_LIMIT}
  `)
    .bind(likePattern(query), ...market.args)
    .all<StaffSearchResultsDto['orders'][number]>();
  return rows.results;
}

async function searchDemands(
  context: Context<AppEnv>,
  query: string,
  scope: StaffDataScope,
): Promise<StaffSearchResultsDto['demands']> {
  const market = marketFilter(scope, 'demand.marketplace_code');
  const rows = await context.env.DB.prepare(`
    SELECT demand.id AS demand_batch_id, version.product_name,
      demand.status, demand.marketplace_code
    FROM demand_batches demand
    JOIN product_versions version
      ON version.product_id=demand.product_id
      AND version.version_no=demand.product_version_no
    WHERE ${likeSql(['version.product_name'])}${market.sql}
    ORDER BY demand.submitted_at DESC, demand.id
    LIMIT ${RESULT_LIMIT}
  `)
    .bind(likePattern(query), ...market.args)
    .all<StaffSearchResultsDto['demands'][number]>();
  return rows.results;
}
