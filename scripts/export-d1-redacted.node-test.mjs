import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWranglerArgs,
  parseExportArgs,
  redactProviderOutput,
} from './export-d1-redacted.mjs';

test('redacts complete signed URLs and credential-like values', () => {
  const signedUrl = 'https://example.r2.cloudflarestorage.com/export.sql?X-Amz-Credential=secret&X-Amz-Signature=signature';
  const input = `progress ${signedUrl}\nBearer bearer-secret\nrefresh_token=refresh-secret`;
  const output = redactProviderOutput(input);
  assert.equal(output.includes(signedUrl), false);
  assert.equal(output.includes('X-Amz-Signature'), false);
  assert.equal(output.includes('secret'), false);
  assert.match(output, /\[REDACTED_URL\]/u);
  assert.match(output, /Bearer \[REDACTED\]/u);
});

test('requires exactly one explicit export mode and required paths', () => {
  assert.deepEqual(parseExportArgs([
    '--database', 'anonymous-db', '--output', '/tmp/export.sql', '--local',
  ]), {
    config: null,
    database: 'anonymous-db',
    mode: 'local',
    output: '/tmp/export.sql',
  });
  assert.throws(() => parseExportArgs([
    '--database', 'db', '--output', '/tmp/export.sql', '--remote', '--local',
  ]), /exactly_one_export_mode_required/u);
});

test('builds a no-shell Wrangler export invocation', () => {
  assert.deepEqual(buildWranglerArgs({
    config: '/tmp/wrangler.jsonc',
    database: 'anonymous-db',
    mode: 'remote',
    output: '/tmp/export.sql',
  }), [
    '--config', '/tmp/wrangler.jsonc', 'd1', 'export', 'anonymous-db',
    '--output', '/tmp/export.sql', '--remote', '--skip-confirmation',
  ]);
});
