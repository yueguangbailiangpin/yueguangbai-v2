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
if (Object.values(counts).some((count) => Number(count) !== 0)) {
  throw new Error(`dependency vulnerabilities remain: ${JSON.stringify(counts)}`);
}

const vulnerabilities = report.vulnerabilities ?? {};
if (Object.keys(vulnerabilities).length !== 0) {
  throw new Error(`unexpected vulnerable production package: ${Object.keys(vulnerabilities).join(',')}`);
}

console.log(JSON.stringify({
  status: 'PASS',
  vulnerabilities: counts,
  vulnerable_packages: [],
  disposition: 'docs/security/V2_REACT_ROUTER_RSC_ADVISORY_DISPOSITION.md',
}, null, 2));
