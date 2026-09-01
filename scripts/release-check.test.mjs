import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  candidateProvenance,
  commandEnvironment,
  assertReleaseScriptsExist,
  missingReleaseScripts,
  RELEASE_COMMANDS,
  runReleaseCommands,
} from './release-check.mjs';

describe('release aggregate gate', () => {
  it('binds a clean candidate to its current commit and tree', () => {
    const values = ['', 'a'.repeat(40), 'b'.repeat(40)];
    expect(candidateProvenance(() => values.shift())).toEqual({
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
    });
  });

  it('rejects a dirty candidate or invalid provenance', () => {
    expect(() => candidateProvenance(() => ' M package.json')).toThrow('must be clean');
    const values = ['', 'historical-sha', 'b'.repeat(40)];
    expect(() => candidateProvenance(() => values.shift())).toThrow('commit is invalid');
  });

  it('covers every required local release family', () => {
    expect(RELEASE_COMMANDS).toEqual([
      'verify:openspec:strict',
      'audit:dependencies',
      'check',
      'preflight:drive-archive',
      'verify:staff-auth-composition',
      'verify:cloudflare-release',
      'dry-run:cloudflare-release',
      'verify:final-production-go:local',
      'test:browser',
    ]);
    expect(RELEASE_COMMANDS).not.toEqual(expect.arrayContaining([
      'check:production-readiness', 'check:drive-archive',
      'check:staff-auth-production', 'test:wave14a:browser',
    ]));
  });

  it('declares only npm scripts that exist in the root package manifest', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const missing = missingReleaseScripts(packageJson);

    expect(missing, `missing npm scripts: ${missing.join(', ')}`).toEqual([]);
  });

  it('fails closed with every missing release script when the manifest drifts', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const scripts = { ...packageJson.scripts };
    delete scripts['preflight:drive-archive'];
    scripts['verify:staff-auth-composition'] = '  ';

    expect(missingReleaseScripts({ ...packageJson, scripts })).toEqual([
      'preflight:drive-archive', 'verify:staff-auth-composition',
    ]);
    expect(() => assertReleaseScriptsExist({ ...packageJson, scripts }))
      .toThrow('preflight:drive-archive, verify:staff-auth-composition');
  });

  it('runs in order and stops on the first failed sub-gate', () => {
    const runner = vi.fn((command) => ({ status: command === 'second' ? 1 : 0 }));
    expect(() => runReleaseCommands(['first', 'second', 'third'], runner))
      .toThrow('release sub-gate failed: npm run second');
    expect(runner.mock.calls.map(([command]) => command)).toEqual(['first', 'second']);
  });

  it('isolates the release browser server on a configurable loopback port', () => {
    const environment = { RELEASE_BROWSER_PORT: '4300', EXISTING: 'preserved' };
    expect(commandEnvironment('test:browser', environment)).toEqual({
      ...environment,
      PLAYWRIGHT_PORT: '4300',
    });
    expect(commandEnvironment('check', environment)).toBe(environment);
  });
});
