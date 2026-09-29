import { defineConfig, devices } from '@playwright/test';

/**
 * A separate config for capturing design mocks, so the mock specs cannot be picked up
 * by `test:e2e` or `test:visual` and cannot produce a committed baseline.
 *
 * The root `playwright.config.ts` sets `testDir: './tests/e2e'`, which is what keeps
 * these out by default. This config exists only to point at `mocks/` deliberately.
 *
 *   npx playwright test --config=mocks/playwright.mocks.config.ts
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
