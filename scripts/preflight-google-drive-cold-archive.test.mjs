import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve('scripts/preflight-google-drive-cold-archive.mjs');
const scope = 'https://www.googleapis.com/auth/drive.file';
const config = { vars: { APP_ENVIRONMENT: 'production', SCHEDULED_OPERATIONS_ENABLED: 'true', DRIVE_ARCHIVE_ENABLED: 'true', DRIVE_ARCHIVE_COPY_ENABLED: 'true', DRIVE_ARCHIVE_PROXY_READ_ENABLED: 'false', DRIVE_ARCHIVE_R2_DELETE_ENABLED: 'false', GOOGLE_DRIVE_CLIENT_ID: 'anonymous-client', GOOGLE_DRIVE_FOLDER_ID: 'anonymous-folder', GOOGLE_DRIVE_OWNER_ACCOUNT_KEY: 'anonymous-owner' } };
const oauth = { requested_scope: scope, returned_scope: scope, tokens_persisted: false, owner_only: true, anonymous_readback_sha256: true, resume_and_duplicate: true, revoked: true };
const backup = { encrypted: true, encrypted_bundle_sha256: 'a'.repeat(64), manifest_sha256: 'b'.repeat(64), schema_version: 43, release_commit_sha: 'c'.repeat(40) };
const controls = { copy_enabled: 1, proxy_read_enabled: 0, r2_delete_enabled: 0 };

describe('cold archive production preflight CLI', () => {
  it('accepts external private shadow-copy evidence with zero calls', () => withinPrivateFiles((files) => {
    const result = run(files);
    expect(result.status).toBe(0);
    expect(json(result)).toMatchObject({ status: 'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO', errors: [], external_calls: 0, provider_calls: 0, d1_calls: 0, r2_calls: 0, resource_mutations: 0 });
  }));
  it('blocks widened scope and sensitive extra evidence fields', () => withinPrivateFiles((files) => {
    write(files.oauth, { ...oauth, returned_scope: 'https://www.googleapis.com/auth/drive' });
    expect(json(run(files)).errors).toContain('oauth_evidence:invalid_or_sensitive');
    write(files.oauth, { ...oauth, access_token: 'must-not-be-accepted' });
    expect(json(run(files)).errors).toContain('oauth_evidence:invalid_or_sensitive');
  }));
  it('blocks repository paths and non-private evidence', () => withinPrivateFiles((files) => {
    expect(json(run({ ...files, oauth: path.resolve('package.json') })).errors).toContain('oauth_evidence:config_path:repository_location_forbidden');
    chmodSync(files.backup, 0o644);
    expect(json(run(files)).errors).toContain('backup_evidence:not_owner_private');
  }));
  it('blocks proxy-read or deletion during initial activation', () => withinPrivateFiles((files) => {
    write(files.config, { vars: { ...config.vars, DRIVE_ARCHIVE_PROXY_READ_ENABLED: 'true', DRIVE_ARCHIVE_R2_DELETE_ENABLED: 'true' } });
    expect(json(run(files)).errors).toEqual(expect.arrayContaining(['vars.DRIVE_ARCHIVE_PROXY_READ_ENABLED:must_remain_false', 'vars.DRIVE_ARCHIVE_R2_DELETE_ENABLED:must_remain_false']));
  }));
});
function withinPrivateFiles(callback) { const directory = mkdtempSync(path.join(tmpdir(), 'ygb-drive-preflight-')); chmodSync(directory, 0o700); const files = { config: path.join(directory, 'config.json'), oauth: path.join(directory, 'oauth.json'), backup: path.join(directory, 'backup.json'), controls: path.join(directory, 'controls.json') }; try { write(files.config, config); write(files.oauth, oauth); write(files.backup, backup); write(files.controls, controls); return callback(files); } finally { rmSync(directory, { recursive: true, force: true }); } }
function write(file, value) { writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); chmodSync(file, 0o600); }
function run(files) { return spawnSync(process.execPath, [script, '--environment', 'production', '--config', files.config, '--oauth-evidence', files.oauth, '--backup-evidence', files.backup, '--d1-controls', files.controls, '--declared-secret', 'GOOGLE_DRIVE_CLIENT_SECRET', '--declared-secret', 'GOOGLE_DRIVE_REFRESH_TOKEN'], { encoding: 'utf8' }); }
function json(result) { return JSON.parse(result.stdout); }
