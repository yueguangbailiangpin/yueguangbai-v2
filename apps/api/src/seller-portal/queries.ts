import type {
  DemandBatchStatus,
  ProductApplicationStatus,
  ProductStatus,
  SellerPortalDemandBatchDto,
  SellerPortalPage,
  SellerPortalProductApplicationDto,
  SellerPortalProductDto,
  SellerPortalProductVersionDto,
  SellerPortalStoreDto,
  SqlDatabase,
} from '@ygb/contracts';
import type { SellerPortalActor } from './actor';
import { SellerPortalError } from './errors';
import {
  decodeSellerPortalCursor,
  encodeSellerPortalCursor,
  isRecord,
  type SellerPortalPagination,
} from './pagination';

interface StoreRow {
  id: string;
  marketplace_code: 'JP';
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  created_at: number;
  updated_at: number;
}

interface ProductRow {
  id: string;
  store_id: string;
  store_display_name: string;
  marketplace_code: 'JP';
  seller_code: string;
  asin: string;
  status: 'ACTIVE' | 'DISABLED';
  current_version_no: number;
  version: number;
  created_at: number;
  updated_at: number;
  product_version_id: string;
  product_name: string;
  search_keywords_json: string;
  ordering_guide_expected_amount_jpy: number | null;
  color_spec_mode: 'MAIN_IMAGE_VARIANT' | 'ANY_VARIANT' | null;
  main_image_file_entity_link_id: string | null;
  product_url: string | null;
  buyer_visible_notes: string | null;
  product_version_created_at: number;
}

interface ProductVersionRow {
  id: string;
  version_no: number;
  product_name: string;
  search_keywords_json: string;
  ordering_guide_expected_amount_jpy: number | null;
  color_spec_mode: 'MAIN_IMAGE_VARIANT' | 'ANY_VARIANT' | null;
  main_image_file_entity_link_id: string | null;
  product_url: string | null;
  buyer_visible_notes: string | null;
  created_at: number;
}

interface ProductApplicationRow {
  id: string;
  store_id: string;
  store_display_name: string;
  marketplace_code: 'JP';
  asin: string;
  product_name: string;
  search_keywords_json: string;
  product_url: string | null;
  buyer_visible_notes: string | null;
  seller_notes: string | null;
  status: ProductApplicationStatus;
  review_reason: string | null;
  product_id: string | null;
  version: number;
  submitted_at: number;
  updated_at: number;
  reviewed_at: number | null;
  withdrawn_at: number | null;
}

interface DemandBatchRow {
  id: string;
  store_id: string;
  store_display_name: string;
  product_id: string;
  product_version_no: number;
  asin: string;
  product_name: string;
  search_keywords_json: string;
  product_url: string | null;
  marketplace_code: 'JP';
  task_type: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO';
  target_quantity: number;
  held_quantity: number;
  approved_quantity: number;
  buyer_visible_notes: string | null;
  seller_notes: string | null;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
  status: DemandBatchStatus;
  review_reason: string | null;
  close_reason: string | null;
  version: number;
  submitted_at: number;
  updated_at: number;
  reviewed_at: number | null;
  published_at: number | null;
  withdrawn_at: number | null;
  closed_at: number | null;
}

interface TextCursor {
  text: string;
  id: string;
}

interface TimeCursor {
  time: number;
  id: string;
}

interface VersionCursor {
  version_no: number;
}

export async function listSellerPortalStores(
  database: SqlDatabase,
  actor: SellerPortalActor,
  pagination: SellerPortalPagination,
): Promise<SellerPortalPage<SellerPortalStoreDto>> {
  const cursor = decodeSellerPortalCursor(
    pagination.cursor,
    isTextCursor,
  );
  const scope = storeScope(actor, 'store.id');
  const cursorSql = cursor
    ? `AND (
        store.display_name COLLATE NOCASE > ? COLLATE NOCASE
        OR (
          store.display_name COLLATE NOCASE = ? COLLATE NOCASE
          AND store.id > ?
        )
      )`
    : '';
  const cursorValues = cursor
    ? [cursor.text, cursor.text, cursor.id]
    : [];
  const result = await database.prepare(`
    SELECT
      store.id,
      store.marketplace_code,
      store.display_name,
      store.status,
      store.version,
      store.created_at,
      store.updated_at
    FROM seller_stores store
    WHERE store.organization_id=?
      ${scope.sql}
      ${cursorSql}
    ORDER BY store.display_name COLLATE NOCASE, store.id
    LIMIT ?
  `).bind(
    actor.sellerOrganizationId,
    ...scope.values,
    ...cursorValues,
    pagination.limit + 1,
  ).all<StoreRow>();

  const rows = result.results;
  const visible = rows.slice(0, pagination.limit);
  const last = visible.at(-1);
  return page(
    visible.map(mapStore),
    rows.length > pagination.limit && last
      ? encodeSellerPortalCursor({
          text: last.display_name,
          id: last.id,
        })
      : null,
    pagination.limit,
  );
}

