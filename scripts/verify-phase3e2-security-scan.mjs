import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const fail = (message) => { throw new Error(message); };

const buyerFiles = [
  'packages/contracts/src/buyer-portal.ts',
  'apps/api/src/buyer-portal/read-model.ts',
];
for (const relative of buyerFiles) {
  const source = read(relative);
  for (const forbidden of [
    /search_keywords/iu,
    /product_url/iu,
    /\basin\b/iu,
    /object_key/iu,
    /signed_url/iu,
    /public_url/iu,
  ]) {
    if (forbidden.test(source)) {
      fail(`buyer projection leak in ${relative}: ${forbidden}`);
    }
  }
}

const migration = read('migrations/0019_product_ordering_profiles.sql');
for (const required of [
  'ordering_guide_expected_amount_jpy INTEGER',
  "color_spec_mode IN ('MAIN_IMAGE_VARIANT', 'ANY_VARIANT')",
  "'PRODUCT_IMAGE'",
  "'PRODUCT_VERSION'",
  'CREATE TABLE product_version_main_images',
  'trg_product_version_main_images_no_update',
  'trg_product_version_main_images_no_delete',
]) {
  if (!migration.includes(required)) fail(`migration missing ${required}`);
}
if (/ordering_guide_expected_amount_jpy\s+REAL/iu.test(migration)) {
  fail('expected JPY amount uses REAL');
}
for (const forbidden of [
  'product_ordering_profile_versions',
  'ordering_profile_version_no',
  'product_info_status',
  'ordering_profile_status',
  'seller_wechat',
  'display_wechat',
  'wechat_identity_claim',
]) {
  if (migration.includes(forbidden)) fail(`forbidden schema value: ${forbidden}`);
}

const catalog = read('packages/contracts/src/catalog.ts');
if (!catalog.includes('ProductVersionFields')) fail('catalog contract missing product version fields');
for (const mode of ['MAIN_IMAGE_VARIANT', 'ANY_VARIANT']) {
  if (!catalog.includes(mode)) fail(`catalog contract missing ${mode}`);
}

const mainImageService = read(
  'apps/api/src/catalog/link-product-version-main-image.ts',
);
for (const forbidden of [
  /object_key/iu,
  /signed_url/iu,
  /public_url/iu,
  /https?:\/\//iu,
]) {
  if (forbidden.test(mainImageService)) {
    fail(`main image business result contains ${forbidden}`);
  }
}
if (!mainImageService.includes("requireCatalogPermission(command.actor, 'PRODUCT_REVIEW')")) {
  fail('main image command does not use PRODUCT_REVIEW');
}

const sellerContract = read('packages/contracts/src/seller-portal.ts');
for (const forbidden of [
  /seller_wechat/iu,
  /display_wechat/iu,
  /wechat_identity_claim/iu,
  /object_key/iu,
  /signed_url/iu,
  /public_url/iu,
]) {
  if (forbidden.test(sellerContract)) {
    fail(`seller DTO leak: ${forbidden}`);
  }
}

for (const relative of [
  'apps/api/src/formal-orders/confirm-formal-order.ts',
  'apps/api/src/buyer-formal-orders/read-model.ts',
  'apps/api/src/seller-formal-orders/read-model.ts',
]) {
  const source = read(relative);
  if (source.includes('ordering_guide_expected_amount_jpy')
    || source.includes('color_spec_mode')) {
    fail(`formal order regression: ${relative} reads current ordering profile`);
  }
}

const repositorySources = [
  read('packages/contracts/src/catalog.ts'),
  read('packages/domain/src/catalog/product-version.ts'),
  migration,
].join('\n');
for (const forbidden of [
  'product_ordering_profile_versions',
  'ordering_profile_version_no',
]) {
  if (repositorySources.includes(forbidden)) {
    fail(`second product version system detected: ${forbidden}`);
  }
}

console.log(JSON.stringify({
  status: 'PASS',
  buyer_projection_fields_removed: [
    'asin',
    'product_url',
    'search_keywords',
    'search_keywords_json',
  ],
  permanent_file_urls_absent: true,
  object_keys_absent_from_business_dtos: true,
  expected_amount_storage: 'INTEGER',
  duplicate_product_version_system: false,
  seller_wechat_projection: false,
  formal_order_current_profile_dependency: false,
}, null, 2));
