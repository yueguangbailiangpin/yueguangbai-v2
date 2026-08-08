import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    include: [
      'apps/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.mjs',
    ],
    exclude: [
      'apps/web/e2e/**',
    ],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
