import { describe, expect, it, vi } from 'vitest';
import { candidateProvenance, RELEASE_COMMANDS, runReleaseCommands } from './release-check.mjs';

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
    expect(RELEASE_COMMANDS).toEqual(expect.arrayContaining([
      'check', 'verify:final-production-go:local', 'verify:cloudflare-release',
      'dry-run:cloudflare-release', 'check:production-readiness', 'check:drive-archive',
      'check:feishu-workbench', 'check:staff-mcp-production', 'test:wave14a:browser',
    ]));
  });

  it('runs in order and stops on the first failed sub-gate', () => {
    const runner = vi.fn((command) => ({ status: command === 'second' ? 1 : 0 }));
    expect(() => runReleaseCommands(['first', 'second', 'third'], runner))
      .toThrow('release sub-gate failed: npm run second');
    expect(runner.mock.calls.map(([command]) => command)).toEqual(['first', 'second']);
  });
});
