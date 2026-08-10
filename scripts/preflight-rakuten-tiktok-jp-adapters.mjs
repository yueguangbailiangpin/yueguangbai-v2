import { pathToFileURL } from 'node:url';
import {
  externalReleaseConfigPath,
  readLocalReleaseConfig,
} from './preflight-cloudflare-release.mjs';

export const tiktokShopManagedSecretNames = Object.freeze([
  'TIKTOK_SHOP_APP_SECRET',
  'TIKTOK_SHOP_ACCESS_TOKEN',
  'TIKTOK_SHOP_REFRESH_TOKEN',
  'TIKTOK_SHOP_SHOP_CIPHER',
]);

/** Onboarding/authorization mapping plus the two read-adapter capabilities. */
export const tiktokShopRequiredPreparationScopes = Object.freeze([
  'seller.authorization.info',
  'seller.order.info',
  'seller.product.basic',
]);

const counterFields = Object.freeze({
  external_calls: 0,
  provider_calls: 0,
  resource_mutations: 0,
  secret_reads: 0,
  secret_writes: 0,
  deployments: 0,
});

export function inspectMarketplaceAdapterPreparation() {
  return Object.freeze({
    status: 'LOCAL_IMPLEMENTATION_READY_PRODUCTION_NO_GO',
    migration_decision: 'NO_SCHEMA_CHANGE',
    registry_status: Object.freeze({
      RAKUTEN_JP: 'UNAVAILABLE',
      TIKTOK_JP: 'UNAVAILABLE',
    }),
    production_routes_registered: 0,
    scheduled_jobs_registered: 0,
    platform_write_methods: 0,
    required_tiktok_managed_secret_names: tiktokShopManagedSecretNames,
    blockers: Object.freeze([
      'rakuten_current_official_wire_contract_blocked',
      'rakuten_production_adapter_network_inert',
      'real_tiktok_authorized_shop_acceptance_absent',
      'real_tiktok_granted_scopes_not_checked',
      'real_callback_registration_absent',
      'durable_webhook_receipt_and_replay_absent',
      'durable_poll_cursor_and_job_absent',
      'durable_app_shop_endpoint_rate_limiter_absent',
      'canonical_ingestion_service_absent',
      'owner_activation_approval_absent',
    ]),
    ...counterFields,
  });
}

export function validateMarketplaceAdapterActivationManifest(
  manifest,
  environment,
  declaredSecretNames = [],
) {
  const errors = [];
  const root = exactRecord(manifest, [
    'schema_version',
    'environment',
    'external_writes_allowed',
    'owner_activation_approval_recorded',
    'tiktok',
    'rakuten',
  ], 'manifest', errors);
  if (!root) return Object.freeze(uniqueSorted(errors));
  if (root.schema_version !== 1) errors.push('manifest.schema_version:invalid');
  if (root.environment !== environment) errors.push('manifest.environment:mismatch');
  if (root.external_writes_allowed !== false) {
    errors.push('manifest.external_writes_allowed:must_be_false');
  }
  if (root.owner_activation_approval_recorded !== true) {
    errors.push('manifest.owner_activation_approval_recorded:missing');
  }
  validateTikTok(root.tiktok, errors);
  validateRakuten(root.rakuten, errors);
  const declared = new Set(declaredSecretNames);
  for (const name of tiktokShopManagedSecretNames) {
    if (!declared.has(name)) errors.push(`managed_secret.${name}:not_declared`);
  }
  for (const name of declared) {
    if (!tiktokShopManagedSecretNames.includes(name)) {
      errors.push('managed_secret:unexpected_name');
    }
  }
  return Object.freeze(uniqueSorted(errors));
}

function validateTikTok(value, errors) {
  const record = exactRecord(value, [
    'market',
    'seller_type',
    'application_type',
    'app_registration_reviewed',
    'development_shop_authorized',
    'authorized_shop_mapping_reviewed',
    'app_key_reference_recorded',
    'granted_scopes',
    'callback_origin',
    'callback_domain_control_verified',
    'clock_sync_evidence_recorded',
    'order_search_version',
    'product_search_version',
    'platform_writes_enabled',
  ], 'tiktok', errors);
  if (!record) return;
  if (record.market !== 'JP') errors.push('tiktok.market:must_be_JP');
  if (!['LOCAL', 'CROSS_BORDER'].includes(record.seller_type)) {
    errors.push('tiktok.seller_type:invalid');
  }
  if (!['CUSTOM', 'PUBLIC'].includes(record.application_type)) {
    errors.push('tiktok.application_type:invalid');
  }
  for (const key of [
    'app_registration_reviewed',
    'development_shop_authorized',
    'authorized_shop_mapping_reviewed',
    'app_key_reference_recorded',
    'callback_domain_control_verified',
    'clock_sync_evidence_recorded',
  ]) {
    if (record[key] !== true) errors.push(`tiktok.${key}:missing`);
  }
  if (record.order_search_version !== '202309') {
    errors.push('tiktok.order_search_version:must_be_202309');
  }
  if (record.product_search_version !== '202502') {
    errors.push('tiktok.product_search_version:must_be_202502');
  }
  if (record.platform_writes_enabled !== false) {
    errors.push('tiktok.platform_writes_enabled:must_be_false');
  }
  const scopes = exactStringSet(record.granted_scopes);
  if (!scopes || scopes.size !== tiktokShopRequiredPreparationScopes.length
    || tiktokShopRequiredPreparationScopes.some((scope) => !scopes.has(scope))) {
    errors.push('tiktok.granted_scopes:exact_preparation_set_required');
  }
  if (!officialCallbackOrigin(record.callback_origin)) {
    errors.push('tiktok.callback_origin:invalid');
  }
}

