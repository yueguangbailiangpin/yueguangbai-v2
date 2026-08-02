import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => readFileSync(join(root, path), 'utf8');
function walk(directory) {
  return readdirSync(join(root, directory)).flatMap((name) => {
    if (name === 'node_modules' || name === '.git') return [];
    const path = join(directory, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });
}
function requirePattern(label, text, pattern) {
  if (!pattern.test(text)) failures.push(label);
}
function forbidPattern(label, text, pattern) {
  if (pattern.test(text)) failures.push(label);
}

const migrationNames = readdirSync(join(root, 'migrations'));
const phase3gMigrations = migrationNames.filter((name) => /^0021_/u.test(name));
if (phase3gMigrations.length !== 1
  || phase3gMigrations[0] !== '0021_order_instructions.sql') {
  failures.push('0021_must_be_the_only_phase3g_migration');
}
if (migrationNames.some((name) => /^002[2-9]_/u.test(name))) {
  failures.push('migration_above_0021');
}

const migration = read('migrations/0021_order_instructions.sql');
requirePattern('schema_20_to_21', migration,
  /schema_version=20[\s\S]*schema_version=21/u);
requirePattern('bps_allows_10000', migration,
  /buyer_self_pay_bps[\s\S]{0,180}BETWEEN 0 AND 10000/u);
forbidPattern('bps_9999_upper_bound', migration,
  /buyer_self_pay_bps[\s\S]{0,180}(?:9999|<\s*10000)/u);
requirePattern('future_evidence_guard', migration,
  /trg_order_evidence_instruction_snapshot_guard/u);
requirePattern('historical_marker_required_for_null_evidence', migration,
  /NEW\.evidence_file_object_id IS NULL[\s\S]{0,500}HISTORICAL_EVIDENCE_CONTEXT/u);
requirePattern('formal_finance_self_pay_guard', migration,
  /trg_formal_order_financial_self_pay_guard/u);
requirePattern('active_order_number_uniqueness', migration,
  /CREATE UNIQUE INDEX uq_formal_order_number_claims_active/u);

const sourceFiles = ['apps', 'packages']
  .flatMap(walk)
  .filter((path) => /\.(?:ts|tsx)$/u.test(path) && !path.endsWith('.test.ts'));
const source = sourceFiles.map(read).join('\n');
forbidPattern('arbitrary_first_team_authorization', source,
  /memberTeamIds\s*\[\s*0\s*\]/u);
const instructionSource = walk('apps/api/src/order-instructions')
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
  .map(read).join('\n');
forbidPattern('public_task_pool_or_claim_api', instructionSource,
  /(?:PUBLIC_TASK_POOL|CLAIM_TASK|TASK_CLAIM|claim-task)/u);

const fileRead = read('apps/api/src/files/file-read-service.ts');
const dynamicChecks = fileRead.match(
  /requireDynamicInstructionReadAuthorization\s*\(/gu,
)?.length ?? 0;
if (dynamicChecks < 2) failures.push('dynamic_instruction_auth_on_create_and_consume');
requirePattern('dynamic_current_version_check', fileRead, /current_version_no/u);
requirePattern('dynamic_formal_order_check', fileRead, /formal_orders/u);

const contentHash = read(
  'packages/domain/src/order-instructions/canonical-content.ts',
);
for (const field of [
  'product_name_snapshot',
  'main_image_sha256',
  'ordered_keyword_hmac_digests',
  'buyer_self_pay_bps',
  'reference_order_amount_jpy',
]) {
  requirePattern(`content_hash:${field}`, contentHash, new RegExp(field, 'u'));
}
forbidPattern('plaintext_keyword_in_content_hash', contentHash,
  /keyword_(?:text|plaintext)|search_keywords/u);

const formalContract = read('packages/contracts/src/formal-order.ts');
for (const field of [
  'buyer_self_pay_bps',
  'buyer_self_pay_jpy',
  'buyer_refundable_principal_jpy',
  'buyer_gross_principal_cny_fen',
  'buyer_self_pay_contribution_cny_fen',
]) {
  requirePattern(`formal_contract:${field}`, formalContract,
    new RegExp(`\\b${field}\\b`, 'u'));
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  source_files: sourceFiles.length,
  dynamic_instruction_checks: dynamicChecks,
}, null, 2));
