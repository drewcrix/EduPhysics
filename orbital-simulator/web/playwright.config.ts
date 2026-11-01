import { defineConfig } from '@playwright/test';

// Two projects:
//  - "app":   WebGL disabled, so every interaction test runs through the 2-D fallback view.
//             This keeps the tests fast and deterministic on GPU-less machines/CI.
//  - "webgl": software WebGL (SwiftShader) at a small viewport, only to prove the 3-D view
//             renders without errors. CPU-rasterised WebGL is far too slow for interaction tests.
// Locally the installed Google Chrome is used (no browser download); CI sets PW_CHANNEL=chromium.
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  use: { baseURL: 'http://localhost:4173', channel },
  projects: [
    {
      name: 'app',
      testIgnore: /webgl\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--disable-webgl', '--disable-3d-apis'] } },
    },
    {
      name: 'webgl',
      testMatch: /webgl\.spec\.ts/,
      use: { viewport: { width: 900, height: 600 }, launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
