import {
  canonicalJson,
  normalizeAsin,
  normalizeWechatId,
  sha256Hex,
} from '@ygb/domain';

export const FROZEN_SOURCE_FOLDERS = {
  dJwldHrckeFY: 'ido-mango',
  dDUYsBOrYoEk: 'ygbceping',
  davLDVdZLoPV: 'yinghua1942',
  dhtkJdpmZEgh: 'yueguangbaiai',
} as const;

export const CHANNEL_ALIASES = {
  ygb: 'ygbceping',
  ygceping: 'ygbceping',
  ygc: 'ygbceping',
  ygbceoing: 'ygbceping',
  gyb: 'ygbceping',
  ygbceping: 'ygbceping',
  ido: 'ido-mango',
  idomango: 'ido-mango',
  'ido-mango': 'ido-mango',
  'ido-mago': 'ido-mango',
  idomamgo: 'ido-mango',
  'ido-mamgo': 'ido-mango',
  dio: 'ido-mango',
  yueguangbai: 'yueguangbaiai',
  yuegungbai: 'yueguangbaiai',
  yueguangbaiai: 'yueguangbaiai',
  yinghua1942: 'yinghua1942',
  yinghua1942ai: 'yinghua1942',
  queshengai: 'queshengai',
  quesheng520ai: 'queshengai',
} as const;

export type ChannelCode = typeof CHANNEL_ALIASES[keyof typeof CHANNEL_ALIASES];
export type MarketplaceCode = 'JP_AMAZON' | 'JP_RAKUTEN';
export type RowStatus = 'VALID' | 'QUARANTINED' | 'EXCLUDED';

export interface CurrentWhitelistRecord {
  sourceSheet: '工作表1' | '飞利浦产品';
  sourceRow: number;
  sourceLocator: string;
  marketplaceCode: MarketplaceCode;
  storeName: string;
  platformProductIdentifier?: string | null;
  asin: string | null;
  productName: string;
}

export interface HistoricalProductRecord {
  sourceFolderId: string;
  sourceFileId: string;
  sourceFileTitle: string;
  sourceLocator: string;
  marketplaceCode: MarketplaceCode;
  sellerWechat?: string | null;
  channelAlias?: string | null;
  platformProductIdentifier?: string | null;
  asin: string | null;
  productName: string;
  excludedReason?: 'SELF_FULFILLMENT_STORE_REVIEWS' | 'NOT_PRODUCT_SOURCE';
}

export interface HistoricalFileInventory {
  sourceFolderId: string;
  sourceFileId: string;
  sourceFileTitle: string;
  sourceUrl: string;
  scanStatus: string;
  matchedRowCount?: number;
  productSheetName?: string | null;
  productSheetId?: string | null;
}

export interface CurrentWhitelistManifest {
  current: readonly CurrentWhitelistRecord[];
  historical: readonly HistoricalProductRecord[];
  historicalFileInventory?: readonly HistoricalFileInventory[];
}

export const CONFIRMED_HISTORICAL_SELLER_MAPPINGS = {
  dVpWHYQBqJoK: { sellerWechat: 'chenjian11063396', channelCode: 'ido-mango' },
  WKWnLbekbqpc: { sellerWechat: 'HJJ930918', channelCode: 'ygbceping' },
  dRXFJjgdKUrG: { sellerWechat: 'y1131042702', channelCode: 'ido-mango' },
  dSfeCBsvscId: { sellerWechat: 'janp168888', channelCode: 'ygbceping' },
  dvAKbRBhXYAb: { sellerWechat: 'shiguo0317', channelCode: 'ygbceping' },
  WJsydMreOyrt: { sellerWechat: 'Skulls_Yu', channelCode: 'ygbceping' },
  dBctMykPVZcF: { sellerWechat: 'sura40477687', channelCode: 'ido-mango' },
} as const satisfies Record<string, { sellerWechat: string; channelCode: ChannelCode }>;

