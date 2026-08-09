import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_LEGACY_AUTH_URI = 'https://accounts.google.com/o/oauth2/auth';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URI = 'https://oauth2.googleapis.com/revoke';
const DRIVE_API_URI = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_URI = 'https://www.googleapis.com/upload/drive/v3';
const CALLBACK_PATH = '/oauth2/callback';
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..'
    && !path.isAbsolute(relative));
}

function assertPrivateDirectory(directory) {
  const stats = lstatSync(directory, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) throw new Error('private_directory_missing');
  if ((stats.mode & 0o077) !== 0) throw new Error('private_directory_permissions');
}

function assertPrivateFile(filePath, { mustExist, rejectDownloads = false } = {}) {
  const resolved = path.resolve(filePath);
  if (isWithin(REPOSITORY_ROOT, resolved)) throw new Error('credential_path_inside_repository');
  if (rejectDownloads && resolved.split(path.sep).includes('Downloads')) {
    throw new Error('credential_path_in_downloads');
  }
  if (mustExist) {
    const stats = lstatSync(resolved, { throwIfNoEntry: false });
    if (!stats?.isFile()) throw new Error('credential_file_missing');
    if ((stats.mode & 0o077) !== 0) throw new Error('credential_file_permissions');
  } else {
    if (existsSync(resolved)) throw new Error('evidence_file_exists');
  }
  assertPrivateDirectory(path.dirname(resolved));
  return resolved;
}

function assertGoogleEndpoint(value, expected) {
  if (value !== expected) throw new Error('unsupported_google_endpoint');
}

export function parseDesktopClientConfig(value) {
  const installed = value?.installed;
  if (!installed || typeof installed !== 'object') throw new Error('desktop_client_config_required');
  if (installed.auth_uri !== GOOGLE_AUTH_URI && installed.auth_uri !== GOOGLE_LEGACY_AUTH_URI) {
    throw new Error('unsupported_google_endpoint');
  }
  assertGoogleEndpoint(installed.token_uri, GOOGLE_TOKEN_URI);
  if (typeof installed.client_id !== 'string' || installed.client_id.length < 8) {
    throw new Error('desktop_client_id_missing');
  }
  return Object.freeze({
    authUri: installed.auth_uri,
    clientId: installed.client_id,
    clientSecret: typeof installed.client_secret === 'string' ? installed.client_secret : null,
    tokenUri: installed.token_uri,
  });
}

export function readDesktopClientConfig(filePath) {
  const resolved = assertPrivateFile(filePath, { mustExist: true, rejectDownloads: true });
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch {
    throw new Error('desktop_client_json_invalid');
  }
  return parseDesktopClientConfig(parsed);
}

export function createPkcePair() {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return Object.freeze({ verifier, challenge });
}

export function buildAuthorizationUrl({ authUri = GOOGLE_AUTH_URI, clientId, redirectUri, state, challenge }) {
  const url = new URL(authUri);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DRIVE_FILE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url;
}

export function exactDriveFileScope(scope) {
  const scopes = String(scope ?? '').trim().split(/\s+/u).filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== DRIVE_FILE_SCOPE) {
    throw new Error('oauth_scope_not_exact_drive_file');
  }
  return Object.freeze(scopes);
}

export function parseUploadRange(value) {
  const match = /^bytes=0-(\d+)$/u.exec(String(value ?? ''));
  return match ? Number(match[1]) : null;
}

function safeJson(response) {
  return response.json().catch(() => ({}));
}

function errorCode(payload) {
  const value = typeof payload?.error === 'string' ? payload.error : '';
  return /^[a-z0-9_.-]{1,80}$/iu.test(value) ? value : 'provider_error';
}

