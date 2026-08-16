import { describe, expect, it } from 'vitest';
import { exactCloudflareAccessTeamOrigin } from './cloudflare-access-team-origin';

describe('Cloudflare Access team origin', () => {
  it('accepts only one exact cloudflareaccess.com team origin', () => {
    expect(exactCloudflareAccessTeamOrigin('https://moonwhite.cloudflareaccess.com'))
      .toBe('https://moonwhite.cloudflareaccess.com');
    expect(exactCloudflareAccessTeamOrigin('https://staging-team.cloudflareaccess.com'))
      .toBe('https://staging-team.cloudflareaccess.com');
  });

  it('rejects self origins, arbitrary hosts and non-exact URL forms', () => {
    for (const value of [
      'https://staging.yueguangbai.net',
      'https://example.com',
      'https://cloudflareaccess.com',
      'https://nested.team.cloudflareaccess.com',
      'http://team.cloudflareaccess.com',
      'https://team.cloudflareaccess.com/',
      'https://team.cloudflareaccess.com:443',
      'https://team.cloudflareaccess.com/path',
      'https://team.cloudflareaccess.com?query=1',
      'https://team.cloudflareaccess.com#fragment',
      'https://user@team.cloudflareaccess.com',
      ' https://team.cloudflareaccess.com',
      'REQUIRED_ACCESS_TEAM_DOMAIN',
      '',
      null,
    ]) expect(exactCloudflareAccessTeamOrigin(value)).toBeNull();
  });
});