export const CONFIRMED_CURRENT_STORE_MAPPINGS = {
  'goldhorizon direct': {
    sellerWechat: 'ls381048211',
    channelCode: 'ygbceping',
    organizationKey: 'ygbceping:ls381048211',
  },
  'philips power オフィシャル': {
    sellerWechat: 'ls381048211',
    channelCode: 'ygbceping',
    organizationKey: 'ygbceping:ls381048211',
  },
} as const satisfies Record<string, {
  sellerWechat: string;
  channelCode: ChannelCode;
  organizationKey: string;
}>;

export interface NormalizedCurrentRecord {
  sourceSheet: CurrentWhitelistRecord['sourceSheet'];
  sourceRow: number;
  sourceLocator: string;
  marketplaceCode: MarketplaceCode;
  storeName: string;
  storeNameNormalized: string;
  platformProductIdentifier: string | null;
  asinNormalized: string | null;
  productName: string | null;
  status: RowStatus;
  exceptionCode: string | null;
}

export interface NormalizedHistoricalRecord {
  sourceFolderId: string;
  sourceFileId: string;
  sourceFileTitle: string;
  sourceLocator: string;
  marketplaceCode: MarketplaceCode;
  sellerWechatDisplay: string | null;
  sellerWechatNormalized: string | null;
  channelCode: ChannelCode | null;
  platformProductIdentifier: string | null;
  asinNormalized: string | null;
  productName: string | null;
  status: RowStatus;
  exceptionCode: string | null;
  organizationKey: string | null;
}

export interface StandardProductCandidate {
  productKey: string;
  marketplaceCode: MarketplaceCode;
  platformProductIdentifier: string;
  asinNormalized: string | null;
  canonicalName: string;
  currentRows: readonly number[];
  historicalRows: readonly string[];
}

export interface SellerSupplyPreview {
  productKey: string;
  marketplaceCode: MarketplaceCode;
  platformProductIdentifier: string;
  asinNormalized: string | null;
  organizationKey: string;
  sellerWechat: string;
  channelCode: ChannelCode;
  sourceKind: 'HISTORICAL' | 'CONFIRMED_CURRENT_STORE';
  sourceRefs: readonly string[];
  currentRows: readonly number[];
}

export interface MappingAnomaly {
  code: string;
  productKey?: string;
  sourceRef?: string;
  detail: string;
}

export interface CurrentReservableProductSellerPreview {
  manifestHash: string;
  currentRows: readonly NormalizedCurrentRecord[];
  historicalRows: readonly NormalizedHistoricalRecord[];
  standardProducts: readonly StandardProductCandidate[];
  mappedSellerOfferings: readonly SellerSupplyPreview[];
  sameAsinMultiSeller: readonly string[];
  quarantinedHistorical: readonly NormalizedHistoricalRecord[];
  confirmedSellerWithoutHistory: readonly string[];
  unresolvedCurrentProducts: readonly string[];
  fieldConflicts: readonly MappingAnomaly[];
  historicalFileInventory: readonly HistoricalFileInventory[];
  unreadHistoricalFiles: readonly string[];
  counts: {
    currentSourceRows: number;
    currentValidRows: number;
    currentQuarantinedRows: number;
    currentUniqueProducts: number;
    currentAmazonAsins: number;
    currentRakutenIdentifiers: number;
    historicalFilesIndexed: number;
    historicalFilesWithRows: number;
    historicalFilesQuarantined: number;
    historicalSourceRows: number;
    historicalValidRows: number;
    historicalQuarantinedRows: number;
    mappedSellerOfferings: number;
    sameAsinMultiSeller: number;
    confirmedSellerWithoutHistory: number;
    unresolvedCurrentProducts: number;
    fieldConflicts: number;
  };
  externalCalls: 0;
  tencentDocsWrites: 0;
  databaseWrites: 0;
  loginAccountsCreated: 0;
  invitationsSent: 0;
  deployments: 0;
}

