import { readFile } from 'node:fs/promises';
import {
  canonicalJson,
  sha256Hex,
} from '@ygb/domain';
import {
  previewCurrentReservableProductSellerMapping,
  type CurrentWhitelistManifest,
} from './index';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const CONSERVATIVE_TASK_TYPE = 'TEXT' as const;

export interface LiveCurrentRecord {
  sourceSheet: '工作表1' | '飞利浦产品';
  sourceRow: number;
  sourceLocator: string;
  marketplaceCode: 'JP_AMAZON' | 'JP_RAKUTEN';
  storeName: string;
  platformProductIdentifier?: string | null;
  asin: string | null;
  productName: string;
  reservationStatus?: 'ACTIVE' | 'PAUSED' | 'ABNORMAL' | null;
  orderTotal?: string | number | null;
  reviewRequirements?: string | null;
  notes?: string | null;
  rawOperationalFields?: Record<string, unknown>;
}

export interface LiveManifest extends Omit<CurrentWhitelistManifest, 'current'> {
  current: readonly LiveCurrentRecord[];
  manifestVersion?: string;
}

export interface StagingImportPlan {
  planVersion: '2026-08-21-staging-import-plan-v1';
  status: 'LOCAL_READONLY_PLAN';
  sourceManifestVersion: string | null;
  sourceManifestHash: string;
  planHash: string;
  generatedAt: number;
  window: {
    openAt: number;
    reservationDeadline: number;
    orderDeadline: number;
    durationDays: 30;
  };
  policy: {
    requiresMappedSeller: true;
    requiresActiveCurrentRow: true;
    requiresPositiveIntegerOrderTotal: true;
    fallbackTaskType: 'TEXT';
    taskTypeBasis: 'CONSERVATIVE_FALLBACK_REQUIRES_STAFF_CONFIRMATION';
    writesExecuted: false;
  };
  counts: {
    currentStandardProducts: number;
    unsupportedRuntimeMarketplace: number;
    legacyRuntimeProducts: number;
    openProductSellerMappings: number;
    reservationTasks: number;
    openProducts: number;
    noSellerMapping: number;
    noPositiveOrderTotal: number;
    excludedOrQuarantined: number;
  };
  standardProducts: readonly StandardProductPlan[];
  platformProductIdentities: readonly PlatformProductIdentityPlan[];
  sellerOrganizations: readonly SellerOrganizationPlan[];
  sellerStores: readonly SellerStorePlan[];
  sellerProductOfferings: readonly SellerProductOfferingPlan[];
  productVersions: readonly ProductVersionPlan[];
  openProductSellerMappings: readonly OpenProductSellerMappingPlan[];
  notOpened: readonly NotOpenedProductPlan[];
  runtimePlans: readonly LegacyReservationRuntimePlan[];
  externalCalls: 0;
  databaseWrites: 0;
  cloudflareWrites: 0;
  tencentDocsWrites: 0;
}

export interface StandardProductPlan {
  productKey: string;
  marketplaceCode: 'JP_AMAZON' | 'JP_RAKUTEN';
  platformProductIdentifier: string;
  standardProductId: string;
  productId: string | null;
  productVersionId: string | null;
  versionNo: 1 | null;
  productName: string;
  currentSourceRows: readonly number[];
  status: 'ACTIVE_CANDIDATE' | 'UNSUPPORTED_RUNTIME_MARKETPLACE';
}

export interface PlatformProductIdentityPlan {
  productKey: string;
  marketplaceCode: 'JP_RAKUTEN';
  platformProductIdentifier: string;
  identityType: 'PLATFORM_PRODUCT_IDENTITY';
  status: 'UNSUPPORTED_RUNTIME_MARKETPLACE';
}

export interface SellerOrganizationPlan {
  sellerOrganizationId: string;
  organizationKey: string;
  channelCode: string;
  sellerWechat: string;
  marketplaceCode: 'JP';
  status: 'ACTIVE_CANDIDATE';
}

export interface SellerStorePlan {
  sellerStoreId: string;
  sellerOrganizationId: string;
  organizationKey: string;
  displayName: string;
  normalizedName: string;
  marketplaceCode: 'JP';
  status: 'ACTIVE_CANDIDATE';
}

export interface SellerProductOfferingPlan {
  offeringId: string;
  standardProductId: string;
  sellerOrganizationId: string;
  sellerStoreId: string;
  marketplaceCode: 'AMAZON_JP' | 'RAKUTEN_JP';
  status: 'ACTIVE_CANDIDATE';
  cooperationStatus: 'CURRENT';
  sourceReservable: true;
}

