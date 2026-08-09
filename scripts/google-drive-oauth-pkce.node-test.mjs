import assert from 'node:assert/strict';
import { get } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  buildAuthorizationUrl,
  browserLaunchInvocation,
  createPkcePair,
  DRIVE_FILE_SCOPE,
  exactDriveFileScope,
  parseDesktopClientConfig,
  parseUploadRange,
  runOAuthAcceptance,
} from './google-drive-oauth-pkce.mjs';

test('accepts only the exact drive.file scope', () => {
  assert.deepEqual(exactDriveFileScope('https://www.googleapis.com/auth/drive.file'), [
    'https://www.googleapis.com/auth/drive.file',
  ]);
  assert.throws(() => exactDriveFileScope('https://www.googleapis.com/auth/drive'), /not_exact/u);
});

test('builds offline PKCE authorization parameters without widening scope', () => {
  const pkce = createPkcePair();
  const url = buildAuthorizationUrl({
    challenge: pkce.challenge,
    clientId: 'synthetic-client-id',
    redirectUri: 'http://127.0.0.1:12345/oauth2/callback',
    state: 'synthetic-state',
  });
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('client_id'), 'synthetic-client-id');
});

test('accepts installed desktop client shape and rejects web client shape', () => {
  assert.equal(parseDesktopClientConfig({
    installed: {
      auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth',
      client_id: 'synthetic-client-id',
      token_uri: 'https://oauth2.googleapis.com/token',
    },
  }).clientId, 'synthetic-client-id');
  assert.throws(() => parseDesktopClientConfig({ web: {} }), /desktop_client_config_required/u);
});

test('parses only a safe resumable upload range', () => {
  assert.equal(parseUploadRange('bytes=0-262143'), 262143);
  assert.equal(parseUploadRange('bytes=10-20'), null);
  assert.equal(parseUploadRange(''), null);
});

test('launches macOS OAuth only in Google Chrome without shell or URL logging', () => {
  assert.deepEqual(browserLaunchInvocation('https://accounts.example.test/oauth', 'darwin'), {
    command: 'open',
    args: ['-a', 'Google Chrome', 'https://accounts.example.test/oauth'],
  });
  const source = readFileSync(new URL('./google-drive-oauth-pkce.mjs', import.meta.url), 'utf8');
  assert.match(source, /spawn\(command, args, \{ shell: false, stdio: 'ignore' \}\)/u);
  assert.match(source, /args: \['-a', 'Google Chrome', url\]/u);
  assert.doesNotMatch(source, /process\.platform === 'darwin' \? 'open'\s*:/u);
});

