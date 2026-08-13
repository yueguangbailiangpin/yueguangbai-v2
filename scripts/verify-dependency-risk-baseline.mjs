import { spawnSync } from 'node:child_process';

const audit = spawnSync('npm', ['audit', '--include=dev', '--audit-level=high', '--json'], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
if (![0, 1].includes(audit.status ?? -1) || !audit.stdout.trim()) {
  throw new Error(`npm audit unavailable: ${audit.stderr.trim()}`);
}
const report = JSON.parse(audit.stdout);
const counts = report.metadata?.vulnerabilities ?? {};
const blockingSeverities = ['high', 'critical'];
const blocking = Object.fromEntries(
  blockingSeverities.map((severity) => [severity, Number(counts[severity] ?? 0)]),
);
if (Object.values(blocking).some((count) => count !== 0)) {
  throw new Error(`high-or-critical dependency vulnerabilities remain: ${JSON.stringify({ blocking, counts })}`);
}

const vulnerabilities = report.vulnerabilities ?? {};
const blockingPackages = Object.entries(vulnerabilities)
  .filter(([, vulnerability]) => blockingSeverities.includes(vulnerability.severity))
  .map(([name]) => name)
  .sort();

console.log(JSON.stringify({
  status: 'PASS',
  scope: 'production-and-dev-dependencies',
  audit_command: 'npm audit --include=dev --audit-level=high --json',
  blocking_severities: blockingSeverities,
  vulnerabilities: counts,
  vulnerable_packages: blockingPackages,
  disposition: 'docs/security/V2_REACT_ROUTER_RSC_ADVISORY_DISPOSITION.md',
}, null, 2));