export async function listSellerPortalProducts(
  database: SqlDatabase,
  actor: SellerPortalActor,
  pagination: SellerPortalPagination,
  filters: {
    storeId: string | null;
    status: ProductStatus | null;
    asin: string | null;
  },
): Promise<SellerPortalPage<SellerPortalProductDto>> {
  const cursor = decodeSellerPortalCursor(
    pagination.cursor,
    isTimeCursor,
  );
  const scope = storeScope(actor, 'product.store_id');
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.storeId !== null) {
    conditions.push('product.store_id=?');
    values.push(filters.storeId);
  }
  if (filters.status !== null) {
    conditions.push('product.status=?');
    values.push(filters.status);
  }
  if (filters.asin !== null) {
    conditions.push('product.asin_normalized=?');
    values.push(filters.asin);
  }
  if (cursor) {
    conditions.push(`(
      product.updated_at < ?
      OR (product.updated_at=? AND product.id < ?)
    )`);
    values.push(cursor.time, cursor.time, cursor.id);
  }
  const extra = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';

  const result = await database.prepare(`
    SELECT
      product.id,
      product.store_id,
      store.display_name AS store_display_name,
      product.marketplace_code,
      organization.seller_code,
      product.asin_normalized AS asin,
      product.status,
      product.current_version_no,
      product.version,
      product.created_at,
      product.updated_at,
      current.id AS product_version_id,
      current.product_name,
      current.search_keywords_json,
      current.ordering_guide_expected_amount_jpy,
      current.color_spec_mode,
      image.file_entity_link_id AS main_image_file_entity_link_id,
      current.product_url,
      current.buyer_visible_notes,
      current.created_at AS product_version_created_at
    FROM products product
    JOIN seller_stores store
      ON store.id=product.store_id
      AND store.organization_id=product.organization_id
    JOIN seller_organizations organization
      ON organization.id=product.organization_id
    JOIN product_versions current
      ON current.product_id=product.id
      AND current.version_no=product.current_version_no
    LEFT JOIN product_version_main_images image
      ON image.product_version_id=current.id
    WHERE product.organization_id=?
      ${scope.sql}
      ${extra}
    ORDER BY product.updated_at DESC, product.id DESC
    LIMIT ?
  `).bind(
    actor.sellerOrganizationId,
    ...scope.values,
    ...values,
    pagination.limit + 1,
  ).all<ProductRow>();

  const rows = result.results;
  const visible = rows.slice(0, pagination.limit);
  const last = visible.at(-1);
  return page(
    visible.map(mapProduct),
    rows.length > pagination.limit && last
      ? encodeSellerPortalCursor({
          time: Number(last.updated_at),
          id: last.id,
        })
      : null,
    pagination.limit,
  );
}