test('runs the complete flow against an in-memory provider without persisting tokens', async () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-oauth-pkce-test-'));
  const clientJsonPath = path.join(temporaryDirectory, 'client.json');
  const evidencePath = path.join(temporaryDirectory, 'evidence.json');
  writeFileSync(clientJsonPath, JSON.stringify({
    installed: {
      auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth',
      client_id: 'synthetic-client-id',
      token_uri: 'https://oauth2.googleapis.com/token',
    },
  }), { mode: 0o600 });
  let sessionCount = 0;
  const sessions = new Map();
  const uploadedByFile = new Map();
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    const method = options.method ?? 'GET';
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = String(options.body);
      if (body.includes('grant_type=authorization_code')) {
        const syntheticAccess = ['synthetic', 'access', 'token'].join('-');
        const syntheticRefresh = ['synthetic', 'refresh', 'token'].join('-');
        return new Response(JSON.stringify({
          access_token: syntheticAccess,
          refresh_token: syntheticRefresh,
          scope: DRIVE_FILE_SCOPE,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: 200 });
    if (url.includes('uploadType=resumable')) {
      sessionCount += 1;
      const sessionUrl = `http://127.0.0.1:9/synthetic-session-${sessionCount}`;
      sessions.set(sessionUrl, { buffer: Buffer.alloc(0), final: false });
      return new Response('', { status: 200, headers: { location: sessionUrl } });
    }
    if (url.startsWith('http://127.0.0.1:9/synthetic-session-')) {
      const session = sessions.get(url);
      if (!session) throw new Error('unknown_synthetic_session');
      const chunk = Buffer.from(options.body);
      session.buffer = Buffer.concat([session.buffer, chunk]);
      if (!session.final) {
        session.final = true;
        return new Response('', { status: 308, headers: { range: 'bytes=0-262143' } });
      }
      const fileId = sessionCount === 1 ? 'synthetic-file-id' : 'synthetic-duplicate-file-id';
      uploadedByFile.set(fileId, session.buffer);
      return new Response(JSON.stringify({ id: fileId }), { status: 200 });
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    for (const [fileId, uploaded] of uploadedByFile) {
      if (url.includes(`/files/${fileId}`) && url.includes('alt=media')) {
        return new Response(uploaded, { status: 200 });
      }
      if (url.includes(`/files/${fileId}`) && url.includes('permissions')) {
        return new Response(JSON.stringify({
          shared: false, permissions: [{ type: 'user', role: 'owner' }],
        }), { status: 200 });
      }
      if (url.includes(`/files/${fileId}`)) {
        return new Response(JSON.stringify({
          size: String(uploaded.length), mimeType: 'application/octet-stream', trashed: false,
        }), { status: 200 });
      }
    }
    if (url.includes('/files/synthetic-folder-id') && url.includes('permissions')) {
      return new Response(JSON.stringify({
        shared: false, permissions: [{ type: 'user', role: 'owner' }],
      }), { status: 200 });
    }
    if (url.includes('/files?fields=id')) {
      return new Response(JSON.stringify({ id: 'synthetic-folder-id' }), { status: 200 });
    }
    throw new Error(`unexpected_mock_route:${method}`);
  };
  const openBrowserImpl = async (authorizationUrl) => {
    const url = new URL(authorizationUrl);
    const redirect = new URL(url.searchParams.get('redirect_uri'));
    await new Promise((resolve, reject) => {
      const request = get({
        hostname: redirect.hostname,
        path: `${redirect.pathname}?code=synthetic-code&state=${encodeURIComponent(url.searchParams.get('state'))}`,
        port: Number(redirect.port),
      }, (response) => {
        response.resume();
        response.once('end', resolve);
      });
      request.once('error', reject);
    });
  };
  try {
    const receipt = await runOAuthAcceptance({
      clientJsonPath,
      evidencePath,
      fetchImpl,
      openBrowserImpl,
    });
    assert.equal(receipt.status, 'PASS', JSON.stringify(receipt));
    assert.deepEqual(receipt.returned_scope, [DRIVE_FILE_SCOPE]);
    assert.deepEqual(receipt.resumable_upload, {
      first_chunk_status: 308,
      confirmed_offset: 262143,
      final_status: 200,
      final_sha256: receipt.readback.sha256,
    });
    assert.equal(receipt.readback.bytes, 524288);
    assert.equal(receipt.duplicate.distinct_file_created, true);
    assert.equal(receipt.duplicate.first_chunk_status, 308);
    assert.equal(receipt.duplicate.confirmed_offset, 262143);
    assert.equal(receipt.duplicate.readback.sha256, receipt.readback.sha256);
    assert.deepEqual(receipt.private_permissions, {
      folder_owner_only: true,
      file_owner_only: true,
      duplicate_owner_only: true,
    });
    assert.equal(receipt.revoke.revoke_status, 200);
    assert.equal(receipt.revoke.refresh_after_revoke_status, 400);
    assert.equal(receipt.revoke.refresh_after_revoke_error, 'invalid_grant');
    assert.equal(receipt.tokens_persisted, false);
    const evidence = readFileSync(evidencePath, 'utf8');
    assert.equal(evidence.includes('synthetic-access-token'), false);
    assert.equal(evidence.includes('synthetic-refresh-token'), false);
    assert.equal(evidence.includes('synthetic-file-id'), false);
    assert.equal(evidence.includes('synthetic-duplicate-file-id'), false);
    assert.equal(evidence.includes('synthetic-folder-id'), false);
    assert.equal(evidence.includes('synthetic-session'), false);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
