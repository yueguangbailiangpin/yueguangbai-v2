// This allowlist is intentionally narrow: each entry must correspond to a
// package-lock.json packages[*].hasInstallScript record.
export const LIFECYCLE_PACKAGE_ALLOWLIST = Object.freeze([
  Object.freeze({
    name: '@fission-ai/openspec',
    version: '1.8.0',
    reason: 'Development CLI used by the repository-wide OpenSpec strict gate.',
  }),
  Object.freeze({
    name: 'esbuild',
    version: '0.28.1',
    reason: 'Vite and Vitest native transform binary used by workspace builds and tests.',
  }),
  Object.freeze({
    name: 'fsevents',
    version: '2.3.3',
    reason: 'Optional macOS file-watcher dependency in the locked development graph.',
  }),
  Object.freeze({
    name: 'fsevents',
    version: '2.3.2',
    reason: 'Optional macOS file-watcher nested below the locked Playwright graph.',
  }),
  Object.freeze({
    name: 'msw',
    version: '2.15.0',
    reason: 'Mock Service Worker test-runtime package used by repository tests.',
  }),
  Object.freeze({
    name: 'workerd',
    version: '1.20260730.1',
    reason: 'Wrangler local dry-run runtime binary; CI never deploys it.',
  }),
]);