export async function previewCurrentReservableProductSellerMapping(
  manifest: CurrentWhitelistManifest,
): Promise<CurrentReservableProductSellerPreview> {
  if (!manifest || !Array.isArray(manifest.current)
    || !Array.isArray(manifest.historical)) {
    throw new Error('INVALID_MANIFEST');
  }

  const currentRows = manifest.current.map(normalizeCurrentRow);
  const historicalRows = manifest.historical.map(normalizeHistoricalRow);
  const validCurrent = currentRows.filter((row) => row.status === 'VALID');
  const validHistorical = historicalRows.filter((row) => row.status === 'VALID');
  const currentByProduct = groupByProduct(validCurrent);
  const historicalByProduct = groupByProduct(validHistorical);
  const fieldConflicts = findFieldConflicts(currentByProduct);

  const standardProducts = [...currentByProduct.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([productKey, rows]) => ({
      productKey,
      marketplaceCode: rows[0]!.marketplaceCode,
      platformProductIdentifier: rows[0]!.platformProductIdentifier!,
      asinNormalized: rows[0]!.asinNormalized,
      canonicalName: [...new Set(rows.map((row) => row.productName!))]
        .sort((left, right) => left.localeCompare(right))[0]!,
      currentRows: rows.map((row) => row.sourceRow).sort((a, b) => a - b),
      historicalRows: (historicalByProduct.get(productKey) ?? [])
        .map((row) => `${row.sourceFileId}:${row.sourceLocator}`)
        .sort(),
    }));

  const mappedSellerOfferings: SellerSupplyPreview[] = [];
  const confirmedSellerWithoutHistory: string[] = [];
  const unresolvedCurrentProducts: string[] = [];

  for (const product of standardProducts) {
    const current = currentByProduct.get(product.productKey)!;
    const historical = historicalByProduct.get(product.productKey) ?? [];
    const candidates = new Map<string, SellerSupplyPreview>();

    for (const row of historical) {
      const organizationKey = row.organizationKey!;
      const key = `${product.productKey}:${organizationKey}`;
      const prior = candidates.get(key);
      const sourceRef = `${row.sourceFileId}:${row.sourceLocator}`;
      if (prior) {
        candidates.set(key, {
          ...prior,
          sourceRefs: [...new Set([...prior.sourceRefs, sourceRef])].sort(),
          currentRows: [...new Set([...prior.currentRows,
            ...current.map((item) => item.sourceRow)])].sort((a, b) => a - b),
        });
      } else {
        candidates.set(key, {
          productKey: product.productKey,
          marketplaceCode: product.marketplaceCode,
          platformProductIdentifier: product.platformProductIdentifier,
          asinNormalized: product.asinNormalized,
          organizationKey,
          sellerWechat: row.sellerWechatDisplay!,
          channelCode: row.channelCode!,
          sourceKind: 'HISTORICAL',
          sourceRefs: [sourceRef],
          currentRows: current.map((item) => item.sourceRow).sort((a, b) => a - b),
        });
      }
    }

    for (const row of current) {
      const mapping = CONFIRMED_CURRENT_STORE_MAPPINGS[
        row.storeNameNormalized as keyof typeof CONFIRMED_CURRENT_STORE_MAPPINGS
      ];
      if (!mapping) continue;
      const key = `${product.productKey}:${mapping.organizationKey}`;
      const prior = candidates.get(key);
      if (prior) {
        candidates.set(key, {
          ...prior,
          sourceKind: 'CONFIRMED_CURRENT_STORE',
          currentRows: [...new Set([...prior.currentRows, row.sourceRow])]
            .sort((a, b) => a - b),
        });
      } else {
        candidates.set(key, {
          productKey: product.productKey,
          marketplaceCode: product.marketplaceCode,
          platformProductIdentifier: product.platformProductIdentifier,
          asinNormalized: product.asinNormalized,
          organizationKey: mapping.organizationKey,
          sellerWechat: mapping.sellerWechat,
          channelCode: mapping.channelCode,
          sourceKind: 'CONFIRMED_CURRENT_STORE',
          sourceRefs: [`current:${row.sourceSheet}:${row.sourceRow}`],
          currentRows: [row.sourceRow],
        });
      }
    }

    const offers = [...candidates.values()].sort((left, right) =>
      left.organizationKey.localeCompare(right.organizationKey));
    if (offers.length === 0) {
      unresolvedCurrentProducts.push(product.productKey);
    } else {
      const hasHistory = offers.some((offer) => offer.sourceKind === 'HISTORICAL');
      if (!hasHistory && offers.some((offer) =>
        offer.sourceKind === 'CONFIRMED_CURRENT_STORE')) {
        confirmedSellerWithoutHistory.push(product.productKey);
      }
      mappedSellerOfferings.push(...offers);
    }
  }

  const multiSellerProducts = [...new Set(mappedSellerOfferings
    .map((offer) => offer.productKey))]
    .filter((productKey) => new Set(mappedSellerOfferings
      .filter((offer) => offer.productKey === productKey)
      .map((offer) => offer.organizationKey)).size > 1)
    .sort();

  const hashInput = {
    current: currentRows,
    historical: historicalRows,
    standardProducts,
    mappedSellerOfferings,
    sameAsinMultiSeller: multiSellerProducts,
    confirmedSellerWithoutHistory: confirmedSellerWithoutHistory.sort(),
    unresolvedCurrentProducts: unresolvedCurrentProducts.sort(),
    fieldConflicts,
    historicalFileInventory: manifest.historicalFileInventory ?? [],
  };

  const historicalFileInventory = [...(manifest.historicalFileInventory ?? [])]
    .sort((left, right) => left.sourceFileId.localeCompare(right.sourceFileId));
  const unreadHistoricalFiles = historicalFileInventory
    .filter((file) => file.scanStatus !== 'MATCHED')
    .map((file) => file.sourceFileId);

  return {
    manifestHash: await sha256Hex(canonicalJson(hashInput)),
    currentRows,
    historicalRows,
    standardProducts,
    mappedSellerOfferings: mappedSellerOfferings.sort(compareOfferings),
    sameAsinMultiSeller: multiSellerProducts,
    quarantinedHistorical: historicalRows.filter((row) => row.status !== 'VALID'),
    confirmedSellerWithoutHistory: confirmedSellerWithoutHistory.sort(),
    unresolvedCurrentProducts: unresolvedCurrentProducts.sort(),
    fieldConflicts,
    historicalFileInventory,
    unreadHistoricalFiles,
    counts: {
      currentSourceRows: currentRows.length,
      currentValidRows: validCurrent.length,
      currentQuarantinedRows: currentRows.length - validCurrent.length,
      currentUniqueProducts: standardProducts.length,
      currentAmazonAsins: standardProducts.filter((product) =>
        product.marketplaceCode === 'JP_AMAZON').length,
      currentRakutenIdentifiers: standardProducts.filter((product) =>
        product.marketplaceCode === 'JP_RAKUTEN').length,
      historicalFilesIndexed: historicalFileInventory.length,
      historicalFilesWithRows: historicalFileInventory.filter((file) => file.scanStatus === 'MATCHED').length,
      historicalFilesQuarantined: unreadHistoricalFiles.length,
      historicalSourceRows: historicalRows.length,
      historicalValidRows: validHistorical.length,
      historicalQuarantinedRows: historicalRows.length - validHistorical.length,
      mappedSellerOfferings: mappedSellerOfferings.length,
      sameAsinMultiSeller: multiSellerProducts.length,
      confirmedSellerWithoutHistory: confirmedSellerWithoutHistory.length,
      unresolvedCurrentProducts: unresolvedCurrentProducts.length,
      fieldConflicts: fieldConflicts.length,
    },
    externalCalls: 0,
    tencentDocsWrites: 0,
    databaseWrites: 0,
    loginAccountsCreated: 0,
    invitationsSent: 0,
    deployments: 0,
  };
}

