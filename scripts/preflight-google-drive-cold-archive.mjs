import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  archiveReleaseFlags,
  externalReleaseConfigPath,
  readLocalReleaseConfig,
  retiredArchiveReleaseFlags,
} from './preflight-cloudflare-release.mjs';

const scope = 'https://www.googleapis.com/auth/drive.file';
const environments = new Set(['staging', 'production']);
const secretNames = Object.freeze(['GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN']);
const sha256 = /^[a-f0-9]{64}$/u;
const commitSha = /^[a-f0-9]{40}$/u;
const safeIdentifier = /^[A-Za-z0-9._-]{1,500}$/u;
const shadowCopyEnabledFlags = archiveReleaseFlags.slice(0, 2);
const shadowCopyDisabledFlags = archiveReleaseFlags.slice(2);

export function validateColdArchiveActivation(config, environment, declaredSecrets, evidence) {
  const vars = record(config?.vars);
  const errors = [];
  if (!environments.has(environment)) return ['environment:invalid'];
  if (!vars) return ['vars:missing'];
  if (vars.APP_ENVIRONMENT !== environment) errors.push('vars.APP_ENVIRONMENT:wrong_environment');
  for (const key of ['SCHEDULED_OPERATIONS_ENABLED', ...shadowCopyEnabledFlags]) {
    if (vars[key] !== 'true') errors.push(`vars.${key}:must_be_true`);
  }
  for (const key of shadowCopyDisabledFlags) {
    if (vars[key] !== 'false') errors.push(`vars.${key}:must_remain_false`);
  }
  for (const key of retiredArchiveReleaseFlags) {
    if (Object.hasOwn(vars, key)) errors.push(`vars.${key}:deprecated`);
  }
  for (const key of ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_DRIVE_OWNER_ACCOUNT_KEY']) {
    if (typeof vars[key] !== 'string' || !safeIdentifier.test(vars[key]) || /REQUIRED|PLACEHOLDER|TODO/iu.test(vars[key])) errors.push(`vars.${key}:missing_or_invalid`);
  }
  for (const key of secretNames) {
    if (Object.hasOwn(vars, key)) errors.push(`vars.${key}:managed_secret_forbidden`);
    if (!new Set(declaredSecrets).has(key)) errors.push(`managed_secret.${key}:not_declared`);
  }
  if (!isOAuthEvidence(evidence.oauth)) errors.push('oauth_evidence:invalid');
  if (!isBackupEvidence(evidence.backup)) errors.push('backup_attestation:invalid');
  if (!isControlsEvidence(evidence.controls)) errors.push('d1_controls:shadow_copy_only_required');
  return [...new Set(errors)].sort();
}

function isOAuthEvidence(value) {
  return exactKeys(value, ['requested_scope', 'returned_scope', 'tokens_persisted', 'owner_only', 'anonymous_readback_sha256', 'resume_and_duplicate', 'revoked'])
    && value.requested_scope === scope && value.returned_scope === scope
    && value.tokens_persisted === false && value.owner_only === true
    && value.anonymous_readback_sha256 === true && value.resume_and_duplicate === true && value.revoked === true;
}
function isBackupEvidence(value) {
  return exactKeys(value, ['encrypted', 'encrypted_bundle_sha256', 'manifest_sha256', 'schema_version', 'release_commit_sha'])
    && value.encrypted === true && sha256.test(value.encrypted_bundle_sha256)
    && sha256.test(value.manifest_sha256) && Number.isSafeInteger(value.schema_version)
    && value.schema_version >= 1 && commitSha.test(value.release_commit_sha);
}
function isControlsEvidence(value) {
  return exactKeys(value, ['copy_enabled', 'proxy_read_enabled', 'r2_delete_enabled'])
    && value.copy_enabled === 1 && value.proxy_read_enabled === 0 && value.r2_delete_enabled === 0;
}
function exactKeys(value, keys) {
  const item = record(value);
  return item !== null && Object.keys(item).length === keys.length && keys.every((key) => Object.hasOwn(item, key));
}
function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function privateExternalFile(value, label) {
  const input = externalReleaseConfigPath(value);
  if (!input.file) return { file: null, error: `${label}:${input.error}` };
  try { return (statSync(input.file).mode & 0o077) === 0 ? { file: input.file, error: null } : { file: null, error: `${label}:not_owner_private` }; } catch { return { file: null, error: `${label}:unreadable` }; }
}
function parseEvidence(file, validator) {
  try { const value = JSON.parse(readFileSync(file, 'utf8')); return validator(value) ? value : null; } catch { return null; }
}
function parseArgs(values) {
  const output = { secrets: [] };
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith('--')) throw new Error('arguments:invalid');
    if (key === '--declared-secret') { output.secrets.push(values[index + 1] ?? ''); index += 1; continue; }
    const value = values[index + 1];
    if (!value || value.startsWith('--') || !['--environment', '--config', '--oauth-evidence', '--backup-evidence', '--d1-controls'].includes(key)) throw new Error('arguments:invalid');
    output[key.slice(2)] = value; index += 1;
  }
  return output;
}
function print(status, environment, errors) {
  console.log(JSON.stringify({ status, environment, required_managed_secret_names: secretNames, errors: [...new Set(errors)].sort(), external_calls: 0, provider_calls: 0, d1_calls: 0, r2_calls: 0, resource_mutations: 0 }, null, 2));
  if (status === 'BLOCKED') process.exitCode = 1;
}
function main() {
  let input; try { input = parseArgs(process.argv.slice(2)); } catch { print('BLOCKED', null, ['arguments:invalid']); return; }
  if (!environments.has(input.environment)) { print('BLOCKED', input.environment ?? null, ['environment:invalid']); return; }
  if (!input.config) { print('LOCAL_NO_GO', input.environment, ['external_evidence_not_supplied']); return; }
  const files = {}; const errors = [];
  for (const [key, label] of [['config', 'config'], ['oauth-evidence', 'oauth_evidence'], ['backup-evidence', 'backup_evidence'], ['d1-controls', 'd1_controls']]) {
    const result = privateExternalFile(input[key], label); if (!result.file) errors.push(result.error); else files[key] = result.file;
  }
  if (errors.length) { print('BLOCKED', input.environment, errors); return; }
  const oauth = parseEvidence(files['oauth-evidence'], isOAuthEvidence);
  const backup = parseEvidence(files['backup-evidence'], isBackupEvidence);
  const controls = parseEvidence(files['d1-controls'], isControlsEvidence);
  if (!oauth) errors.push('oauth_evidence:invalid_or_sensitive'); if (!backup) errors.push('backup_evidence:invalid_or_sensitive'); if (!controls) errors.push('d1_controls:invalid_or_sensitive');
  let config; try { config = readLocalReleaseConfig(files.config); } catch { errors.push('config:unreadable_or_invalid'); }
  if (!errors.length) errors.push(...validateColdArchiveActivation(config, input.environment, input.secrets, { oauth, backup, controls }));
  print(errors.length ? 'BLOCKED' : 'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO', input.environment, errors);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