export interface ProductVersionPlan {
  productId: string;
  productVersionId: string;
  versionNo: 1;
  productName: string;
  searchKeywordsJson: string;
  productUrl: null;
  buyerVisibleNotes: string;
  internalNotes: string;
  createdByStaffId: 'STAGING_STAFF_CONFIRMATION_REQUIRED';
}

export interface OpenProductSellerMappingPlan {
  productKey: string;
  productId: string | null;
  sellerOrganizationKey: string;
  sellerStoreKey: string;
  sellerWechat: string;
  channelCode: string;
  sourceRow: number;
  orderTotal: number;
  reviewRequirements: string;
  taskDefinitions: readonly TaskDefinitionPlan[];
  status: 'ELIGIBLE_CANDIDATE_PENDING_STAFF_REVIEW';
  reason: 'MAPPED_SELLER_ACTIVE_POSITIVE_ORDER_TOTAL';
}

export interface NotOpenedProductPlan {
  productKey: string;
  productId: string | null;
  currentSourceRows: readonly number[];
  reasons: readonly ('UNMAPPED_SELLER' | 'NO_POSITIVE_INTEGER_ORDER_TOTAL' | 'EXCLUDED_OR_QUARANTINED' | 'UNSUPPORTED_RUNTIME_MARKETPLACE')[];
  orderTotalValues: readonly string[];
  mappedSellerOrganizationKeys: readonly string[];
}

export interface TaskDefinitionPlan {
  taskType: 'TEXT' | 'IMAGE';
  targetQuantity: number;
  parseStatus: 'EXPLICIT_SPLIT' | 'SINGLE_TYPE' | 'TEXT_FALLBACK';
  parseReason: string;
}

export interface LegacyReservationRuntimePlan {
  taskId: string;
  demandBatchId: string;
  sourceRow: number;
  offeringId: string;
  organizationKey: string;
  storeKey: string;
  productId: string;
  productVersionNo: 1;
  taskType: 'TEXT' | 'IMAGE';
  targetQuantity: number;
  buyerVisibleNotes: string;
  sellerNotes: string;
  openAt: number;
  reservationDeadline: number;
  orderDeadline: number;
  status: 'SUBMITTED_PENDING_STAFF_REVIEW';
  taskTypeBasis: 'PARSED_SOURCE_REQUIREMENT' | 'CONSERVATIVE_FALLBACK_REQUIRES_STAFF_CONFIRMATION';
}

export async function readLiveManifest(path: string): Promise<LiveManifest> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object'
    || !Array.isArray((parsed as { current?: unknown }).current)
    || !Array.isArray((parsed as { historical?: unknown }).historical)) {
    throw new Error('INVALID_LIVE_MANIFEST');
  }
  return parsed as LiveManifest;
}