export async function getSellerPortalProduct(
  database: SqlDatabase,
  actor: SellerPortalActor,
  productId: string,
): Promise<SellerPortalProductDto> {
  const scope = storeScope(actor, 'product.store_id');
  const row = await database.prepare(`
    SELECT
      product.id,
      product.store_id,
      store.display_name AS store_display_name,
      product.marketplace_code,
      organization.seller_code,
      product.asin_normalized AS asin,
      product.status,
      product.current_version_no,
      product.version,
      product.created_at,
      product.updated_at,
      current.id AS product_version_id,
      current.product_name,
      current.search_keywords_json,
      current.ordering_guide_expected_amount_jpy,
      current.color_spec_mode,
      image.file_entity_link_id AS main_image_file_entity_link_id,
      current.product_url,
      current.buyer_visible_notes,
      current.created_at AS product_version_created_at
    FROM products product
    JOIN seller_stores store
      ON store.id=product.store_id
      AND store.organization_id=product.organization_id
    JOIN seller_organizations organization
      ON organization.id=product.organization_id
    JOIN product_versions current
      ON current.product_id=product.id
      AND current.version_no=product.current_version_no
    LEFT JOIN product_version_main_images image
      ON image.product_version_id=current.id
    WHERE product.id=?
      AND product.organization_id=?
      ${scope.sql}
  `).bind(
    productId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<ProductRow>();
  if (!row) throw new SellerPortalError('PRODUCT_NOT_FOUND', 404);
  return mapProduct(row);
}

export async function listSellerPortalProductVersions(
  database: SqlDatabase,
  actor: SellerPortalActor,
  productId: string,
  pagination: SellerPortalPagination,
): Promise<SellerPortalPage<SellerPortalProductVersionDto>> {
  await requireScopedProduct(database, actor, productId, false);
  const cursor = decodeSellerPortalCursor(
    pagination.cursor,
    isVersionCursor,
  );
  const result = await database.prepare(`
    SELECT
      id,
      version_no,
      product_name,
      version.search_keywords_json,
      version.ordering_guide_expected_amount_jpy,
      version.color_spec_mode,
      image.file_entity_link_id AS main_image_file_entity_link_id,
      version.product_url,
      version.buyer_visible_notes,
      version.created_at
    FROM product_versions version
    LEFT JOIN product_version_main_images image
      ON image.product_version_id=version.id
    WHERE version.product_id=?
      ${cursor ? 'AND version.version_no<?' : ''}
    ORDER BY version.version_no DESC
    LIMIT ?
  `).bind(
    productId,
    ...(cursor ? [cursor.version_no] : []),
    pagination.limit + 1,
  ).all<ProductVersionRow>();
  const rows = result.results;
  const visible = rows.slice(0, pagination.limit);
  const last = visible.at(-1);
  return page(
    visible.map(mapProductVersion),
    rows.length > pagination.limit && last
      ? encodeSellerPortalCursor({
          version_no: Number(last.version_no),
        })
      : null,
    pagination.limit,
  );
}

export async function listSellerPortalProductApplications(
  database: SqlDatabase,
  actor: SellerPortalActor,
  pagination: SellerPortalPagination,
  filters: {
    storeId: string | null;
    status: ProductApplicationStatus | null;
  },
): Promise<SellerPortalPage<SellerPortalProductApplicationDto>> {
  const cursor = decodeSellerPortalCursor(
    pagination.cursor,
    isTimeCursor,
  );
  const scope = storeScope(actor, 'application.store_id');
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.storeId !== null) {
    conditions.push('application.store_id=?');
    values.push(filters.storeId);
  }
  if (filters.status !== null) {
    conditions.push('application.status=?');
    values.push(filters.status);
  }
  if (cursor) {
    conditions.push(`(
      application.submitted_at < ?
      OR (application.submitted_at=? AND application.id < ?)
    )`);
    values.push(cursor.time, cursor.time, cursor.id);
  }
  const extra = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';
  const result = await database.prepare(`
    ${productApplicationSelect()}
    WHERE application.organization_id=?
      ${scope.sql}
      ${extra}
    ORDER BY application.submitted_at DESC, application.id DESC
    LIMIT ?
  `).bind(
    actor.sellerOrganizationId,
    ...scope.values,
    ...values,
    pagination.limit + 1,
  ).all<ProductApplicationRow>();
  const rows = result.results;
  const visible = rows.slice(0, pagination.limit);
  const last = visible.at(-1);
  return page(
    visible.map(mapProductApplication),
    rows.length > pagination.limit && last
      ? encodeSellerPortalCursor({
          time: Number(last.submitted_at),
          id: last.id,
        })
      : null,
    pagination.limit,
  );
}