function normalizeCurrentRow(input: CurrentWhitelistRecord): NormalizedCurrentRecord {
  const storeName = clean(input.storeName, 200);
  const base = {
    sourceSheet: input.sourceSheet,
    sourceRow: input.sourceRow,
    sourceLocator: clean(input.sourceLocator, 500),
    marketplaceCode: input.marketplaceCode,
    storeName,
    storeNameNormalized: normalizeStoreName(storeName),
    platformProductIdentifier: null as string | null,
    asinNormalized: null as string | null,
    productName: null as string | null,
    status: 'QUARANTINED' as RowStatus,
    exceptionCode: null as string | null,
  };
  if (!['工作表1', '飞利浦产品'].includes(input.sourceSheet)
    || !['JP_AMAZON', 'JP_RAKUTEN'].includes(input.marketplaceCode)) {
    return { ...base, exceptionCode: 'INVALID_CURRENT_SOURCE' };
  }
  const rawIdentifier = input.platformProductIdentifier ?? input.asin ?? '';
  try {
    const identifier = normalizePlatformProductIdentifier(input.marketplaceCode, rawIdentifier);
    base.platformProductIdentifier = identifier;
    base.asinNormalized = input.marketplaceCode === 'JP_AMAZON' ? identifier : null;
  } catch {
    return { ...base, exceptionCode: rawIdentifier ? 'INVALID_PRODUCT_IDENTIFIER' : 'MISSING_PRODUCT_IDENTIFIER' };
  }
  try {
    base.productName = clean(input.productName, 200);
  } catch {
    return { ...base, exceptionCode: 'INVALID_PRODUCT_NAME' };
  }
  return { ...base, status: 'VALID' };
}