export async function createStagingImportPlan(
  manifest: LiveManifest,
  options: { now: number },
): Promise<StagingImportPlan> {
  if (!Number.isSafeInteger(options.now) || options.now < 0) {
    throw new Error('INVALID_PLAN_NOW');
  }
  const preview = await previewCurrentReservableProductSellerMapping(manifest);
  const currentByRow = new Map<number, LiveCurrentRecord>(
    manifest.current.map((row) => [row.sourceRow, row]),
  );
  const standardProducts = await Promise.all(preview.standardProducts.map(async (product) => {
    const idHash = await sha256Hex(product.productKey);
    const productId = `staging-product-${idHash}`;
    const standardProductId = `staging-standard-product-${idHash}`;
    const amazonRuntime = product.marketplaceCode === 'JP_AMAZON';
    return {
      productKey: product.productKey,
      marketplaceCode: product.marketplaceCode,
      platformProductIdentifier: product.platformProductIdentifier,
      standardProductId,
      productId: amazonRuntime ? productId : null,
      productVersionId: amazonRuntime ? `${productId}-v1` : null,
      versionNo: amazonRuntime ? 1 as const : null,
      productName: product.canonicalName,
      currentSourceRows: product.currentRows,
      status: amazonRuntime ? 'ACTIVE_CANDIDATE' as const : 'UNSUPPORTED_RUNTIME_MARKETPLACE' as const,
    };
  }));
  const productVersions: ProductVersionPlan[] = standardProducts
    .filter((product): product is StandardProductPlan & {
      productId: string; productVersionId: string; versionNo: 1;
    } => product.marketplaceCode === 'JP_AMAZON')
    .map((product) => ({
    productId: product.productId,
    productVersionId: product.productVersionId,
    versionNo: 1,
    productName: product.productName,
    searchKeywordsJson: JSON.stringify([product.productName, product.platformProductIdentifier]),
    productUrl: null,
    buyerVisibleNotes: 'Staging plan only; staff review required before publication.',
    internalNotes: `Source current rows: ${product.currentSourceRows.join(',')}`,
    createdByStaffId: 'STAGING_STAFF_CONFIRMATION_REQUIRED',
    }));
  const platformProductIdentities: PlatformProductIdentityPlan[] = standardProducts
    .filter((product): product is StandardProductPlan & { marketplaceCode: 'JP_RAKUTEN' } =>
      product.marketplaceCode === 'JP_RAKUTEN')
    .map((product) => ({
      productKey: product.productKey,
      marketplaceCode: 'JP_RAKUTEN' as const,
      platformProductIdentifier: product.platformProductIdentifier,
      identityType: 'PLATFORM_PRODUCT_IDENTITY' as const,
      status: 'UNSUPPORTED_RUNTIME_MARKETPLACE' as const,
    }));
  const organizationByKey = new Map<string, SellerOrganizationPlan>();
  const storeByKey = new Map<string, SellerStorePlan>();
  const offeringByKey = new Map<string, SellerProductOfferingPlan>();
  const mappedByProduct = new Map<string, typeof preview.mappedSellerOfferings>();
  for (const offer of preview.mappedSellerOfferings) {
    mappedByProduct.set(offer.productKey, [
      ...(mappedByProduct.get(offer.productKey) ?? []), offer,
    ]);
  }
  const openProductSellerMappings: OpenProductSellerMappingPlan[] = [];
  const notOpened: NotOpenedProductPlan[] = [];
  for (const product of standardProducts) {
    if (product.marketplaceCode !== 'JP_AMAZON') {
      notOpened.push({
        productKey: product.productKey,
        productId: null,
        currentSourceRows: product.currentSourceRows,
        reasons: ['UNSUPPORTED_RUNTIME_MARKETPLACE'],
        orderTotalValues: [],
        mappedSellerOrganizationKeys: [],
      });
      continue;
    }
    const currentRows = product.currentSourceRows
      .map((row) => currentByRow.get(row))
      .filter((row): row is LiveCurrentRecord => Boolean(row));
    const activeRows = currentRows.filter((row) => row.reservationStatus !== 'PAUSED'
      && row.reservationStatus !== 'ABNORMAL');
    const rawTotals = activeRows.map((row) => String(row.orderTotal ?? '').trim())
      .filter(Boolean).sort();
    const offers = mappedByProduct.get(product.productKey) ?? [];
    const positiveRows = activeRows.filter((row) => parsePositiveInteger(row.orderTotal) !== null);
    const productReasons: NotOpenedProductPlan['reasons'] = [];
    if (offers.length === 0) productReasons.push('UNMAPPED_SELLER');
    if (activeRows.length === 0) productReasons.push('EXCLUDED_OR_QUARANTINED');
    if (positiveRows.length === 0) productReasons.push('NO_POSITIVE_INTEGER_ORDER_TOTAL');
    if (productReasons.length > 0) {
      notOpened.push({
        productKey: product.productKey,
        productId: product.productId,
        currentSourceRows: product.currentSourceRows,
        reasons: [...new Set(productReasons)],
        orderTotalValues: rawTotals,
        mappedSellerOrganizationKeys: offers.map((offer) => offer.organizationKey).sort(),
      });
      continue;
    }
    for (const offer of offers) {
      const sellerOrganizationId = `staging-seller-org-${await sha256Hex(offer.organizationKey)}`;
      const sellerStoreId = `staging-seller-store-${await sha256Hex(`${offer.organizationKey}:store`)}`;
      organizationByKey.set(offer.organizationKey, {
        sellerOrganizationId,
        organizationKey: offer.organizationKey,
        channelCode: offer.channelCode,
        sellerWechat: offer.sellerWechat,
        marketplaceCode: 'JP',
        status: 'ACTIVE_CANDIDATE',
      });
      storeByKey.set(offer.organizationKey, {
        sellerStoreId,
        sellerOrganizationId,
        organizationKey: offer.organizationKey,
        displayName: `${offer.channelCode} historical store`,
        normalizedName: `${offer.channelCode}-historical-store`,
        marketplaceCode: 'JP',
        status: 'ACTIVE_CANDIDATE',
      });
      const offeringKey = `${product.productKey}:${offer.organizationKey}`;
      offeringByKey.set(offeringKey, {
        offeringId: `staging-offering-${await sha256Hex(offeringKey)}`,
        standardProductId: product.standardProductId,
        sellerOrganizationId,
        sellerStoreId,
        marketplaceCode: product.marketplaceCode === 'JP_AMAZON' ? 'AMAZON_JP' : 'RAKUTEN_JP',
        status: 'ACTIVE_CANDIDATE',
        cooperationStatus: 'CURRENT',
        sourceReservable: true,
      });
      for (const row of activeRows) {
        const orderTotal = parsePositiveInteger(row.orderTotal);
        if (orderTotal === null) {
          notOpened.push({
            productKey: product.productKey,
            productId: product.productId,
            currentSourceRows: [row.sourceRow],
            reasons: ['NO_POSITIVE_INTEGER_ORDER_TOTAL'],
            orderTotalValues: [String(row.orderTotal ?? '').trim()].filter(Boolean),
            mappedSellerOrganizationKeys: [offer.organizationKey],
          });
          continue;
        }
        openProductSellerMappings.push({
          productKey: product.productKey,
          productId: product.productId,
          sellerOrganizationKey: offer.organizationKey,
          sellerStoreKey: `${offer.organizationKey}:store`,
          sellerWechat: offer.sellerWechat,
          channelCode: offer.channelCode,
          sourceRow: row.sourceRow,
          orderTotal,
          reviewRequirements: String(row.reviewRequirements ?? '').trim(),
          taskDefinitions: parseTaskDefinitions(row.reviewRequirements, orderTotal),
          status: 'ELIGIBLE_CANDIDATE_PENDING_STAFF_REVIEW',
          reason: 'MAPPED_SELLER_ACTIVE_POSITIVE_ORDER_TOTAL',
        });
      }
    }
  }
  const openProducts = [...new Set(openProductSellerMappings.map((row) => row.productKey))];
  const windowEnd = options.now + WINDOW_DAYS * DAY_MS;
  const runtimePlans = await Promise.all(openProductSellerMappings.flatMap((mapping) =>
    mapping.taskDefinitions.map(async (task, taskIndex) => {
      const offering = offeringByKey.get(`${mapping.productKey}:${mapping.sellerOrganizationKey}`)!;
      const stableKey = `${mapping.productKey}:${mapping.sellerOrganizationKey}:${mapping.sourceRow}:${task.taskType}:${taskIndex}`;
      return {
        taskId: `staging-task-${await sha256Hex(stableKey)}`,
        demandBatchId: `staging-demand-${await sha256Hex(stableKey)}`,
        sourceRow: mapping.sourceRow,
        offeringId: offering.offeringId,
        organizationKey: mapping.sellerOrganizationKey,
        storeKey: mapping.sellerStoreKey,
        productId: mapping.productId,
        productVersionNo: 1 as const,
        taskType: task.taskType,
        targetQuantity: task.targetQuantity,
        buyerVisibleNotes: 'Staging plan only; Staff must confirm before publishing.',
        sellerNotes: `Source row: ${mapping.sourceRow}; review requirement: ${mapping.reviewRequirements || '(empty)'}`,
        openAt: options.now,
        reservationDeadline: windowEnd - 1,
        orderDeadline: windowEnd,
        status: 'SUBMITTED_PENDING_STAFF_REVIEW' as const,
        taskTypeBasis: task.parseStatus === 'TEXT_FALLBACK'
          ? 'CONSERVATIVE_FALLBACK_REQUIRES_STAFF_CONFIRMATION' as const
          : 'PARSED_SOURCE_REQUIREMENT' as const,
      };
    }),
  ));
  const sourceManifestHash = preview.manifestHash;
  const planWithoutHash = {
    planVersion: '2026-08-21-staging-import-plan-v1' as const,
    status: 'LOCAL_READONLY_PLAN' as const,
    sourceManifestVersion: manifest.manifestVersion ?? null,
    sourceManifestHash,
    generatedAt: options.now,
    window: {
      openAt: options.now,
      reservationDeadline: windowEnd - 1,
      orderDeadline: windowEnd,
      durationDays: WINDOW_DAYS as 30,
    },
    policy: {
      requiresMappedSeller: true as const,
      requiresActiveCurrentRow: true as const,
      requiresPositiveIntegerOrderTotal: true as const,
      fallbackTaskType: CONSERVATIVE_TASK_TYPE,
      taskTypeBasis: 'CONSERVATIVE_FALLBACK_REQUIRES_STAFF_CONFIRMATION' as const,
      writesExecuted: false as const,
    },
    counts: {
      currentStandardProducts: standardProducts.length,
      unsupportedRuntimeMarketplace: platformProductIdentities.length,
      legacyRuntimeProducts: standardProducts.length - platformProductIdentities.length,
      openProductSellerMappings: openProductSellerMappings.length,
      reservationTasks: runtimePlans.length,
      openProducts: openProducts.length,
      noSellerMapping: notOpened.filter((row) => row.reasons.includes('UNMAPPED_SELLER')).length,
      noPositiveOrderTotal: notOpened.filter((row) => row.reasons.includes('NO_POSITIVE_INTEGER_ORDER_TOTAL')).length,
      excludedOrQuarantined: notOpened.filter((row) => row.reasons.includes('EXCLUDED_OR_QUARANTINED')).length,
    },
    standardProducts: standardProducts.sort((a, b) => a.productKey.localeCompare(b.productKey)),
    platformProductIdentities: platformProductIdentities.sort((a, b) =>
      a.productKey.localeCompare(b.productKey)),
    sellerOrganizations: [...organizationByKey.values()].sort((a, b) =>
      a.organizationKey.localeCompare(b.organizationKey)),
    sellerStores: [...storeByKey.values()].sort((a, b) =>
      a.organizationKey.localeCompare(b.organizationKey)),
    sellerProductOfferings: [...offeringByKey.values()].sort((a, b) =>
      a.offeringId.localeCompare(b.offeringId)),
    productVersions: productVersions.sort((a, b) => a.productId.localeCompare(b.productId)),
    openProductSellerMappings: openProductSellerMappings.sort((a, b) =>
      a.productKey.localeCompare(b.productKey) || a.sellerOrganizationKey.localeCompare(b.sellerOrganizationKey)),
    notOpened: notOpened.sort((a, b) => a.productKey.localeCompare(b.productKey)),
    runtimePlans: runtimePlans.sort((a, b) => a.demandBatchId.localeCompare(b.demandBatchId)),
    externalCalls: 0 as const,
    databaseWrites: 0 as const,
    cloudflareWrites: 0 as const,
    tencentDocsWrites: 0 as const,
  };
  return {
    ...planWithoutHash,
    planHash: await sha256Hex(canonicalJson(planWithoutHash)),
  };
}

