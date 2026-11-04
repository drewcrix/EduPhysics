import { defineConfig } from '@playwright/test';

// Same convention as the orbital simulator: locally the installed Google Chrome is used,
// CI sets PW_CHANNEL=chromium after `npx playwright install chromium`.
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: 'http://localhost:4174', channel, viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npm run preview', url: 'http://localhost:4174', reuseExistingServer: true, timeout: 60_000 },
});