function validateRakuten(value, errors) {
  const record = exactRecord(value, [
    'integration_mode',
    'active_store_contract_verified',
    'test_shop_allocated',
    'official_spec_bundle_revision_recorded',
    'official_spec_bundle_sha256',
    'order_read_scope_approved',
    'product_read_scope_approved',
    'platform_writes_enabled',
  ], 'rakuten', errors);
  if (!record) return;
  if (!['MERCHANT_INTERNAL', 'SYSTEM_DEVELOPMENT_PARTNER'].includes(
    record.integration_mode,
  )) errors.push('rakuten.integration_mode:invalid');
  for (const key of [
    'active_store_contract_verified',
    'test_shop_allocated',
    'official_spec_bundle_revision_recorded',
    'order_read_scope_approved',
    'product_read_scope_approved',
  ]) {
    if (record[key] !== true) errors.push(`rakuten.${key}:missing`);
  }
  if (!/^[0-9a-f]{64}$/u.test(String(record.official_spec_bundle_sha256 ?? ''))) {
    errors.push('rakuten.official_spec_bundle_sha256:invalid');
  }
  if (record.platform_writes_enabled !== false) {
    errors.push('rakuten.platform_writes_enabled:must_be_false');
  }
}

function exactRecord(value, keys, prefix, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${prefix}:not_object`);
    return null;
  }
  const actual = Object.keys(value);
  for (const key of actual) {
    if (!keys.includes(key)) errors.push(`${prefix}:unexpected_field`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) errors.push(`${prefix}.${key}:missing`);
  }
  return value;
}

function exactStringSet(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return null;
  }
  return new Set(value);
}

function officialCallbackOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && !url.username
      && !url.password
      && url.port === ''
      && !ipLiteral(url.hostname)
      && url.hostname.includes('.');
  } catch {
    return false;
  }
}

function ipLiteral(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value) || value.includes(':');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function main(argv) {
  const environmentIndex = argv.indexOf('--environment');
  const environment = environmentIndex >= 0 ? argv[environmentIndex + 1] : null;
  const manifestIndex = argv.indexOf('--manifest');
  if (argv.includes('--inspect')) {
    if (manifestIndex >= 0) {
      printFailure(['arguments:inspect_and_manifest_are_mutually_exclusive']);
      return;
    }
    process.stdout.write(`${JSON.stringify(inspectMarketplaceAdapterPreparation())}\n`);
    return;
  }
  if (manifestIndex < 0) {
    printFailure(['manifest:required']);
    return;
  }
  if (!['staging', 'production'].includes(environment)) {
    printFailure(['environment:invalid']);
    return;
  }
  const resolved = externalReleaseConfigPath(argv[manifestIndex + 1]);
  if (resolved.error || !resolved.file) {
    printFailure([resolved.error ?? 'config_path:invalid']);
    return;
  }
  let manifest;
  try {
    manifest = readLocalReleaseConfig(resolved.file);
  } catch {
    printFailure(['manifest:unreadable_or_invalid']);
    return;
  }
  const declared = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--declared-secret' && argv[index + 1]) {
      declared.push(argv[index + 1]);
    }
  }
  const errors = validateMarketplaceAdapterActivationManifest(
    manifest,
    environment,
    declared,
  );
  process.stdout.write(`${JSON.stringify({
    status: errors.length === 0
      ? 'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO'
      : 'BLOCKED',
    environment,
    migration_decision: 'NO_SCHEMA_CHANGE',
    errors,
    blockers: [
      'rakuten_adapter_requires_review_against_owner_spec_bundle',
      'real_provider_acceptance_absent',
      'callback_and_polling_not_registered',
      'durable_replay_cursor_and_ingestion_absent',
      'registry_adapters_remain_unavailable',
    ],
    ...counterFields,
  })}\n`);
  if (errors.length > 0) process.exitCode = 1;
}

function printFailure(errors) {
  process.stdout.write(`${JSON.stringify({
    status: 'BLOCKED',
    errors,
    ...counterFields,
  })}\n`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2));
}