async function exchangeCode(client, code, redirectUri, verifier, fetchImpl) {
  const body = new URLSearchParams({
    client_id: client.clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  const response = await fetchImpl(client.tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await safeJson(response);
  if (!response.ok || typeof payload.access_token !== 'string'
    || typeof payload.refresh_token !== 'string') {
    throw new Error(`oauth_code_exchange_failed:${response.status}:${errorCode(payload)}`);
  }
  return Object.freeze({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    scope: exactDriveFileScope(payload.scope),
  });
}

function driveUrl(pathname, search = {}) {
  const url = new URL(`${DRIVE_API_URI}${pathname}`);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  return url;
}

function uploadUrl(pathname, search = {}) {
  const url = new URL(`${DRIVE_UPLOAD_URI}${pathname}`);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  return url;
}

async function driveJson(accessToken, request, fetchImpl) {
  const response = await fetchImpl(request.url, {
    method: request.method ?? 'GET',
    headers: { authorization: `Bearer ${accessToken}`, ...request.headers },
    body: request.body,
  });
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(`drive_request_failed:${response.status}:${errorCode(payload)}`);
  return payload;
}

async function createTestFolder(accessToken, fetchImpl) {
  return driveJson(accessToken, {
    method: 'POST',
    url: driveUrl('/files', { fields: 'id' }),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mimeType: 'application/vnd.google-apps.folder',
      name: `ygb-oauth-pkce-poc-${randomUUID().slice(0, 8)}`,
    }),
  }, fetchImpl);
}

async function resumableUpload(accessToken, folderId, fixture, fetchImpl, fileName) {
  const initResponse = await fetchImpl(uploadUrl('/files', {
    fields: 'id',
    uploadType: 'resumable',
  }), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(fixture.length),
      'x-upload-content-type': 'application/octet-stream',
    },
    body: JSON.stringify({
      mimeType: 'application/octet-stream',
      name: fileName,
      parents: [folderId],
    }),
  });
  if (!initResponse.ok) {
    const payload = await safeJson(initResponse);
    throw new Error(`resumable_session_failed:${initResponse.status}:${errorCode(payload)}`);
  }
  const sessionUri = initResponse.headers.get('location');
  if (!sessionUri) throw new Error('resumable_session_location_missing');

  const split = 256 * 1024;
  const first = fixture.subarray(0, split);
  const firstResponse = await fetchImpl(sessionUri, {
    method: 'PUT',
    headers: {
      'content-length': String(first.length),
      'content-range': `bytes 0-${first.length - 1}/*`,
    },
    body: first,
  });
  const confirmedOffset = parseUploadRange(firstResponse.headers.get('range'));
  if (firstResponse.status !== 308 || confirmedOffset !== first.length - 1) {
    throw new Error(`resumable_first_chunk_failed:${firstResponse.status}`);
  }

  const final = fixture.subarray(confirmedOffset + 1);
  const finalResponse = await fetchImpl(sessionUri, {
    method: 'PUT',
    headers: {
      'content-length': String(final.length),
      'content-range': `bytes ${confirmedOffset + 1}-${fixture.length - 1}/${fixture.length}`,
    },
    body: final,
  });
  const finalPayload = await safeJson(finalResponse);
  if (!finalResponse.ok || typeof finalPayload.id !== 'string') {
    throw new Error(`resumable_final_chunk_failed:${finalResponse.status}:${errorCode(finalPayload)}`);
  }
  return Object.freeze({
    first_chunk_status: firstResponse.status,
    confirmed_offset: confirmedOffset,
    final_status: finalResponse.status,
    file_id: finalPayload.id,
  });
}

async function verifyPrivatePermissions(accessToken, fileId, fetchImpl) {
  const metadata = await driveJson(accessToken, {
    url: driveUrl(`/files/${encodeURIComponent(fileId)}`, {
      fields: 'shared,permissions(type,role)',
    }),
  }, fetchImpl);
  const permissions = Array.isArray(metadata.permissions) ? metadata.permissions : [];
  if (metadata.shared === true || permissions.length === 0
    || !permissions.some((permission) => permission.type === 'user' && permission.role === 'owner')
    || permissions.some((permission) => permission.type !== 'user' || permission.role !== 'owner')) {
    throw new Error('drive_private_permission_mismatch');
  }
  return true;
}

