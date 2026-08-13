import { readFileSync } from 'node:fs';
import { LIFECYCLE_PACKAGE_ALLOWLIST } from './dependency-lifecycle-allowlist.mjs';

const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

function packageNameFromLockPath(lockPath) {
  const segment = lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const parts = segment.split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function keyOf({ name, version }) {
  return `${name}@${version}`;
}

const approvedByKey = new Map();
for (const entry of LIFECYCLE_PACKAGE_ALLOWLIST) {
  if (!entry.name || !entry.version || !entry.reason) {
    throw new Error(`invalid lifecycle allowlist entry: ${JSON.stringify(entry)}`);
  }
  const key = keyOf(entry);
  if (approvedByKey.has(key)) {
    throw new Error(`duplicate lifecycle allowlist entry: ${key}`);
  }
  approvedByKey.set(key, entry);
}

const actualByKey = new Map();
for (const [lockPath, metadata] of Object.entries(lockfile.packages ?? {})) {
  if (!metadata.hasInstallScript) continue;
  if (!lockPath.includes('node_modules/') || !metadata.version) {
    throw new Error(`unverifiable lifecycle record in package-lock.json: ${lockPath}`);
  }
  const record = {
    name: packageNameFromLockPath(lockPath),
    version: metadata.version,
    paths: [lockPath],
    optional: metadata.optional === true,
  };
  const key = keyOf(record);
  const existing = actualByKey.get(key);
  if (existing) {
    existing.paths.push(lockPath);
  } else {
    actualByKey.set(key, record);
  }
}

const unexpected = [...actualByKey.keys()].filter((key) => !approvedByKey.has(key));
const missing = [...approvedByKey.keys()].filter((key) => !actualByKey.has(key));
if (unexpected.length || missing.length) {
  throw new Error(JSON.stringify({
    status: 'FAIL',
    source: 'package-lock.json packages[*].hasInstallScript',
    unexpected_lifecycle_packages: unexpected,
    approved_but_missing: missing,
  }, null, 2));
}

const lifecyclePackages = [...actualByKey.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, actual]) => ({
    ...actual,
    paths: actual.paths.sort(),
    reason: approvedByKey.get(key).reason,
  }));

console.log(JSON.stringify({
  status: 'PASS',
  source: 'package-lock.json packages[*].hasInstallScript',
  approval: 'exact package name and version allowlist',
  lifecycle_packages: lifecyclePackages,
}, null, 2));
