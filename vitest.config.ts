import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Live config, not dead: per-file `@vitest-environment jsdom` docblocks inherit
    // this jsdom URL as the document base URL, which relative fetch URLs and MSW
    // handler matching depend on. Do not remove.
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    include: [
      'apps/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.mjs',
      'tools/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      'apps/web/e2e/**',
    ],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
