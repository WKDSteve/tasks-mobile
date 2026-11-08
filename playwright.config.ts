import { defineConfig, devices } from '@playwright/test';

// The page built on the synthetic vault (`pnpm build:fake`), served with the hub's CSP (tools/serve.mjs), in the
// system's Chrome (nothing is downloaded) with the screen and touch of a phone. `pnpm e2e` builds first.
const port = Number(process.env['E2E_PORT'] ?? '4317');

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    channel: 'chrome',
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: `node tools/serve.mjs dist-fake ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
