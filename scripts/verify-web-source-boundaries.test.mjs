import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findWebSourceBoundaryViolations } from './verify-web-source-boundaries.mjs';

let directory;

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('Web source boundary verifier', () => {
  it('accepts an identity-aware protected adapter', () => {
    const root = fixtureRoot();
    write(root, 'api/protected.ts', `
      export const read = () => identityApiRequest('buyer', {
        path: '/api/buyer-portal/me', method: 'GET'
      });
    `);
    expect(findWebSourceBoundaryViolations(root)).toEqual([]);
  });

  it('rejects generic secret and transport boundary violations', () => {
    const root = fixtureRoot();
    write(root, 'bad.ts', `
      localStorage.setItem('token', 'x');
      fetch('/api/staff/me');
      const dto = { object_key: 'private' };
    `);
    write(root, 'files/file-upload-transport.ts', `
      xhr.setRequestHeader('Content-Type', 'multipart/form-data');
    `);
    write(root, 'files/file-upload-operation.ts', 'export const uploadToken = "leak";');
    expect(findWebSourceBoundaryViolations(root)).toEqual(expect.arrayContaining([
      'browser_storage:apps/web/src/bad.ts',
      'protected_transport_bypass:apps/web/src/bad.ts',
      'storage_key_dto:apps/web/src/bad.ts',
      'multipart_content_type_override:apps/web/src/files/file-upload-transport.ts',
      'upload_snapshot_private_material:apps/web/src/files/file-upload-operation.ts',
    ]));
  });

  it('does not treat test fixtures as production violations', () => {
    const root = fixtureRoot();
    write(root, 'fixture.test.ts', "localStorage.setItem('token', 'fixture');");
    expect(findWebSourceBoundaryViolations(root)).toEqual([]);
  });
});

function fixtureRoot() {
  directory = mkdtempSync(path.join(tmpdir(), 'ygb-web-boundary-'));
  mkdirSync(path.join(directory, 'apps/web/src'), { recursive: true });
  return directory;
}

function write(root, relative, contents) {
  const target = path.join(root, 'apps/web/src', relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}
