import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// iPhone 13 viewport, touch and user agent, run in Chromium.
// WebKit is the real iPhone engine: run `npx playwright install webkit` and
// add a project with browserName 'webkit' if you can (see README).
const iphone = { ...devices['iPhone 13'] };
delete iphone.defaultBrowserType;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'iphone-chromium', use: { ...iphone, browserName: 'chromium' } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --directory docs`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