function parsePositiveInteger(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const normalized = String(value ?? '').trim();
  if (!/^[1-9][0-9]*$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseTaskDefinitions(
  reviewRequirements: string | null | undefined,
  orderTotal: number,
): readonly TaskDefinitionPlan[] {
  const value = String(reviewRequirements ?? '').normalize('NFKC').trim();
  const imageMatch = value.match(/([1-9][0-9]*)\s*单?\s*图评/iu);
  const textMatch = value.match(/([1-9][0-9]*)\s*单?\s*文评/iu);
  if (imageMatch && textMatch) {
    return [
      {
        taskType: 'IMAGE', targetQuantity: Number(imageMatch[1]),
        parseStatus: 'EXPLICIT_SPLIT', parseReason: 'EXPLICIT_IMAGE_REVIEW_COUNT',
      },
      {
        taskType: 'TEXT', targetQuantity: Number(textMatch[1]),
        parseStatus: 'EXPLICIT_SPLIT', parseReason: 'EXPLICIT_TEXT_REVIEW_COUNT',
      },
    ];
  }
  const hasImage = /图/iu.test(value);
  const hasText = /文/iu.test(value);
  if (hasImage && !hasText) {
    return [{
      taskType: 'IMAGE', targetQuantity: orderTotal,
      parseStatus: 'SINGLE_TYPE', parseReason: 'IMAGE_ONLY',
    }];
  }
  if (hasText && !hasImage) {
    return [{
      taskType: 'TEXT', targetQuantity: orderTotal,
      parseStatus: 'SINGLE_TYPE', parseReason: 'TEXT_ONLY',
    }];
  }
  return [{
    taskType: 'TEXT', targetQuantity: orderTotal,
    parseStatus: 'TEXT_FALLBACK',
    parseReason: value ? 'UNSAFE_REVIEW_REQUIREMENT_MAPPING' : 'EMPTY_REVIEW_REQUIREMENT',
  }];
}

export function serializeStagingImportPlan(plan: StagingImportPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