export async function getSellerPortalProductApplication(
  database: SqlDatabase,
  actor: SellerPortalActor,
  applicationId: string,
): Promise<SellerPortalProductApplicationDto> {
  const scope = storeScope(actor, 'application.store_id');
  const row = await database.prepare(`
    ${productApplicationSelect()}
    WHERE application.id=?
      AND application.organization_id=?
      ${scope.sql}
  `).bind(
    applicationId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<ProductApplicationRow>();
  if (!row) {
    throw new SellerPortalError(
      'PRODUCT_APPLICATION_NOT_FOUND',
      404,
    );
  }
  return mapProductApplication(row);
}

export async function listSellerPortalDemandBatches(
  database: SqlDatabase,
  actor: SellerPortalActor,
  pagination: SellerPortalPagination,
  filters: {
    storeId: string | null;
    status: DemandBatchStatus | null;
  },
): Promise<SellerPortalPage<SellerPortalDemandBatchDto>> {
  const cursor = decodeSellerPortalCursor(
    pagination.cursor,
    isTimeCursor,
  );
  const scope = storeScope(actor, 'demand.store_id');
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.storeId !== null) {
    conditions.push('demand.store_id=?');
    values.push(filters.storeId);
  }
  if (filters.status !== null) {
    conditions.push('demand.status=?');
    values.push(filters.status);
  }
  if (cursor) {
    conditions.push(`(
      demand.submitted_at < ?
      OR (demand.submitted_at=? AND demand.id < ?)
    )`);
    values.push(cursor.time, cursor.time, cursor.id);
  }
  const extra = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';
  const result = await database.prepare(`
    ${demandBatchSelect()}
    WHERE demand.organization_id=?
      ${scope.sql}
      ${extra}
    ORDER BY demand.submitted_at DESC, demand.id DESC
    LIMIT ?
  `).bind(
    actor.sellerOrganizationId,
    ...scope.values,
    ...values,
    pagination.limit + 1,
  ).all<DemandBatchRow>();
  const rows = result.results;
  const visible = rows.slice(0, pagination.limit);
  const last = visible.at(-1);
  return page(
    visible.map(mapDemandBatch),
    rows.length > pagination.limit && last
      ? encodeSellerPortalCursor({
          time: Number(last.submitted_at),
          id: last.id,
        })
      : null,
    pagination.limit,
  );
}