async function verifyReadback(accessToken, fileId, fixture, fetchImpl) {
  const metadata = await driveJson(accessToken, {
    url: driveUrl(`/files/${encodeURIComponent(fileId)}`, {
      fields: 'size,mimeType,trashed',
    }),
  }, fetchImpl);
  const response = await fetchImpl(driveUrl(`/files/${encodeURIComponent(fileId)}`, {
    alt: 'media',
  }), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`drive_readback_failed:${response.status}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  const expectedHash = createHash('sha256').update(fixture).digest('hex');
  const actualHash = createHash('sha256').update(downloaded).digest('hex');
  if (downloaded.length !== fixture.length || actualHash !== expectedHash
    || metadata.size !== String(fixture.length)
    || metadata.mimeType !== 'application/octet-stream' || metadata.trashed === true) {
    throw new Error('drive_readback_mismatch');
  }
  return Object.freeze({
    bytes: downloaded.length,
    mime_type: metadata.mimeType,
    sha256: actualHash,
  });
}

async function deleteCreatedObject(accessToken, fileId, fetchImpl) {
  if (!fileId) return false;
  const response = await fetchImpl(driveUrl(`/files/${encodeURIComponent(fileId)}`), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`test_object_cleanup_failed:${response.status}`);
  }
  return true;
}

async function revokeAndVerify(client, refreshToken, fetchImpl) {
  const revokeResponse = await fetchImpl(GOOGLE_REVOKE_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
  });
  if (!revokeResponse.ok) throw new Error(`oauth_revoke_failed:${revokeResponse.status}`);

  const body = new URLSearchParams({
    client_id: client.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  const refreshResponse = await fetchImpl(client.tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await safeJson(refreshResponse);
  if (refreshResponse.ok || errorCode(payload) !== 'invalid_grant') {
    throw new Error(`oauth_refresh_after_revoke_unexpected:${refreshResponse.status}:${errorCode(payload)}`);
  }
  return Object.freeze({
    revoke_status: revokeResponse.status,
    refresh_after_revoke_status: refreshResponse.status,
    refresh_after_revoke_error: errorCode(payload),
  });
}

function waitForCallback(server, expectedState) {
  return new Promise((resolve, reject) => {
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      if (url.searchParams.get('state') !== expectedState) {
        response.writeHead(400).end('Authorization rejected.');
        reject(new Error('oauth_state_mismatch'));
        return;
      }
      const providerError = url.searchParams.get('error');
      if (providerError) {
        response.writeHead(400).end('Authorization rejected.');
        const safeError = /^[a-z0-9_.-]{1,80}$/iu.test(providerError)
          ? providerError : 'provider_error';
        reject(new Error(`oauth_provider_error:${safeError}`));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Authorization rejected.');
        reject(new Error('oauth_code_missing'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Authorization received. You may close this window.');
      resolve(code);
    });
  });
}

export function browserLaunchInvocation(url, platform = process.platform) {
  if (platform === 'darwin') return Object.freeze({
    command: 'open', args: ['-a', 'Google Chrome', url],
  });
  return Object.freeze({
    command: platform === 'win32' ? 'start' : 'xdg-open', args: [url],
  });
}

async function openBrowser(url) {
  const { command, args } = browserLaunchInvocation(url);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('browser_open_failed')));
  });
}

function writeEvidence(filePath, value) {
  const resolved = assertPrivateFile(filePath, { mustExist: false });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(resolved, 0o600);
  return resolved;
}

export async function runOAuthAcceptance({ clientJsonPath, evidencePath, fetchImpl = fetch,
  openBrowserImpl = openBrowser } = {}) {
  const client = readDesktopClientConfig(clientJsonPath);
  const evidenceFile = assertPrivateFile(evidencePath, { mustExist: false });
  const fixture = randomBytes(512 * 1024);
  const state = randomBytes(32).toString('base64url');
  const pkce = createPkcePair();
  const server = createServer();
  let accessToken = '';
  let refreshToken = '';
  let folderId = '';
  let fileId = '';
  let duplicateFileId = '';
  let revoked = false;
  const receipt = {
    version: 1,
    status: 'FAIL',
    requested_scope: [DRIVE_FILE_SCOPE],
    returned_scope: null,
    tokens_persisted: false,
    resumable_upload: null,
    readback: null,
    duplicate: null,
    private_permissions: null,
    revoke: null,
    created_objects: {
      folder_created: false, file_created: false, duplicate_file_created: false, cleaned: false,
    },
    failure_code: null,
  };

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
    const authorizationUrl = buildAuthorizationUrl({
      authUri: client.authUri,
      challenge: pkce.challenge,
      clientId: client.clientId,
      redirectUri,
      state,
    });
    const callback = waitForCallback(server, state);
    await openBrowserImpl(authorizationUrl.toString());
    const code = await callback;
    const exchanged = await exchangeCode(client, code, redirectUri, pkce.verifier, fetchImpl);
    accessToken = exchanged.accessToken;
    refreshToken = exchanged.refreshToken;
    receipt.returned_scope = exchanged.scope;

    const folder = await createTestFolder(accessToken, fetchImpl);
    folderId = folder.id;
    receipt.created_objects.folder_created = true;
    const folderPrivate = await verifyPrivatePermissions(accessToken, folderId, fetchImpl);
    const upload = await resumableUpload(accessToken, folderId, fixture, fetchImpl, 'ygb-oauth-pkce-poc.bin');
    fileId = upload.file_id;
    receipt.created_objects.file_created = true;
    receipt.resumable_upload = {
      first_chunk_status: upload.first_chunk_status,
      confirmed_offset: upload.confirmed_offset,
      final_status: upload.final_status,
      final_sha256: createHash('sha256').update(fixture).digest('hex'),
    };
    receipt.readback = await verifyReadback(accessToken, fileId, fixture, fetchImpl);
    const filePrivate = await verifyPrivatePermissions(accessToken, fileId, fetchImpl);

    const duplicateUpload = await resumableUpload(
      accessToken, folderId, fixture, fetchImpl, 'ygb-oauth-pkce-poc-duplicate.bin',
    );
    duplicateFileId = duplicateUpload.file_id;
    receipt.created_objects.duplicate_file_created = true;
    const duplicateReadback = await verifyReadback(accessToken, duplicateFileId, fixture, fetchImpl);
    const duplicatePrivate = await verifyPrivatePermissions(accessToken, duplicateFileId, fetchImpl);
    receipt.duplicate = {
      distinct_file_created: duplicateFileId !== fileId,
      first_chunk_status: duplicateUpload.first_chunk_status,
      confirmed_offset: duplicateUpload.confirmed_offset,
      final_status: duplicateUpload.final_status,
      readback: duplicateReadback,
    };
    receipt.private_permissions = {
      folder_owner_only: folderPrivate,
      file_owner_only: filePrivate,
      duplicate_owner_only: duplicatePrivate,
    };

    await deleteCreatedObject(accessToken, fileId, fetchImpl);
    await deleteCreatedObject(accessToken, duplicateFileId, fetchImpl);
    await deleteCreatedObject(accessToken, folderId, fetchImpl);
    receipt.created_objects.cleaned = true;
    receipt.revoke = await revokeAndVerify(client, refreshToken, fetchImpl);
    revoked = true;
    receipt.status = 'PASS';
  } catch (error) {
    receipt.failure_code = error instanceof Error ? error.message.slice(0, 120) : 'oauth_acceptance_failed';
    if (accessToken && !receipt.created_objects.cleaned) {
      try { await deleteCreatedObject(accessToken, fileId, fetchImpl); } catch { /* receipt remains failed */ }
      try { await deleteCreatedObject(accessToken, duplicateFileId, fetchImpl); } catch { /* receipt remains failed */ }
      try { await deleteCreatedObject(accessToken, folderId, fetchImpl); } catch { /* receipt remains failed */ }
    }
    if (refreshToken && !revoked) {
      try { await revokeAndVerify(client, refreshToken, fetchImpl); } catch { /* receipt remains failed */ }
    }
  } finally {
    accessToken = '';
    refreshToken = '';
    server.close();
  }

  writeEvidence(evidenceFile, receipt);
  return Object.freeze(receipt);
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith('--')) throw new Error('invalid_argument');
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing_value:${key}`);
    if (key !== 'client-json' && key !== 'evidence') throw new Error(`unsupported_argument:${key}`);
    result[key] = next;
    index += 1;
  }
  if (!result['client-json'] || !result.evidence) throw new Error('client_json_and_evidence_required');
  return result;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const receipt = await runOAuthAcceptance({
      clientJsonPath: args['client-json'],
      evidencePath: args.evidence,
    });
    console.log(JSON.stringify({ status: receipt.status, evidence_written: true }));
    if (receipt.status !== 'PASS') process.exitCode = 1;
  } catch {
    console.error('oauth_acceptance_blocked');
    process.exitCode = 1;
  }
}

const invokedAsCli = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsCli) await main();
