import { defineConfig } from '@playwright/test';

// Site-level smoke test of the assembled platform (npm run build:site first).
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: 'http://localhost:4180', channel, viewport: { width: 1280, height: 860 } },
  webServer: { command: 'node scripts/preview-site.mjs 4180', url: 'http://localhost:4180', reuseExistingServer: true, timeout: 30_000 },
});