export async function getSellerPortalDemandBatch(
  database: SqlDatabase,
  actor: SellerPortalActor,
  demandBatchId: string,
): Promise<SellerPortalDemandBatchDto> {
  const scope = storeScope(actor, 'demand.store_id');
  const row = await database.prepare(`
    ${demandBatchSelect()}
    WHERE demand.id=?
      AND demand.organization_id=?
      ${scope.sql}
  `).bind(
    demandBatchId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<DemandBatchRow>();
  if (!row) {
    throw new SellerPortalError('DEMAND_BATCH_NOT_FOUND', 404);
  }
  return mapDemandBatch(row);
}

export async function requireScopedStore(
  database: SqlDatabase,
  actor: SellerPortalActor,
  storeId: string,
  requireActive: boolean,
): Promise<void> {
  const scope = storeScope(actor, 'store.id');
  const row = await database.prepare(`
    SELECT store.id
    FROM seller_stores store
    WHERE store.id=?
      AND store.organization_id=?
      ${requireActive ? "AND store.status='ACTIVE'" : ''}
      ${scope.sql}
  `).bind(
    storeId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<{ id: string }>();
  if (!row) throw new SellerPortalError('STORE_NOT_FOUND', 404);
}

export async function requireScopedProduct(
  database: SqlDatabase,
  actor: SellerPortalActor,
  productId: string,
  requireActive: boolean,
): Promise<void> {
  const scope = storeScope(actor, 'product.store_id');
  const row = await database.prepare(`
    SELECT product.id
    FROM products product
    JOIN seller_stores store
      ON store.id=product.store_id
      AND store.organization_id=product.organization_id
    WHERE product.id=?
      AND product.organization_id=?
      ${requireActive ? "AND product.status='ACTIVE' AND store.status='ACTIVE'" : ''}
      ${scope.sql}
  `).bind(
    productId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<{ id: string }>();
  if (!row) throw new SellerPortalError('PRODUCT_NOT_FOUND', 404);
}

export async function requireScopedProductApplication(
  database: SqlDatabase,
  actor: SellerPortalActor,
  applicationId: string,
): Promise<void> {
  const scope = storeScope(actor, 'application.store_id');
  const row = await database.prepare(`
    SELECT application.id
    FROM product_applications application
    WHERE application.id=?
      AND application.organization_id=?
      ${scope.sql}
  `).bind(
    applicationId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<{ id: string }>();
  if (!row) {
    throw new SellerPortalError(
      'PRODUCT_APPLICATION_NOT_FOUND',
      404,
    );
  }
}

export async function requireScopedDemandBatch(
  database: SqlDatabase,
  actor: SellerPortalActor,
  demandBatchId: string,
): Promise<void> {
  const scope = storeScope(actor, 'demand.store_id');
  const row = await database.prepare(`
    SELECT demand.id
    FROM demand_batches demand
    WHERE demand.id=?
      AND demand.organization_id=?
      ${scope.sql}
  `).bind(
    demandBatchId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<{ id: string }>();
  if (!row) {
    throw new SellerPortalError('DEMAND_BATCH_NOT_FOUND', 404);
  }
}

function productApplicationSelect(): string {
  return `
    SELECT
      application.id,
      application.store_id,
      store.display_name AS store_display_name,
      application.marketplace_code,
      application.asin_normalized AS asin,
      application.product_name,
      application.search_keywords_json,
      application.product_url,
      application.buyer_visible_notes,
      application.seller_notes,
      application.status,
      application.review_reason,
      application.product_id,
      application.version,
      application.submitted_at,
      application.updated_at,
      application.reviewed_at,
      application.withdrawn_at
    FROM product_applications application
    JOIN seller_stores store
      ON store.id=application.store_id
      AND store.organization_id=application.organization_id
  `;
}

function demandBatchSelect(): string {
  return `
    SELECT
      demand.id,
      demand.store_id,
      store.display_name AS store_display_name,
      demand.product_id,
      demand.product_version_no,
      product.asin_normalized AS asin,
      version.product_name,
      version.search_keywords_json,
      version.product_url,
      demand.marketplace_code,
      demand.task_type,
      demand.target_quantity,
      demand.held_reservation_count AS held_quantity,
      demand.approved_reservation_count AS approved_quantity,
      demand.buyer_visible_notes,
      demand.seller_notes,
      demand.open_at,
      demand.reservation_deadline,
      demand.order_deadline,
      demand.status,
      demand.review_reason,
      demand.close_reason,
      demand.version,
      demand.submitted_at,
      demand.updated_at,
      demand.reviewed_at,
      demand.published_at,
      demand.withdrawn_at,
      demand.closed_at
    FROM demand_batches demand
    JOIN seller_stores store
      ON store.id=demand.store_id
      AND store.organization_id=demand.organization_id
    JOIN products product
      ON product.id=demand.product_id
      AND product.organization_id=demand.organization_id
      AND product.store_id=demand.store_id
    JOIN product_versions version
      ON version.product_id=demand.product_id
      AND version.version_no=demand.product_version_no
  `;
}

function storeScope(
  actor: SellerPortalActor,
  column: string,
): { sql: string; values: readonly unknown[] } {
  if (actor.allActiveStores) return { sql: '', values: [] };
  if (actor.storeIds.length === 0) {
    return { sql: 'AND 1=0', values: [] };
  }
  const placeholders = actor.storeIds.map(() => '?').join(', ');
  return {
    sql: `AND ${column} IN (${placeholders})`,
    values: actor.storeIds,
  };
}

function mapStore(row: StoreRow): SellerPortalStoreDto {
  return Object.freeze({
    id: row.id,
    marketplace_code: row.marketplace_code,
    display_name: row.display_name,
    status: row.status,
    version: Number(row.version),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  });
}

function mapProduct(row: ProductRow): SellerPortalProductDto {
  return Object.freeze({
    id: row.id,
    store: Object.freeze({
      id: row.store_id,
      display_name: row.store_display_name,
    }),
    marketplace_code: row.marketplace_code,
    seller_code: row.seller_code,
    asin: row.asin,
    status: row.status,
    current_version_no: Number(row.current_version_no),
    version: Number(row.version),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    current_version: mapProductVersion({
      id: row.product_version_id,
      version_no: row.current_version_no,
      product_name: row.product_name,
      search_keywords_json: row.search_keywords_json,
      ordering_guide_expected_amount_jpy:
        row.ordering_guide_expected_amount_jpy,
      color_spec_mode: row.color_spec_mode,
      main_image_file_entity_link_id:
        row.main_image_file_entity_link_id,
      product_url: row.product_url,
      buyer_visible_notes: row.buyer_visible_notes,
      created_at: row.product_version_created_at,
    }),
  });
}

function mapProductVersion(
  row: ProductVersionRow,
): SellerPortalProductVersionDto {
  return Object.freeze({
    id: row.id,
    version_no: Number(row.version_no),
    product_name: row.product_name,
    search_keywords: Object.freeze(
      parseStringArray(row.search_keywords_json),
    ),
    ordering_guide_expected_amount_jpy:
      row.ordering_guide_expected_amount_jpy === null
        ? null
        : Number(row.ordering_guide_expected_amount_jpy),
    color_spec_mode: row.color_spec_mode,
    main_image: row.main_image_file_entity_link_id === null
      ? null
      : Object.freeze({
          file_entity_link_id: row.main_image_file_entity_link_id,
        }),
    product_url: row.product_url,
    buyer_visible_notes: row.buyer_visible_notes,
    created_at: Number(row.created_at),
  });
}

function mapProductApplication(
  row: ProductApplicationRow,
): SellerPortalProductApplicationDto {
  return Object.freeze({
    id: row.id,
    store: Object.freeze({
      id: row.store_id,
      display_name: row.store_display_name,
    }),
    marketplace_code: row.marketplace_code,
    asin: row.asin,
    product_name: row.product_name,
    search_keywords: Object.freeze(
      parseStringArray(row.search_keywords_json),
    ),
    product_url: row.product_url,
    buyer_visible_notes: row.buyer_visible_notes,
    seller_notes: row.seller_notes,
    status: row.status,
    review_reason: row.review_reason,
    product_id: row.product_id,
    version: Number(row.version),
    submitted_at: Number(row.submitted_at),
    updated_at: Number(row.updated_at),
    reviewed_at: nullableNumber(row.reviewed_at),
    withdrawn_at: nullableNumber(row.withdrawn_at),
  });
}

function mapDemandBatch(
  row: DemandBatchRow,
): SellerPortalDemandBatchDto {
  const target = Number(row.target_quantity);
  const held = Number(row.held_quantity);
  const approved = Number(row.approved_quantity);
  return Object.freeze({
    id: row.id,
    store: Object.freeze({
      id: row.store_id,
      display_name: row.store_display_name,
    }),
    product: Object.freeze({
      id: row.product_id,
      version_no: Number(row.product_version_no),
      asin: row.asin,
      product_name: row.product_name,
      search_keywords: Object.freeze(
        parseStringArray(row.search_keywords_json),
      ),
      product_url: row.product_url,
    }),
    marketplace_code: row.marketplace_code,
    task_type: row.task_type,
    target_quantity: target,
    held_quantity: held,
    approved_quantity: approved,
    remaining_quantity: Math.max(target - held - approved, 0),
    buyer_visible_notes: row.buyer_visible_notes,
    seller_notes: row.seller_notes,
    open_at: Number(row.open_at),
    reservation_deadline: Number(row.reservation_deadline),
    order_deadline: Number(row.order_deadline),
    status: row.status,
    review_reason: row.review_reason,
    close_reason: row.close_reason,
    version: Number(row.version),
    submitted_at: Number(row.submitted_at),
    updated_at: Number(row.updated_at),
    reviewed_at: nullableNumber(row.reviewed_at),
    published_at: nullableNumber(row.published_at),
    withdrawn_at: nullableNumber(row.withdrawn_at),
    closed_at: nullableNumber(row.closed_at),
  });
}

function page<T>(
  items: readonly T[],
  nextCursor: string | null,
  limit: number,
): SellerPortalPage<T> {
  return Object.freeze({
    items: Object.freeze([...items]),
    page: Object.freeze({
      limit,
      next_cursor: nextCursor,
    }),
  });
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)
      || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('invalid_array');
    }
    return parsed;
  } catch {
    throw new SellerPortalError('DEPENDENCY_UNAVAILABLE', 503);
  }
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function isTextCursor(value: unknown): value is TextCursor {
  return isRecord(value)
    && typeof value['text'] === 'string'
    && typeof value['id'] === 'string';
}

function isTimeCursor(value: unknown): value is TimeCursor {
  return isRecord(value)
    && Number.isSafeInteger(value['time'])
    && typeof value['id'] === 'string';
}

function isVersionCursor(value: unknown): value is VersionCursor {
  return isRecord(value)
    && Number.isSafeInteger(value['version_no'])
    && Number(value['version_no']) >= 1;
}
