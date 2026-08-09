import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const repositoryRoot = path.resolve(import.meta.dirname, '..');

export function invariant(value, message) {
  if (!value) throw new Error(message);
}

export function readRepositoryFile(file, root = repositoryRoot) {
  return readFileSync(path.resolve(root, file), 'utf8');
}

export function assertIncludes(source, markers, label = 'source') {
  for (const marker of markers) {
    invariant(source.includes(marker), `${label} missing: ${marker}`);
  }
  return source;
}

export function resolveChangeRoot(changeName, root = repositoryRoot) {
  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(changeName), `invalid Change name: ${changeName}`);
  const changesRoot = path.join(root, 'openspec', 'changes');
  const archiveRoot = path.join(changesRoot, 'archive');
  requireDirectory(changesRoot, 'OpenSpec changes');
  requireDirectory(archiveRoot, 'OpenSpec archive');

  const activeRoot = path.join(changesRoot, changeName);
  const active = optionalDirectory(activeRoot, `${changeName} active Change`);
  const archiveEntries = readdirSync(archiveRoot);
  const archivePattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRegExp(changeName)}$`, 'u');
  const malformed = archiveEntries.filter((entry) => entry.endsWith(`-${changeName}`)
    && !archivePattern.test(entry));
  invariant(malformed.length === 0, `${changeName} has invalid archive names: ${malformed.join(', ')}`);
  const archived = archiveEntries
    .filter((entry) => archivePattern.test(entry))
    .map((entry) => path.join(archiveRoot, entry));
  for (const archivedRoot of archived) requireDirectory(archivedRoot, `${changeName} archived Change`);

  invariant(archived.length <= 1, `${changeName} has multiple dated archives`);
  invariant(!(active && archived.length === 1), `${changeName} active and archived evidence must not coexist`);
  invariant(active || archived.length === 1, `${changeName} active or archived Change not found`);
  return active ? activeRoot : archived[0];
}

export function resolveChangeFile(changeName, relativeFile, root = repositoryRoot) {
  invariant(relativeFile.length > 0 && !path.isAbsolute(relativeFile), 'Change evidence path must be relative');
  const changeRoot = resolveChangeRoot(changeName, root);
  const resolved = path.resolve(changeRoot, relativeFile);
  invariant(resolved.startsWith(`${changeRoot}${path.sep}`), `Change evidence escapes root: ${relativeFile}`);
  const stats = lstatSync(resolved, { throwIfNoEntry: false });
  invariant(stats?.isFile() && !stats.isSymbolicLink(), `Change evidence must be an ordinary file: ${relativeFile}`);
  return resolved;
}

function optionalDirectory(directory, label) {
  const stats = lstatSync(directory, { throwIfNoEntry: false });
  if (!stats) return false;
  invariant(!stats.isSymbolicLink() && stats.isDirectory(), `${label} must be an ordinary directory: ${directory}`);
  return true;
}

function requireDirectory(directory, label) {
  invariant(optionalDirectory(directory, label), `${label} directory missing: ${directory}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