function normalizeHistoricalRow(input: HistoricalProductRecord): NormalizedHistoricalRecord {
  const base: NormalizedHistoricalRecord = {
    sourceFolderId: input.sourceFolderId,
    sourceFileId: input.sourceFileId,
    sourceFileTitle: input.sourceFileTitle,
    sourceLocator: input.sourceLocator,
    marketplaceCode: input.marketplaceCode,
    sellerWechatDisplay: null,
    sellerWechatNormalized: null,
    channelCode: null,
    platformProductIdentifier: null,
    asinNormalized: null,
    productName: null,
    status: 'QUARANTINED',
    exceptionCode: null,
    organizationKey: null,
  };
  if (input.excludedReason === 'SELF_FULFILLMENT_STORE_REVIEWS') {
    return { ...base, status: 'EXCLUDED', exceptionCode: 'EXCLUDED_SELF_FULFILLMENT_STORE_REVIEWS' };
  }
  if (input.excludedReason === 'NOT_PRODUCT_SOURCE') {
    return { ...base, status: 'EXCLUDED', exceptionCode: 'EXCLUDED_NOT_PRODUCT_SOURCE' };
  }
  if (!(input.sourceFolderId in FROZEN_SOURCE_FOLDERS)) {
    return { ...base, exceptionCode: 'UNKNOWN_SOURCE_FOLDER' };
  }
  const rawIdentifier = input.platformProductIdentifier ?? input.asin ?? '';
  try {
    base.platformProductIdentifier = normalizePlatformProductIdentifier(
      input.marketplaceCode, rawIdentifier,
    );
    base.asinNormalized = input.marketplaceCode === 'JP_AMAZON'
      ? base.platformProductIdentifier : null;
  } catch {
    return { ...base, exceptionCode: rawIdentifier ? 'INVALID_PRODUCT_IDENTIFIER' : 'MISSING_PRODUCT_IDENTIFIER' };
  }
  try {
    base.productName = clean(input.productName, 200);
  } catch {
    return { ...base, exceptionCode: 'INVALID_PRODUCT_NAME' };
  }
  const mapping = CONFIRMED_HISTORICAL_SELLER_MAPPINGS[
    input.sourceFileId as keyof typeof CONFIRMED_HISTORICAL_SELLER_MAPPINGS
  ];
  const sellerRaw = mapping?.sellerWechat ?? input.sellerWechat ?? null;
  if (!sellerRaw) return { ...base, exceptionCode: 'SELLER_MAPPING_UNAVAILABLE' };
  try {
    const seller = normalizeWechatId(sellerRaw);
    base.sellerWechatDisplay = seller.display;
    base.sellerWechatNormalized = seller.normalized;
  } catch {
    return { ...base, exceptionCode: 'INVALID_SELLER_WECHAT' };
  }
  const defaultChannel = FROZEN_SOURCE_FOLDERS[
    input.sourceFolderId as keyof typeof FROZEN_SOURCE_FOLDERS
  ];
  let channel: ChannelCode | undefined = mapping?.channelCode;
  if (!channel && input.channelAlias) {
    channel = CHANNEL_ALIASES[input.channelAlias.normalize('NFKC').trim()
      .toLocaleLowerCase('en-US') as keyof typeof CHANNEL_ALIASES];
    if (!channel) return { ...base, exceptionCode: 'UNKNOWN_CHANNEL_ALIAS' };
    if (channel !== defaultChannel && channel !== 'queshengai') {
      return { ...base, exceptionCode: 'FOLDER_CHANNEL_CONFLICT' };
    }
  }
  channel ??= defaultChannel;
  base.channelCode = channel;
  base.status = 'VALID';
  base.organizationKey = `${input.sourceFolderId}:${base.sellerWechatNormalized}`;
  return base;
}

