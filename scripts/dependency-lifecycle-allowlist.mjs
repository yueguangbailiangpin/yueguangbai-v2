// This is a provenance approval record, not a broad trust list. Each record
// must exactly match one package-lock.json packages[*].hasInstallScript entry.
// `null` is only valid when a lockfile field is intentionally absent and the
// accompanying provenanceNote explains that platform-specific omission.
export const LIFECYCLE_PACKAGE_ALLOWLIST = Object.freeze([
  Object.freeze({
    name: '@fission-ai/openspec',
    version: '1.8.0',
    path: 'node_modules/@fission-ai/openspec',
    optional: false,
    resolved: 'https://registry.npmjs.org/@fission-ai/openspec/-/openspec-1.8.0.tgz',
    integrity: 'sha512-xtKj5hI/kBgxJjIsCk1r3LnPbwqS41/xnDy8JTtz1B78S0Ydj276GBR4BxYkd6WUpspPA07T0BjcgmUBYgl3zA==',
    reason: 'Development CLI used by the repository-wide OpenSpec strict gate.',
  }),
  Object.freeze({
    name: 'esbuild',
    version: '0.28.1',
    path: 'node_modules/esbuild',
    optional: false,
    resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.28.1.tgz',
    integrity: 'sha512-HrJrvZv5ayxBzPfwphOoNzkzOIIlifzk0KJrGK2c8R4+LKpMtpYLQeUdjnwjWv/LZlkH2laZk+4w78pi99D4Vw==',
    reason: 'Vite and Vitest native transform binary used by workspace builds and tests.',
  }),
  Object.freeze({
    name: 'fsevents',
    version: '2.3.3',
    path: 'node_modules/fsevents',
    optional: true,
    resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz',
    integrity: 'sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==',
    reason: 'Optional macOS file-watcher dependency in the locked development graph.',
  }),
  Object.freeze({
    name: 'msw',
    version: '2.15.0',
    path: 'node_modules/msw',
    optional: false,
    resolved: 'https://registry.npmjs.org/msw/-/msw-2.15.0.tgz',
    integrity: 'sha512-2wQAmKkQKxRuXvYJxVhPGG0wZNBQyD06oJvxqw90XqLvptdqxdlHrFUfEteKkpaNORX3Xzc+HtEl/q0nfmN2wQ==',
    reason: 'Mock Service Worker test-runtime package used by repository tests.',
  }),
  Object.freeze({
    name: 'fsevents',
    version: '2.3.2',
    path: 'node_modules/playwright/node_modules/fsevents',
    optional: true,
    resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz',
    integrity: 'sha512-xiqMQR4xAeHTuB9uWm+fFRcIOgKBMiOBP+eXiyT7jsgVCq1bkVygt00oASowB7EdtpOHaaPgKt812P9ab+DDKA==',
    reason: 'Optional macOS file-watcher nested below the locked Playwright graph.',
  }),
  Object.freeze({
    name: 'workerd',
    version: '1.20260730.1',
    path: 'node_modules/workerd',
    optional: false,
    resolved: 'https://registry.npmjs.org/workerd/-/workerd-1.20260730.1.tgz',
    integrity: 'sha512-zmfNIjwYSWFY5chGBOjWtH3xAE7p97FTC6vR4Ep98290ho6AeAR/NVcBD274YCLEUYzqm8yxdtZlxMybU8a3jA==',
    reason: 'Wrangler local dry-run runtime binary; CI never deploys it.',
  }),
]);
