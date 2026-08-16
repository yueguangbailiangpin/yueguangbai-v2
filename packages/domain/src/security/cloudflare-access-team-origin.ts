const ACCESS_TEAM_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/u;

export function exactCloudflareAccessTeamOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.origin === value
      && url.port === ''
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && !url.username
      && !url.password
      && ACCESS_TEAM_HOST.test(url.hostname)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
