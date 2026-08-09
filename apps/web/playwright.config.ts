import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['PLAYWRIGHT_PORT'] ?? '4174');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new Error('PLAYWRIGHT_PORT must be an integer from 1024 to 65535');
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e', timeout: 30_000, use: { baseURL },
  webServer: {
    command: `npm --workspace @ygb/web exec vite -- preview --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
