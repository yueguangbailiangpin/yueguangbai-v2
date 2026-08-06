import { spawnSync } from 'node:child_process';

const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
if (![0, 1].includes(audit.status ?? -1) || !audit.stdout.trim()) {
  throw new Error(`npm audit unavailable: ${audit.stderr.trim()}`);
}
const report = JSON.parse(audit.stdout);
const counts = report.metadata?.vulnerabilities ?? {};
if (Number(counts.critical ?? 0) !== 0 || Number(counts.high ?? 0) > 2) {
  throw new Error(`dependency risk worsened: ${JSON.stringify(counts)}`);
}

const vulnerabilities = report.vulnerabilities ?? {};
const allowedPackages = new Set(['react-router', 'react-router-dom']);
for (const name of Object.keys(vulnerabilities)) {
  if (!allowedPackages.has(name)) {
    throw new Error(`unexpected vulnerable production package: ${name}`);
  }
}
const allowedHighAdvisories = new Set([
  'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
]);
const observedHighAdvisories = Object.values(vulnerabilities)
  .flatMap((entry) => Array.isArray(entry.via) ? entry.via : [])
  .filter((entry) => typeof entry === 'object' && entry?.severity === 'high')
  .map((entry) => entry.url);
for (const url of observedHighAdvisories) {
  if (!allowedHighAdvisories.has(url)) {
    throw new Error(`unexpected high advisory: ${url}`);
  }
}
if (Number(counts.high ?? 0) > 0 && observedHighAdvisories.length === 0) {
  throw new Error('high vulnerability lacks an auditable advisory identity');
}

console.log(JSON.stringify({
  status: 'PASS_WITH_DOCUMENTED_EXCEPTION',
  vulnerabilities: counts,
  vulnerable_packages: Object.keys(vulnerabilities),
  high_advisories: observedHighAdvisories,
  disposition: 'docs/security/V2_M3_DEPENDENCY_RISK_DISPOSITION.md',
}, null, 2));