function groupByProduct<T extends {
  marketplaceCode: MarketplaceCode;
  platformProductIdentifier: string | null;
  asinNormalized: string | null;
}>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.platformProductIdentifier) continue;
    const key = productKey(row.marketplaceCode, row.platformProductIdentifier);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function findFieldConflicts(
  grouped: Map<string, (NormalizedCurrentRecord | NormalizedHistoricalRecord)[]>,
): MappingAnomaly[] {
  const conflicts: MappingAnomaly[] = [];
  for (const [key, rows] of grouped) {
    const current = rows.filter((row): row is NormalizedCurrentRecord =>
      'sourceSheet' in row);
    const names = [...new Set(current.map((row) => row.productName).filter(Boolean))];
    const stores = [...new Set(current.map((row) => row.storeNameNormalized))];
    if (names.length > 1) conflicts.push({
      code: 'CURRENT_PRODUCT_NAME_CONFLICT',
      productKey: key,
      detail: names.sort().join(' | '),
    });
    if (stores.length > 1) conflicts.push({
      code: 'CURRENT_STORE_CONTEXT_CONFLICT',
      productKey: key,
      detail: stores.sort().join(' | '),
    });
  }
  return conflicts.sort(compareAnomalies);
}

function compareOfferings(left: SellerSupplyPreview, right: SellerSupplyPreview): number {
  return left.productKey.localeCompare(right.productKey)
    || left.organizationKey.localeCompare(right.organizationKey);
}

function compareAnomalies(left: MappingAnomaly, right: MappingAnomaly): number {
  return (left.productKey ?? '').localeCompare(right.productKey ?? '')
    || left.code.localeCompare(right.code)
    || left.detail.localeCompare(right.detail);
}

function productKey(marketplaceCode: MarketplaceCode, platformProductIdentifier: string): string {
  return `${marketplaceCode}:${platformProductIdentifier}`;
}

function normalizePlatformProductIdentifier(
  marketplaceCode: MarketplaceCode,
  rawIdentifier: string,
): string {
  const identifier = rawIdentifier.normalize('NFKC').trim().replace(/\s+/gu, '').toUpperCase();
  if (marketplaceCode === 'JP_RAKUTEN') {
    if (identifier === 'R-1' || identifier === 'S-1') return identifier;
    throw new Error('INVALID_RAKUTEN_PRODUCT_IDENTIFIER');
  }
  return normalizeAsin(identifier);
}

function normalizeStoreName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function clean(value: string, maximum: number): string {
  const normalized = value.normalize('NFKC').trim()
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\p{Zs}+/gu, ' ');
  if (normalized.length < 1 || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) throw new Error('INVALID_FIELD');
  return normalized;
}
