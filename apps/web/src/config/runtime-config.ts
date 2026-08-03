const apiPath = /^\/api\/(?!v2(?:\/|$))[a-z0-9][a-z0-9_./:-]*$/i;

export type RuntimeConfig = Readonly<{ staffProviderOrigin: string }>;

export function approvedApiPath(path: string): boolean {
  return apiPath.test(path) && !path.includes('..');
}

export function runtimeConfig(environment: ImportMetaEnv = import.meta.env): RuntimeConfig {
  const candidate = environment['VITE_STAFF_PROVIDER_ORIGIN'] ?? 'https://open.feishu.cn';
  const url = new URL(candidate);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid_staff_provider_origin');
  }
  return Object.freeze({ staffProviderOrigin: url.origin });
}
