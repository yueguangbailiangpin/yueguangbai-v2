import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `
      import { fullReadonlyManifest } from ${JSON.stringify(
        path.resolve('apps/api/src/current-reservable-product-seller-mapping/fixtures/full-readonly-manifest.mjs'),
      )};
      import { previewCurrentReservableProductSellerMapping } from ${JSON.stringify(
        path.resolve('apps/api/src/current-reservable-product-seller-mapping/index.ts'),
      )};
      export { fullReadonlyManifest, previewCurrentReservableProductSellerMapping };
    `,
    resolveDir: process.cwd(),
    sourcefile: 'current-reservable-product-seller-mapping-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'current-product-mapping-'));
const temporaryModule = path.join(temporaryDirectory, 'entry.mjs');
writeFileSync(temporaryModule, bundle.outputFiles[0].text);
const {
  fullReadonlyManifest,
  previewCurrentReservableProductSellerMapping,
} = await import(pathToFileURL(temporaryModule).href);
const preview = await previewCurrentReservableProductSellerMapping(fullReadonlyManifest);
console.log(JSON.stringify({
  status: 'LOCAL_READONLY_PREVIEW',
  manifest_hash: preview.manifestHash,
  counts: preview.counts,
  current_products: preview.standardProducts.map((product) => ({
    product_key: product.productKey,
    marketplace_code: product.marketplaceCode,
    platform_product_identifier: product.platformProductIdentifier,
    current_rows: product.currentRows,
    mapped_offerings: preview.mappedSellerOfferings.filter((offer) =>
      offer.productKey === product.productKey),
    status: preview.unresolvedCurrentProducts.includes(product.productKey)
      ? 'UNRESOLVED' : 'MAPPED',
  })),
  quarantined_current_rows: preview.currentRows.filter((row) => row.status !== 'VALID'),
  field_conflicts: preview.fieldConflicts,
  historical_file_inventory: preview.historicalFileInventory,
  unread_historical_files: preview.unreadHistoricalFiles,
  same_asins_multi_seller: preview.sameAsinMultiSeller,
  confirmed_seller_without_history: preview.confirmedSellerWithoutHistory,
  unresolved_current_products: preview.unresolvedCurrentProducts,
  external_calls: preview.externalCalls,
  tencent_docs_writes: preview.tencentDocsWrites,
  database_writes: preview.databaseWrites,
  login_accounts_created: preview.loginAccountsCreated,
  invitations_sent: preview.invitationsSent,
  deployments: preview.deployments,
}, null, 2));
rmSync(temporaryDirectory, { recursive: true, force: true });
