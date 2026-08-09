import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertIncludes, invariant, resolveChangeFile, resolveChangeRoot } from './verifier-utils.mjs';

const changeName = 'example-change';
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('verifier utilities', () => {
  it('keeps assertions and exact markers fail closed', () => {
    expect(() => invariant(false, 'required')).toThrow('required');
    expect(assertIncludes('alpha beta', ['alpha', 'beta'], 'fixture')).toBe('alpha beta');
    expect(() => assertIncludes('alpha', ['beta'], 'fixture')).toThrow('fixture missing: beta');
  });

  it.each([
    ['active', (root) => createChange(root, `openspec/changes/${changeName}`)],
    ['archive', (root) => createChange(root, `openspec/changes/archive/2026-08-09-${changeName}`)],
  ])('resolves one ordinary %s Change', (_label, setup) => {
    const root = workspace();
    setup(root);
    expect(resolveChangeRoot(changeName, root)).toContain(changeName);
    expect(resolveChangeFile(changeName, 'tasks.md', root)).toContain('tasks.md');
  });

  it.each([
    ['missing', () => {}],
    ['coexisting', (root) => {
      createChange(root, `openspec/changes/${changeName}`);
      createChange(root, `openspec/changes/archive/2026-08-09-${changeName}`);
    }],
    ['duplicate archives', (root) => {
      createChange(root, `openspec/changes/archive/2026-08-08-${changeName}`);
      createChange(root, `openspec/changes/archive/2026-08-09-${changeName}`);
    }],
    ['symlink', (root) => {
      const target = path.join(root, 'target');
      mkdirSync(target);
      symlinkSync(target, path.join(root, 'openspec/changes', changeName));
    }],
    ['invalid archive name', (root) => {
      createChange(root, `openspec/changes/${changeName}`);
      createChange(root, `openspec/changes/archive/latest-${changeName}`);
    }],
  ])('rejects %s Change evidence', (_label, setup) => {
    const root = workspace();
    setup(root);
    expect(() => resolveChangeRoot(changeName, root)).toThrow();
  });

  it('rejects missing, symlinked, or escaping evidence files', () => {
    const root = workspace();
    const change = createChange(root, `openspec/changes/${changeName}`);
    expect(() => resolveChangeFile(changeName, 'missing.md', root)).toThrow();
    symlinkSync(path.join(change, 'tasks.md'), path.join(change, 'linked.md'));
    expect(() => resolveChangeFile(changeName, 'linked.md', root)).toThrow();
    expect(() => resolveChangeFile(changeName, '../archive', root)).toThrow();
  });
});

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'verifier-utils-'));
  roots.push(root);
  mkdirSync(path.join(root, 'openspec/changes/archive'), { recursive: true });
  return root;
}

function createChange(root, relative) {
  const directory = path.join(root, relative);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'tasks.md'), '# Tasks\n');
  return directory;
}
